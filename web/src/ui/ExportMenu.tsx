import { useRef, useState } from 'react';
import { qs } from '../lib/api';
import { Icon } from './Icon';
import { Popover } from './Popover';

/** Download what is on screen (same filters, search and order) as an Excel sheet or a PDF. Never CSV. */
export function ExportMenu({ path, params = {}, label = 'Export' }: { path: string; params?: Record<string, unknown>; label?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const q = qs(Object.fromEntries(Object.entries(params).filter(([k]) => !['limit', 'offset'].includes(k))));
  return (
    <>
      <button ref={btn} type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Icon name="download" />{label}<Icon name="chevDown" /></button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} className="narrow" placement="below-end">
          <a className="menu-i" role="menuitem" href={`/api${path}.xlsx${q}`} download onClick={() => setOpen(false)}><Icon name="file" />Excel (.xlsx)</a>
          <a className="menu-i" role="menuitem" href={`/api${path}.pdf${q}`} download onClick={() => setOpen(false)}><Icon name="receipt" />PDF</a>
        </Popover>
      )}
    </>
  );
}
