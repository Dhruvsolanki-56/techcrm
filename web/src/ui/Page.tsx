import { useEffect, type ReactNode } from 'react';
import { useSession } from '../lib/session';
import { PageHeader } from './primitives';

/** The standard page frame: sticky header (breadcrumb + actions + bell), optional title block, then the content. */
export function Page({ title, sub, actions, crumbs, children, doc }: {
  title: string; sub?: ReactNode; actions?: ReactNode; crumbs?: ReactNode; children: ReactNode; doc?: string;
}) {
  const { lookups } = useSession();
  useEffect(() => { document.title = `${doc ?? title} · ${String(lookups.settings.company_name ?? 'CRM')}`; }, [doc, title, lookups.settings.company_name]);
  return (
    <div id="page">
      <PageHeader crumbs={crumbs ?? <b>{title}</b>} actions={actions} />
      {!crumbs && <div className="pt"><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div></div>}
      {children}
    </div>
  );
}

export const SectionH = ({ title, right }: { title: ReactNode; right?: ReactNode }) => <div className="section-h"><h2>{title}</h2>{right}</div>;
