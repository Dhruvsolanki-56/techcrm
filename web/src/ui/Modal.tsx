import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

const stack: symbol[] = [];

interface ModalProps {
  title: string;
  sub?: string;
  size?: 'sm' | '' | 'wide' | 'xl';
  /** True when the form has unsaved changes: a click outside is ignored and Esc asks first. */
  dirty?: boolean;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  top?: boolean;
  bare?: boolean;
  locked?: boolean;
}

export function Modal({ title, sub, size = '', dirty, onClose, children, footer, top, bare, locked }: ModalProps) {
  const id = useRef(Symbol('modal'));
  const box = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const [nudge, setNudge] = useState(false);
  const dialogs = useDialogs();

  const tryClose = useCallback(async () => {
    if (locked) return;
    if (dirty && !(await dialogs.confirm('You have unsaved changes in this form.', { title: 'Discard changes?', okLabel: 'Discard', cancelLabel: 'Keep editing', danger: true }))) return;
    onClose();
  }, [dirty, locked, onClose, dialogs]);

  useEffect(() => {
    const me = id.current;
    stack.push(me);
    document.body.classList.add('modal-open');
    const prev = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('.modal-b input:not([type=hidden]):not([type=checkbox]):not([type=file]):not(:disabled), .modal-b textarea, .modal-b select');
    if (first && window.matchMedia?.('(pointer: fine)').matches) setTimeout(() => first.focus({ preventScroll: true }), 40);
    return () => {
      stack.splice(stack.indexOf(me), 1);
      if (!stack.length) document.body.classList.remove('modal-open');
      prev?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id.current) return;
      if (e.key === 'Escape') { e.preventDefault(); void tryClose(); return; }
      if (e.key !== 'Tab' || !box.current) return; // keep focus inside the dialog
      const f = [...box.current.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])')];
      if (!f.length) return;
      const a = f[0] as HTMLElement;
      const z = f[f.length - 1] as HTMLElement;
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tryClose]);

  return createPortal(
    <div className={`overlay dialog${top ? ' top' : ''}`}
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || !downOnBackdrop.current || locked) return;
        if (dirty) { setNudge(false); requestAnimationFrame(() => setNudge(true)); return; }
        onClose();
      }}>
      <div ref={box} className={`modal ${size}${nudge ? ' nudge' : ''}`} role="dialog" aria-modal="true" aria-label={title} onAnimationEnd={() => setNudge(false)}>
        {!bare && (
          <div className="modal-h">
            <div className="mh-t"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
            {!locked && <button type="button" className="btn ghost sm icon" aria-label="Close" onClick={() => void tryClose()}><Icon name="x" /></button>}
          </div>
        )}
        {bare ? children : <div className="modal-b">{children}</div>}
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- confirm / prompt boxes ---------- */
interface ConfirmOpts { okLabel?: string; cancelLabel?: string; title?: string; danger?: boolean }
interface DialogApi {
  confirm(message: string, opts?: ConfirmOpts): Promise<boolean>;
  prompt(title: string, label: string, value?: string, opts?: { multiline?: boolean; required?: boolean }): Promise<string | null>;
}
const Ctx = createContext<DialogApi>({ confirm: async () => false, prompt: async () => null });
export const useDialogs = (): DialogApi => useContext(Ctx);

type Pending =
  | { kind: 'confirm'; message: string; opts: ConfirmOpts; resolve(v: boolean): void }
  | { kind: 'prompt'; title: string; label: string; opts: { multiline?: boolean; required?: boolean }; resolve(v: string | null): void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [p, setP] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const api = useMemo<DialogApi>(() => ({
    confirm: (message, opts = {}) => new Promise((resolve) => setP({ kind: 'confirm', message, opts, resolve })),
    prompt: (title, label, value = '', opts = {}) => new Promise((resolve) => { setText(value); setP({ kind: 'prompt', title, label, opts, resolve }); }),
  }), []);
  const done = (v: boolean | string | null) => { if (p) (p.resolve as (x: unknown) => void)(v); setP(null); };
  return (
    <Ctx.Provider value={api}>
      {children}
      {p?.kind === 'confirm' && (
        <Modal title={p.opts.title ?? 'Are you sure?'} size="sm" onClose={() => done(false)}
          footer={<><button type="button" className="btn" onClick={() => done(false)}>{p.opts.cancelLabel ?? 'Cancel'}</button>
            <button type="button" className={`btn ${p.opts.danger ? 'danger' : 'primary'}`} onClick={() => done(true)} autoFocus>{p.opts.okLabel ?? 'Confirm'}</button></>}>
          <p className="pre muted">{p.message}</p>
        </Modal>
      )}
      {p?.kind === 'prompt' && (
        <Modal title={p.title} size="sm" onClose={() => done(null)}
          footer={<><button type="button" className="btn" onClick={() => done(null)}>Cancel</button>
            <button type="button" className="btn primary" onClick={() => { const v = text.trim(); if (p.opts.required && !v) return; done(v); }}>Save</button></>}>
          <label className="f"><span>{p.label}</span>
            {p.opts.multiline
              ? <textarea value={text} onChange={(e) => setText(e.target.value)} />
              : <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { const v = text.trim(); if (!(p.opts.required && !v)) done(v); } }} />}
          </label>
        </Modal>
      )}
    </Ctx.Provider>
  );
}
