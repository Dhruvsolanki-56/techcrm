import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, qs, type Row } from '../lib/api';
import { money } from '../lib/format';
import { useSession } from '../lib/session';
import { DocsPanel } from '../components/Docs';
import { HistoryPanel } from '../components/HistoryPanel';
import { Modal, useDialogs } from '../ui/Modal';
import { useToast } from '../ui/Toasts';
import { FormGrid, validate, type Errors, type Values } from './Fields';
import { FORM_INFO, FORMS, isSection, RESOURCE_LABEL, type FieldDef, type FormItem } from './schema';

export interface OpenOpts {
  resource: string;
  record?: Row | null;
  /** Values for a new record, including ones the form does not show (e.g. which client a contact belongs to). */
  defaults?: Values;
  /** Called with the saved row, or null after a delete. */
  onDone?(saved: Row | null): void;
  canDelete?: boolean;
  deleteMessage?: string;
  title?: string;
}
interface EditorApi { open(o: OpenOpts): void }
const Ctx = createContext<EditorApi>({ open() {} });
export const useEditor = (): EditorApi => useContext(Ctx);

/** Records that can carry files (receipts, agreements, reports…): the entity name the files API uses. */
export const FILE_TYPE: Record<string, string> = {
  leads: 'lead', clients: 'client', projects: 'project', change_requests: 'change_request', expenses: 'expense', payments: 'payment', grants: 'grant', renewals: 'renewal',
  assets: 'asset', milestones: 'milestone', maintenance_logs: 'maintenance', tasks: 'task',
};

const SHARED_LOOKUPS = new Set(['clients', 'projects', 'accounts', 'leads', 'grants']);

const omitKey = ({ key: _k, ...rest }: OpenOpts & { key: number }): OpenOpts => rest;

export function EditorProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<(OpenOpts & { key: number }) | null>(null);
  const seq = useRef(0);
  const open = useCallback((o: OpenOpts) => setOpts({ ...o, key: ++seq.current }), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {opts && <RecordForm key={opts.key} {...omitKey(opts)} onClose={() => setOpts(null)} />}
    </Ctx.Provider>
  );
}

function initialValues(items: FormItem[], rec: Row | null | undefined, defaults?: Values): Values {
  const out: Values = {};
  const src: Values = rec ? { ...rec } : { ...defaults };
  if (rec && Array.isArray(rec.assignees)) src.assignee_ids = (rec.assignees as { id: number }[]).map((a) => a.id);
  if (!rec && defaults?.assignee_id && !defaults.assignee_ids) src.assignee_ids = [defaults.assignee_id];
  for (const it of items) {
    if (isSection(it)) continue;
    const v = src[it.name];
    out[it.name] = v ?? it.default ?? (it.type === 'people' ? [] : '');
  }
  return out;
}

