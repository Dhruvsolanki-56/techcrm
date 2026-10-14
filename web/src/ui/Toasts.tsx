import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ToastItem { id: number; msg: string; err: boolean; out: boolean }
interface ToastApi { ok(msg: string): void; err(msg: string): void; fail(e: unknown): void }
const Ctx = createContext<ToastApi>({ ok() {}, err() {}, fail() {} });
export const useToast = (): ToastApi => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((msg: string, err: boolean) => {
    const id = ++seq.current;
    setItems((x) => [...x.slice(-2), { id, msg, err, out: false }]);
    setTimeout(() => setItems((x) => x.map((t) => (t.id === id ? { ...t, out: true } : t))), err ? 6000 : 2800);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), err ? 6200 : 3000);
  }, []);
  const api = useMemo<ToastApi>(() => ({
    ok: (m) => push(m, false),
    err: (m) => push(m, true),
    fail: (e) => push(e instanceof Error ? e.message : String(e), true),
  }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast${t.err ? ' err' : ''}${t.out ? ' out' : ''}`} role={t.err ? 'alert' : 'status'}>
            <Icon name={t.err ? 'alert' : 'check'} />{t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
