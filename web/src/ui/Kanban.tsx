import { useState, type ReactNode } from 'react';
import type { Row } from '../lib/api';

export interface KanbanCol { v: string; l: string; c?: string }

/** Drag-and-drop board. Cards are keyboard-reachable: Enter opens, and the column menu on each card is not needed because drops are optional. */
export function Kanban<T extends Row = Row>({ cols, items, group, card, onMove, onOpen, head }: {
  cols: KanbanCol[]; items: T[]; group(i: T): string; card(i: T): ReactNode; onMove?(item: T, to: string): void; onOpen?(item: T): void; head?(list: T[], c: KanbanCol): ReactNode;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="kanban">
      {cols.map((c) => {
        const list = items.filter((i) => group(i) === c.v);
        return (
          <div key={c.v} className={`kcol${over === c.v ? ' over' : ''}`}
            onDragOver={(e) => { if (onMove) { e.preventDefault(); setOver(c.v); } }} onDragLeave={() => setOver((o) => (o === c.v ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const it = items.find((i) => i.id === dragging); setDragging(null); if (it && group(it) !== c.v) onMove?.(it, c.v); }}>
            <div className="kcol-h"><span className="dot" style={{ ['--c' as string]: c.c ?? 'var(--faint)' }} /><span>{c.l}</span><span className="n">{list.length}</span><span className="sum">{head?.(list, c)}</span></div>
            <div className="kcol-b">
              {list.length ? list.map((i) => (
                <div key={i.id} className={`kcard${dragging === i.id ? ' dragging' : ''}`} draggable={!!onMove} tabIndex={0} role="button"
                  onDragStart={(e) => { setDragging(i.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i.id)); }} onDragEnd={() => { setDragging(null); setOver(null); }}
                  onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button')) onOpen?.(i); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen?.(i); }}>
                  {card(i)}
                </div>
              )) : <div className="kdrop">{onMove ? 'Drop here' : 'Nothing here'}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