function RecordForm({ resource, record, defaults, onDone, canDelete, deleteMessage, title, onClose }: OpenOpts & { onClose(): void }) {
  const session = useSession();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const items = useMemo(() => (FORMS[resource] ? FORMS[resource]({ lookups: session.lookups, isFounder: session.isFounder, rec: record ?? null }) : []), [resource, session.lookups, session.isFounder, record]);
  const fields = items.filter((i): i is FieldDef => !isSection(i));
  const [values, setValues] = useState<Values>(() => initialValues(items, record, defaults));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [extra, setExtra] = useState<'files' | 'history' | null>(null);
  const initial = useRef(JSON.stringify(values));
  const dirty = !saving && JSON.stringify(values) !== initial.current;
  const label = RESOURCE_LABEL[resource] ?? resource.replace(/_/g, ' ');
  const canDel = !!record && (canDelete ?? session.isFounder);
  const limitedTask = resource === 'tasks' && !!record && !session.isFounder;

  // payments: the invoice list follows the chosen client
  const clientId = resource === 'payments' ? values.client_id : null;
  const invoicesQ = useQuery({
    queryKey: ['form-invoices', clientId],
    queryFn: () => api.get<Row[]>(`/invoices${qs({ client_id: clientId, limit: 200 })}`),
    enabled: !!clientId,
  });
  const optionsFor = (name: string) => {
    if (resource === 'payments' && name === 'invoice_id') {
      return (invoicesQ.data ?? []).filter((i) => i.kind === 'invoice' && !['cancelled', 'draft'].includes(String(i.status)) || i.id === record?.invoice_id)
        .map((i) => ({ v: i.id, l: `${String(i.number)} — due ${money(Math.max(0, Number(i.total) - Number(i.paid_amount)))}` }));
    }
    return undefined;
  };

  const set = (name: string, v: unknown) => {
    setValues((x) => ({ ...x, [name]: v }));
    setErrors((e) => { if (!e[name]) return e; const { [name]: _drop, ...rest } = e; return rest; });
  };

  const save = async () => {
    const found = validate(resource, items, values);
    if (resource === 'leads' && !String(values.company ?? '').trim() && !String(values.name ?? '').trim() && !values.client_id) found.name = 'Enter a company, a person’s name, or pick an existing client.';
    if (Object.keys(found).length) {
      setErrors(found);
      const first = Object.keys(found)[0] as string;
      setFormError(found._form ?? (Object.keys(found).length === 1 ? (found[first] as string) : `Please fix ${Object.keys(found).length} fields.`));
      document.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setFormError('');
    const data: Values = {};
    for (const f of fields) {
      if (limitedTask && !['status', 'description'].includes(f.name)) continue;
      const v = values[f.name];
      data[f.name] = typeof v === 'string' && f.type !== 'textarea' && f.type !== 'password' ? v.trim() : v;
    }
    const shown = new Set(fields.map((f) => f.name));
    const hidden = record ? {} : Object.fromEntries(Object.entries(defaults ?? {}).filter(([k, v]) => !shown.has(k) && v != null && v !== ''));
    setSaving(true);
    try {
      const saved = record ? await api.put<Row>(`/${resource}/${record.id}`, data) : await api.post<Row>(`/${resource}`, { ...hidden, ...data });
      toast.ok(record ? 'Saved' : `${label.replace(/^./, (c) => c.toUpperCase())} created`);
      await qc.invalidateQueries();
      if (SHARED_LOOKUPS.has(resource)) await session.refreshLookups();
      onDone?.(saved);
      onClose();
    } catch (e) {
      setSaving(false);
      setFormError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    if (!record) return;
    if (!(await dialogs.confirm(deleteMessage ?? 'Delete this record? This cannot be undone.', { danger: true, okLabel: 'Delete' }))) return;
    try {
      await api.del(`/${resource}/${record.id}`);
      toast.ok('Deleted');
      await qc.invalidateQueries();
      if (SHARED_LOOKUPS.has(resource)) await session.refreshLookups();
      onDone?.(null);
      onClose();
    } catch (e) { setFormError(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const realFields = fields.length;
  const sub = record ? String(record.name ?? record.company ?? record.title ?? '') : FORM_INFO[resource];
  const formItems = limitedTask ? items.map((i) => (isSection(i) || ['status', 'description'].includes(i.name) ? i : { ...i, readonly: true })) : items;

  return (
    <Modal title={title ?? `${record ? 'Edit' : 'New'} ${label}`} sub={sub} size={realFields > 8 ? 'wide' : ''} dirty={dirty} onClose={onClose}
      footer={<>
        {canDel && <button type="button" className="btn ghost danger-text" style={{ marginRight: 'auto' }} onClick={() => void remove()}>Delete</button>}
        <span className="kbd-hint">Ctrl + Enter to save</span>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className={`btn primary ${saving ? 'busy' : ''}`} disabled={saving} onClick={() => void save()}>{record ? 'Save changes' : `Create ${label}`}</button>
      </>}>
      <form noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {record && record.ref != null && <p className="muted small" style={{ marginTop: 0 }}>System ID: <span className="ref">{String(record.ref)}</span></p>}
        {limitedTask && <p className="callout info" style={{ marginBottom: 16 }}>You can change the status and add progress details on your tasks.</p>}
        <FormGrid items={formItems} resource={resource} values={values} errors={errors} set={set} optionsFor={optionsFor} />
        {formError && <div className="callout err" role="alert" style={{ marginTop: 16 }}>{formError}</div>}
        <button type="submit" hidden />
      </form>
      {record && (
        <div className="rec-extra">
          <div className="seg" role="group" aria-label="More about this record">
            {FILE_TYPE[resource] && <button type="button" className={extra === 'files' ? 'on' : ''} onClick={() => setExtra(extra === 'files' ? null : 'files')}>Files</button>}
            <button type="button" className={extra === 'history' ? 'on' : ''} onClick={() => setExtra(extra === 'history' ? null : 'history')}>History</button>
          </div>
          {extra === 'files' && FILE_TYPE[resource] && <DocsPanel entityType={FILE_TYPE[resource] as string} entityId={Number(record.id)} />}
          {extra === 'history' && <HistoryPanel resource={resource} id={Number(record.id)} />}
        </div>
      )}
    </Modal>
  );
}
