import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A small menu anchored to a button. Closes on outside click or Escape. */
export function Popover({ anchor, onClose, children, className = '', placement = 'below' }: {
  anchor: HTMLElement | null; onClose(): void; children: ReactNode; className?: string; placement?: 'below' | 'below-end' | 'above' | 'right';
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -999, top: -999 });

  useLayoutEffect(() => {
    if (!anchor || !box.current) return;
    const r = anchor.getBoundingClientRect();
    const w = box.current.offsetWidth;
    const h = box.current.offsetHeight;
    let left = placement === 'right' ? r.right + 8 : placement === 'below-end' ? r.right - w : r.left;
    let top = placement === 'right' ? r.top : placement === 'above' ? r.top - h - 6 : r.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    setPos({ left, top });
  }, [anchor, placement, children]);

  useEffect(() => {
    const off = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [anchor, onClose]);

  return createPortal(<div ref={box} className={`popover ${className}`} style={pos}>{children}</div>, document.body);
}
