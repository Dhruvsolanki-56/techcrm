import { Link, useNavigate, useParams } from 'react-router-dom';
import { CredentialsPanel } from '../components/Credentials';
import { DocsPanel } from '../components/Docs';
import { ExpensesTable, InvoicesTable, MaintenanceTable, PaymentsTable, QuotesTable } from '../components/FinanceTables';
import { Notes } from '../components/Notes';
import { Highlights, Hl, Meta, Prop, PropsSec, Record, RecHead } from '../components/record';
import { useEditor } from '../forms/RecordEditor';
import type { Row } from '../lib/api';
import { fmtDate, money } from '../lib/format';
import { useGet, useParam, useRecord } from '../lib/hooks';
import { useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Page, SectionH } from '../ui/Page';
import { Avatar, Badge, Crumb, Empty, ErrorBox, ExtLink, Panel, Skeleton, Tabs, Who } from '../ui/primitives';
import { RenewalsTable } from './Renewals';
import { ProjectsTable } from './Projects';

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { isFounder, can } = useSession();
  const editor = useEditor();
  const q = useRecord('clients', id);
  const contacts = useGet<Row[]>(id ? '/contacts' : null, { client_id: id, limit: 100 });
  const projects = useGet<Row[]>(id ? '/projects' : null, { client_id: id, limit: 100 });
  const [tab, setTab] = useParam('tab', 'projects');

  if (q.isPending) return <div id="page"><Skeleton kind="record" /></div>;
  if (q.isError) return <div id="page"><ErrorBox error={q.error} retry={() => void q.refetch()} /></div>;
  const c = q.data as Row;
  const cid = Number(c.id);
  const people = contacts.data ?? [];
  const links = (projects.data ?? []).filter((p) => p.live_url || p.staging_url || p.repo_url || p.design_url || p.tech_stack);
  const tabs = [
    { key: 'projects', label: 'Projects' },
    { key: 'activity', label: 'Activity' },
    ...(isFounder ? [{ key: 'billing', label: 'Quotes, invoices & payments' }] : []),
    { key: 'files', label: 'Files' },
    ...(isFounder ? [{ key: 'vault', label: 'Credentials' }] : []),
    ...(can('maintenance') ? [{ key: 'care', label: isFounder ? 'Maintenance & renewals' : 'Maintenance' }] : []),
  ];

  return (
    <Page title={String(c.company)} crumbs={<><Crumb to="/clients">Clients</Crumb><b>{String(c.company)}</b></>}
      actions={isFounder ? (
        <>
          <button type="button" className="btn" onClick={() => nav(`/invoices/new?client=${cid}`)}><Icon name="plus" />Invoice</button>
          <button type="button" className="btn" onClick={() => editor.open({ resource: 'clients', record: c, onDone: (r) => { if (!r) nav('/clients'); } })}><Icon name="edit" />Edit</button>
        </>
      ) : undefined}>
      <Record
        main={<>
          <RecHead name={String(c.company)} refId={c.ref} meta={<><Badge value={c.status} />{c.industry ? <Meta>{String(c.industry)}</Meta> : null}{c.city ? <Meta>{String(c.city)}</Meta> : null}</>} />
          <Highlights>
            {isFounder && <Hl label="Received to date" value={money(c.lifetime_received)} />}
            {isFounder && <Hl label="Outstanding" value={money(c.outstanding)} sub={Number(c.outstanding) > 0 ? 'Unpaid invoices' : 'All settled'} tone={Number(c.outstanding) > 0 ? 'bad' : ''} />}
            <Hl label="Projects" value={String(c.project_count)} sub={Number(c.active_projects) ? `${c.active_projects} active` : ''} />
            <Hl label="Client since" value={fmtDate(c.created_at).replace(/ \d{4}$/, '')} sub={fmtDate(c.created_at).slice(-4)} />
          </Highlights>
          <Tabs tabs={tabs} active={tabs.some((t) => t.key === tab) ? tab : 'projects'} onChange={setTab} />
          <div style={{ marginTop: 18 }}>
            {tab === 'projects' && (
              <div className="stack">
                <ProjectsTable clientId={cid} />
                <Panel title="Repositories & links" bodyClass="">
                  {links.length ? (
                    <div className="list">
                      {links.map((p) => (
                        <div className="li" key={p.id}>
                          <div className="grow"><div className="t"><Link to={`/projects/${p.id}`}>{String(p.name)}</Link> <span className="ref">{String(p.ref ?? '')}</span></div><div className="s">{String(p.tech_stack ?? 'Tech stack not set')}</div></div>
                          <div className="row wrap" style={{ gap: 6 }}>
                            {([['Live', p.live_url], ['Staging', p.staging_url], ['Repository', p.repo_url], ['Design', p.design_url]] as [string, unknown][]).filter(([, u]) => u).map(([l, u]) => (
                              <a key={l} className="btn sm" href={/^https?:\/\//.test(String(u)) ? String(u) : `https://${String(u)}`} target="_blank" rel="noopener noreferrer"><Icon name="arrowUpRight" />{l}</a>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : <Empty mini icon="link">No links yet. Open a project and add its live site, GitHub repository or design file — they will appear here.</Empty>}
                </Panel>
              </div>
            )}
            {tab === 'activity' && <Notes type="client" id={cid} />}
            {tab === 'billing' && isFounder && (
              <div className="stack">
                <div><SectionH title="Quotations" /><QuotesTable query={{ client_id: cid }} compact /></div>
                <div><SectionH title="Invoices" /><InvoicesTable query={{ client_id: cid }} clientId={cid} compact /></div>
                <div><SectionH title="Payments received" /><PaymentsTable query={{ client_id: cid }} compact defaults={{ client_id: cid }} /></div>
                <div><SectionH title="Expenses billed to this client" /><ExpensesTable query={{ client_id: cid }} compact defaults={{ client_id: cid }} /></div>
              </div>
            )}
            {tab === 'files' && <DocsPanel entityType="client" entityId={cid} canUpload={isFounder} />}
            {tab === 'vault' && isFounder && <CredentialsPanel client_id={cid} />}
            {tab === 'care' && (
              <div className="stack">
                <div><SectionH title="Work log" /><MaintenanceTable query={{ client_id: cid }} compact defaults={{ client_id: cid }} /></div>
                {isFounder && <div><SectionH title="Maintenance plans, domains & hosting" /><RenewalsTable query={{ client_id: cid }} compact defaults={{ client_id: cid }} /></div>}
              </div>
            )}
          </div>
        </>}
        side={<>
          <PropsSec title="Details">
            <Prop label="Status"><Badge value={c.status} /></Prop>
            <Prop label="Manager">{c.manager_name ? <Who name={c.manager_name} /> : null}</Prop>
            <Prop label="Industry">{c.industry ? String(c.industry) : null}</Prop>
            <Prop label="Website">{c.website ? <ExtLink url={c.website} /> : null}</Prop>
            <Prop label="GSTIN">{c.gstin ? <span className="mono">{String(c.gstin)}</span> : null}</Prop>
            <Prop label="PAN">{c.pan ? <span className="mono">{String(c.pan)}</span> : null}</Prop>
            <Prop label="Address">{[c.address, c.city, c.state, c.country].filter(Boolean).join(', ') || null}</Prop>
            <Prop label="Tags">{c.tags ? String(c.tags) : null}</Prop>
          </PropsSec>
          <PropsSec title={`People · ${people.length}`} action={isFounder ? <button type="button" className="btn sm ghost" onClick={() => editor.open({ resource: 'contacts', defaults: { client_id: cid, is_primary: people.length ? 0 : 1 } })}>Add</button> : null}>
            {people.length ? people.map((p) => (
              <div className="person" key={p.id} style={isFounder ? { cursor: 'pointer' } : undefined} onClick={() => isFounder && editor.open({ resource: 'contacts', record: p, canDelete: true })}>
                <Avatar name={p.name} size="lg" />
                <div style={{ minWidth: 0 }}>
                  <div className="n">{String(p.name)} {p.is_primary ? <span className="tag accent" style={{ height: 17, fontSize: 10.5 }}>Main</span> : null}</div>
                  <div className="r">{String(p.role ?? '')}</div>
                  <div className="r">
                    {p.email ? <a className="ln" href={`mailto:${String(p.email)}`} onClick={(e) => e.stopPropagation()}>{String(p.email)}</a> : null}{p.email && p.phone ? ' · ' : ''}
                    {p.phone ? <a className="ln" href={`tel:${String(p.phone)}`} onClick={(e) => e.stopPropagation()}>{String(p.phone)}</a> : null}
                  </div>
                </div>
              </div>
            )) : <div className="faint small">No contacts yet.</div>}
          </PropsSec>
          {c.notes ? <PropsSec title="Internal notes"><div className="doc-text pre">{String(c.notes)}</div></PropsSec> : null}
        </>} />
    </Page>
  );
}
