import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEditor } from '../forms/RecordEditor';
import { api, qs } from '../lib/api';
import { useSession } from '../lib/session';
import { useDebounced } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { visibleNav } from './nav';

interface Item { group: string; type: string; title: string; sub?: string; icon?: string; link?: string; run?(): void }
const TYPE_ICON: Record<string, string> = { Client: 'building', Contact: 'users', Lead: 'target', Project: 'briefcase', Task: 'check', Invoice: 'receipt', Quote: 'file', Document: 'folder', Renewal: 'refresh', Credential: 'lock', 'Change request': 'edit' };

export function Palette({ onClose }: { onClose(): void }) {
  const { isFounder, can, user } = useSession();
  const editor = useEditor();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 160);
  const [found, setFound] = useState<Item[]>([]);
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const base = useMemo<Item[]>(() => {
    const t = q.trim().toLowerCase();
    const creates: (Item | false)[] = [
      can('leads') && { group: 'Actions', type: 'Create', title: 'New lead', icon: 'plus', run: () => editor.open({ resource: 'leads', defaults: { owner_id: user.id }, onDone: (l) => l && nav(`/leads/${l.id}`) }) },
      { group: 'Actions', type: 'Create', title: 'New task', icon: 'plus', run: () => editor.open({ resource: 'tasks', defaults: { assignee_id: user.id } }) },
      isFounder && { group: 'Actions', type: 'Create', title: 'New client', icon: 'plus', run: () => editor.open({ resource: 'clients', onDone: (c) => c && nav(`/clients/${c.id}`) }) },
      isFounder && { group: 'Actions', type: 'Create', title: 'New project', icon: 'plus', run: () => editor.open({ resource: 'projects', defaults: { manager_id: user.id }, onDone: (p) => p && nav(`/projects/${p.id}`) }) },
      { group: 'Actions', type: 'Create', title: 'New change request', icon: 'plus', run: () => editor.open({ resource: 'change_requests' }) },
      isFounder && { group: 'Actions', type: 'Create', title: 'New invoice', icon: 'plus', link: '/invoices/new' },
      isFounder && { group: 'Actions', type: 'Create', title: 'New quotation', icon: 'plus', link: '/quotes/new' },
      isFounder && { group: 'Actions', type: 'Create', title: 'Record expense', icon: 'plus', run: () => editor.open({ resource: 'expenses' }) },
    ];
    const jumps: Item[] = visibleNav(isFounder, can).flatMap((g) => g.items.map((i) => ({ group: 'Navigate', type: 'Go to', title: i.label, icon: i.icon, link: i.to })));
    return [...creates.filter((x): x is Item => !!x), ...jumps].filter((x) => !t || x.title.toLowerCase().includes(t));
  }, [q, can, isFounder, editor, nav, user.id]);

  useEffect(() => {
    if (dq.length < 2) { setFound([]); return; }
    let live = true;
    api.get<Item[]>(`/search${qs({ q: dq })}`).then((r) => { if (live) setFound(r.map((x) => ({ ...x, group: 'Records' }))); }).catch(() => undefined);
    return () => { live = false; };
  }, [dq]);

  const items = useMemo(() => [...(q.trim().length >= 2 ? found : []), ...base], [found, base, q]);
  useEffect(() => setSel(0), [q, found.length]);
  useEffect(() => { list.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const go = (it?: Item) => {
    if (!it) return;
    onClose();
    if (it.run) it.run(); else if (it.link) nav(it.link);
  };
  let last = '';
  return (
    <Modal title="Search" bare top onClose={onClose}>
      <div className="palette">
        <input autoFocus placeholder="Search clients, projects, invoices, files… or type a command" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); }
          }} />
        <div className="pal-list" ref={list}>
          {items.length ? items.map((it, i) => {
            const head = it.group !== last ? <div className="pal-h" key={`h${i}`}>{it.group}</div> : null;
            last = it.group;
            return (
              <div key={i}>
                {head}
                <div className={`pal-i ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
                  <Icon name={it.icon ?? TYPE_ICON[it.type] ?? 'arrowR'} />
                  <span className="grow" style={{ minWidth: 0 }}><div className="ellipsis">{it.title}</div>{it.sub && <div className="sb">{it.sub}</div>}</span>
                  <span className="ty">{it.type}</span>
                </div>
              </div>
            );
          }) : <div className="empty mini">No results</div>}
        </div>
        <div className="pal-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>
      </div>
    </Modal>
  );
}
