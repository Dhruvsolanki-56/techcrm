import { DOC_CATEGORIES } from '@crm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { DateInput } from '../ui/DateInput';
import { useRef, useState } from 'react';
import { useEditor } from '../forms/RecordEditor';
import { api, ApiError, type Row } from '../lib/api';
import { fmtDate } from '../lib/format';
import { useSession } from '../lib/session';
import { DataTable, type Column } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Due, TextStatus } from '../ui/primitives';
import { useToast } from '../ui/Toasts';
import { LinkTo } from '../pages/common';

const ENTITY_ROUTE: Record<string, string> = { client: '/clients', project: '/projects', lead: '/leads', invoice: '/invoices', quote: '/quotes', grant: '/grants' };

const INLINE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'];
const fsize = (b: number): string => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function UploadModal({ entityType, entityId, onClose, category }: { entityType: string; entityId?: number | null; onClose(): void; category?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [f, setF] = useState({ title: '', url: '', category: category ?? 'Other', expiry_date: '', notes: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async () => {
    setErr('');
    setBusy(true);
    try {
      if (mode === 'link') {
        await api.post('/documents/link', { entity_type: entityType, entity_id: entityId || null, ...f });
        toast.ok('Link saved');
      } else {
        if (!file) { setErr('Choose a file first.'); setBusy(false); return; }
        const fd = new FormData();
        fd.append('entity_type', entityType);
        if (entityId) fd.append('entity_id', String(entityId));
        for (const k of ['title', 'category', 'notes', 'expiry_date'] as const) fd.append(k, f[k]);
        fd.append('file', file);
        await api.post('/documents/upload', fd);
        toast.ok('Uploaded');
      }
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal title="Add document" sub="Upload a file (up to 60 MB, stored on your own server) or save a link to one in Google Drive." onClose={onClose} dirty={!!(file || f.title || f.url)}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className={`btn primary ${busy ? 'busy' : ''}`} disabled={busy} onClick={() => void submit()}>{mode === 'link' ? 'Save link' : 'Upload'}</button></>}>
      <div className="seg" style={{ marginBottom: 14 }}>
        <button type="button" className={mode === 'file' ? 'on' : ''} onClick={() => setMode('file')}>Upload a file</button>
        <button type="button" className={mode === 'link' ? 'on' : ''} onClick={() => setMode('link')}>Save a link</button>
      </div>
      <div className="form-grid">
        {mode === 'file' ? (
          <div className="full">
            <label className={`drop${over ? ' over' : ''}${file ? ' has' : ''}`}
              onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); const dropped = e.dataTransfer.files[0]; if (dropped) setFile(dropped); }}>
              <input ref={input} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <span className="drop-i"><Icon name="upload" /></span>
              <span className="drop-t">Drop a file here, or <u>choose one</u></span>
              <span className="drop-s">{file ? `${file.name} · ${fsize(file.size)}` : 'PDF, images, Word, Excel, ZIP…'}</span>
            </label>
          </div>
        ) : (
          <label className="f full"><span>Link <i>*</i></span><input inputMode="url" placeholder="https://drive.google.com/…" value={f.url} onChange={set('url')} /></label>
        )}
        <label className="f full"><span>Title</span><input placeholder={mode === 'link' ? 'e.g. Signed NDA — Acme' : 'Defaults to the file name'} value={f.title} onChange={set('title')} /></label>
        <label className="f"><span>Category</span>
          <select value={f.category} onChange={set('category')}>{DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="f"><span>Expires on</span><DateInput value={f.expiry_date} onChange={set('expiry_date')} /></label>
        <label className="f full"><span>Notes</span><input value={f.notes} onChange={set('notes')} /></label>
      </div>
      {err && <div className="callout err" role="alert" style={{ marginTop: 14 }}>{err}</div>}
    </Modal>
  );
}

/** Document list columns; `entity` adds the "linked to" column used on the global page. */
export function useDocColumns(showEntity: boolean): Column[] {
  const { isFounder, user } = useSession();
  const editor = useEditor();
  return [
    {
      key: 'title', label: 'Document Name', sort: 'title',
      render: (r) => (
        <div className="who">
          {r.url ? <span className="fk" style={{ ['--fk' as string]: 'var(--blue)' }}><Icon name="link" /></span>
            : <span className="logo-sq sm" style={{ ['--a-bg' as string]: '#f1f0ec', ['--a-fg' as string]: '#5b574e', fontSize: 9 }}>{(String(r.filename).split('.').pop() ?? 'FILE').toUpperCase().slice(0, 4)}</span>}
          <div style={{ minWidth: 0 }}>
            <div className="t1 ellipsis">{String(r.title)}</div>
            <div className="t2 ellipsis">{r.url ? String(r.url).replace(/^https?:\/\//, '').slice(0, 60) : `${String(r.filename)} · ${fsize(Number(r.size))}`}{r.expiry_date ? <> · expires <Due date={r.expiry_date} /></> : null}</div>
          </div>
        </div>
      ),
    },
    { key: 'category', label: 'Category', sort: 'category', render: (r) => <span className="tag">{String(r.category ?? 'Other')}</span> },
    ...(showEntity ? [{ key: 'entity_name', label: 'Linked to', render: (r: Row) => (r.entity_type === 'general' ? <span className="muted">Company</span> : <><span className="muted">{String(r.entity_type)}</span> {ENTITY_ROUTE[String(r.entity_type)] && r.entity_id ? <LinkTo to={`${ENTITY_ROUTE[String(r.entity_type)]}/${String(r.entity_id)}`}>{String(r.entity_name ?? '—')}</LinkTo> : String(r.entity_name ?? '—')}</>) } as Column] : []),
    ...(isFounder ? [{ key: 'status', label: 'Status', cls: 'opt', render: (r: Row) => <TextStatus value={r.status} /> } as Column, { key: 'owner_name', label: 'Owner', cls: 'opt', render: (r: Row) => (r.owner_name ? String(r.owner_name) : <span className="faint">—</span>) } as Column] : []),
    { key: 'created_at', label: 'Uploaded', cls: 'nowrap', sort: 'created_at', render: (r) => <>{fmtDate(r.created_at)}<div className="t2">{String(r.uploader_name ?? '')}</div></> },
    {
      key: '_a', label: '', cls: 'nowrap right',
      render: (r) => (
        <>
          {r.url ? <a className="btn sm" href={String(r.url)} target="_blank" rel="noopener noreferrer"><Icon name="arrowUpRight" />Open</a> : (
            <>
              {INLINE_MIME.includes(String(r.mime)) && <a className="btn sm" href={`/api/files/${r.id}?inline=1`} target="_blank" rel="noopener"><Icon name="eye" />View</a>}{' '}
              <a className="btn sm icon" href={`/api/files/${r.id}`} title="Download" aria-label="Download"><Icon name="download" /></a>
            </>
          )}{' '}
          {(isFounder || r.uploaded_by === user.id) && <button type="button" className="btn sm icon ghost" title="Edit" aria-label="Edit document" onClick={() => editor.open({ resource: 'documents', record: r, canDelete: true })}><Icon name="edit" /></button>}
        </>
      ),
    },
  ];
}

export function DocsPanel({ entityType, entityId, canUpload = true }: { entityType: string; entityId: number; canUpload?: boolean }) {
  const [open, setOpen] = useState(false);
  const cols = useDocColumns(false);
  return (
    <>
      <DataTable resource="documents" query={{ entity_type: entityType, entity_id: entityId }} columns={cols} compact noRef searchPlaceholder="Search files…" noun="file"
        toolbar={canUpload ? <button type="button" className="btn primary" onClick={() => setOpen(true)}><Icon name="upload" />Upload</button> : null}
        empty={{ title: 'No files yet', text: 'Contracts, specs, designs, KYC, meeting notes — keep them all here.' }} />
      {open && <UploadModal entityType={entityType} entityId={entityId} onClose={() => setOpen(false)} />}
    </>
  );
}
