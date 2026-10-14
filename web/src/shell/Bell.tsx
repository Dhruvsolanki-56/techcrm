import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';

interface Notif { id: number; text: string; link: string | null; read: number; at?: string; created_at?: string }
interface NotifData { unread: number; items: Notif[] }

export function ago(s: unknown): string {
  if (!s) return '';
  const t = new Date(String(s).replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(t)) return '';
  const sec = (Date.now() - t) / 1000;
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return fmtDate(new Date(t).toISOString());
}

export function useNotifications() {
  return useQuery({ queryKey: ['notifications'], queryFn: () => api.get<NotifData>('/notifications'), refetchInterval: 60_000, staleTime: 20_000 });
}

export function Bell() {
  const q = useNotifications();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const prev = useRef(0);
  const unread = q.data?.unread ?? 0;
  const items = q.data?.items ?? [];

  useEffect(() => {
    if (unread > prev.current) { setRing(true); const t = setTimeout(() => setRing(false), 1000); prev.current = unread; return () => clearTimeout(t); }
    prev.current = unread;
    return undefined;
  }, [unread]);

  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['notifications'] }); setOpen(false); },
  });

  return (
    <>
      <button ref={btn} type="button" className={`btn icon ghost bell${ring ? ' ring' : ''}`} data-bell aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((o) => !o); void q.refetch(); }}>
        <Icon name="bell" />{unread > 0 && <span className="bell-n" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <Popover anchor={btn.current} onClose={() => setOpen(false)} className="notifs" placement="below-end">
          <div role="dialog" aria-label="Notifications">
            <div className="pop-h"><span>Notifications</span>{unread > 0 && <button type="button" className="btn sm ghost" onClick={() => readAll.mutate()}>Mark all read</button>}</div>
            <div className="notif-list">
              {items.length ? items.map((n) => (
                <Link key={n.id} className={`notif ${n.read ? '' : 'unread'}`} to={n.link || '/dashboard'} onClick={() => setOpen(false)}>
                  {n.text}<div className="w">{ago(n.created_at ?? n.at)}</div>
                </Link>
              )) : <div className="empty mini iconic"><span className="em-i"><Icon name="bell" /></span><span>You are all caught up.</span></div>}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
