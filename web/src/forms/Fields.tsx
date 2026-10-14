import { check, checkDates, kindFor, RULES, validDate } from '@crm/shared';
import { useId } from 'react';
import { useSession, type Lookups } from '../lib/session';
import { Avatar } from '../ui/primitives';
import { isSection, type FieldDef, type FormItem, type LookupName, type OptionList } from './schema';

export type Values = Record<string, unknown>;
export type Errors = Record<string, string>;

export function lookupOptions(lookups: Lookups, name: LookupName): { v: string | number; l: string }[] {
  switch (name) {
    case 'users': return lookups.users.map((u) => ({ v: u.id, l: u.name }));
    case 'clients': return lookups.clients.map((c) => ({ v: c.id, l: c.company }));
    case 'projects': return lookups.projects.map((p) => ({ v: p.id, l: p.name }));
    case 'accounts': return lookups.accounts.map((a) => ({ v: a.id, l: a.name }));
    case 'grants': return lookups.grants.map((g) => ({ v: g.id, l: g.name }));
    case 'leads': return lookups.leads.map((l) => ({ v: l.id, l: l.name + (l.company ? ` — ${l.company}` : '') }));
  }
}
const normOpts = (opts: OptionList): { v: string; l: string }[] => opts.map((o) => (typeof o === 'string' ? { v: o, l: o } : { v: o[0], l: o[1] }));

interface FieldProps {
  f: FieldDef;
  resource: string;
  value: unknown;
  error?: string;
  onChange(v: unknown): void;
  /** Options overriding the schema (e.g. invoices for the chosen client). */
  options?: { v: string | number; l: string }[];
}

/** One labelled input, with its inline error and help text. */
export function Field({ f, resource, value, error, onChange, options }: FieldProps) {
  const { lookups } = useSession();
  const id = `fld-${useId().replace(/:/g, '')}`;
  const kind = kindFor(resource, f.name) || (f.type === 'money' ? 'money' : '');
  const rule = kind ? RULES[kind] : undefined;
  const textRule = rule && !rule.num ? rule : undefined;
  const v = value ?? '';
  const cls = error ? 'invalid' : undefined;
  const common = { id, name: f.name, 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-err` : undefined, className: cls, readOnly: f.readonly } as const;
  const err = <div className={`f-err${error ? ' on' : ''}`} id={`${id}-err`} role="alert">{error}</div>;
  const help = f.help ? <div className="hint">{f.help}</div> : null;

  if (f.type === 'checkbox') {
    return (
      <label className={`check ${f.full ? 'full' : ''}`}>
        <input type="checkbox" id={id} name={f.name} checked={v === 1 || v === true || v === '1'} onChange={(e) => onChange(e.target.checked)} />
        <span>{f.label}{help}</span>
      </label>
    );
  }
  if (f.type === 'people') {
    const on = new Set(((Array.isArray(value) ? value : value ? [value] : []) as unknown[]).map(String));
    const opts = lookupOptions(lookups, f.lookup ?? 'users');
    return (
      <div className={`f ${f.full ? 'full' : ''}`} role="group" aria-labelledby={`${id}-l`}>
        <span id={`${id}-l`}>{f.label}</span>
        <div className="people-pick">
          {opts.map((o) => (
            <label className="pp" key={o.v}>
              <input type="checkbox" checked={on.has(String(o.v))} onChange={(e) => {
                const next = new Set(on);
                if (e.target.checked) next.add(String(o.v)); else next.delete(String(o.v));
                onChange([...next].map(Number));
              }} />
              <Avatar name={o.l} size="sm" /><span>{o.l}</span>
            </label>
          ))}
        </div>
        {help}
      </div>
    );
  }

  let input;
  if (f.type === 'textarea') {
    input = <textarea {...common} rows={f.rows ?? 3} placeholder={f.placeholder} value={String(v)} onChange={(e) => onChange(e.target.value)} />;
  } else if (f.type === 'select') {
    const opts = options ?? (f.lookup ? lookupOptions(lookups, f.lookup) : normOpts(f.options ?? []));
    const needsChoice = f.required && !f.blank;
    input = (
      <select {...common} value={String(v)} onChange={(e) => onChange(e.target.value)}>
        {needsChoice ? (v === '' ? <option value="" disabled hidden>Choose…</option> : null) : <option value="">{f.blank ?? '—'}</option>}
        {opts.map((o) => <option key={o.v} value={String(o.v)}>{o.l}</option>)}
      </select>
    );
  } else if (f.type === 'money' || f.type === 'number') {
    input = <input {...common} type="number" inputMode="decimal" step={f.type === 'money' ? '0.01' : 'any'} min={rule?.num ? rule.min : undefined} placeholder={f.placeholder} value={String(v)} onChange={(e) => onChange(e.target.value)} />;
  } else {
    const t = f.type ?? 'text';
    input = (
      <input {...common} type={t} placeholder={f.placeholder} maxLength={textRule?.max} inputMode={textRule?.inputmode as 'tel' | 'email' | 'url' | undefined}
        autoComplete={t === 'password' ? 'new-password' : 'off'} style={textRule?.upper ? { textTransform: 'uppercase' } : undefined}
        value={String(v)} onChange={(e) => {
          let nv = e.target.value;
          if (textRule?.block) nv = nv.replace(textRule.block, '');
          onChange(nv);
        }} />
    );
  }
  return (
    <label className={`f ${f.full ? 'full' : ''}`}>
      <span>{f.label}{f.required && <i> *</i>}</span>
      {input}
      {err}
      {help}
    </label>
  );
}

/** Same rules as the server: required, number/date shape, field rules, date order. */
export function validate(resource: string, items: FormItem[], values: Values): Errors {
  const errors: Errors = {};
  for (const it of items) {
    if (isSection(it) || it.type === 'checkbox' || it.type === 'people') continue;
    const v = values[it.name];
    const empty = v == null || String(v).trim() === '';
    if (it.required && empty) { errors[it.name] = `${it.label} is required.`; continue; }
    if (empty) continue;
    if (it.type === 'date' && !validDate(v)) { errors[it.name] = `${it.label} is not a real date.`; continue; }
    const kind = kindFor(resource, it.name) || (it.type === 'money' ? 'money' : '');
    const msg = kind ? check(kind, typeof v === 'string' ? v.trim() : v) : '';
    if (msg) errors[it.name] = `${it.label} ${msg}.`;
  }
  const dmsg = checkDates(resource, values);
  if (dmsg && !Object.keys(errors).length) errors._form = dmsg;
  return errors;
}

export function FormGrid({ items, resource, values, errors, set, optionsFor }: {
  items: FormItem[]; resource: string; values: Values; errors: Errors; set(name: string, v: unknown): void; optionsFor?(name: string): { v: string | number; l: string }[] | undefined;
}) {
  return (
    <div className="form-grid">
      {items.map((it, i) => (isSection(it)
        ? <div className="fsec" key={`s${i}`}><b>{it.section}</b>{it.hint && <span>{it.hint}</span>}</div>
        : <Field key={it.name} f={it} resource={resource} value={values[it.name]} error={errors[it.name]} onChange={(v) => set(it.name, v)} options={optionsFor?.(it.name)} />))}
    </div>
  );
}
