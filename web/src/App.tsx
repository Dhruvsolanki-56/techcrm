import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { EditorProvider } from './forms/RecordEditor';
import { SessionProvider, useAuthState } from './lib/session';
import { AuthScreen } from './shell/AuthScreen';
import { Layout } from './shell/Layout';
import { Empty, ErrorBox } from './ui/primitives';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = (load: () => Promise<{ default: React.ComponentType<any> }>) => lazy(load);
const Dashboard = page(() => import('./pages/Dashboard'));
const ActionCenter = page(() => import('./pages/ActionCenter'));
const Tasks = page(() => import('./pages/Tasks'));
const Calendar = page(() => import('./pages/Calendar'));
const Leads = page(() => import('./pages/Leads'));
const LeadDetail = page(() => import('./pages/LeadDetail'));
const Followups = page(() => import('./pages/Followups'));
const ContactLog = page(() => import('./pages/ContactLog'));
const Analytics = page(() => import('./pages/Analytics'));
const GrantDetail = page(() => import('./pages/GrantDetail'));
const Clients = page(() => import('./pages/Clients'));
const ClientDetail = page(() => import('./pages/ClientDetail'));
const Quotes = page(() => import('./pages/Quotes'));
const Invoices = page(() => import('./pages/Invoices'));
const DocumentEditor = page(() => import('./pages/DocumentEditor'));
const Projects = page(() => import('./pages/Projects'));
const ProjectDetail = page(() => import('./pages/ProjectDetail'));
const ChangeRequests = page(() => import('./pages/ChangeRequests'));
const Maintenance = page(() => import('./pages/Maintenance'));
const Documents = page(() => import('./pages/Documents'));
const Renewals = page(() => import('./pages/Renewals'));
const Grants = page(() => import('./pages/Grants'));
const Finance = page(() => import('./pages/Finance'));
const Assets = page(() => import('./pages/Assets'));
const Vault = page(() => import('./pages/Vault'));
const Team = page(() => import('./pages/Team'));
const Settings = page(() => import('./pages/Settings'));
const Audit = page(() => import('./pages/Audit'));

function NotFound() {
  return <div id="page"><Empty title="Page not found">This page does not exist.</Empty></div>;
}

export function App() {
  const auth = useAuthState();
  if (auth.isPending) return <div className="auth"><div className="empty">Loading…</div></div>;
  if (auth.isError) return <div className="auth"><ErrorBox error={auth.error} retry={() => void auth.refetch()} /></div>;
  const state = auth.data;
  if (state.setup_needed || !state.user) return <AuthScreen state={state} />;
  return (
    <SessionProvider user={state.user}>
      <EditorProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="actions" element={<ActionCenter />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="leads" element={<Leads />} />
            <Route path="leads/:id" element={<LeadDetail />} />
            <Route path="followups" element={<Followups />} />
            <Route path="contact-log" element={<ContactLog />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="sales-report" element={<Navigate to="/analytics?tab=sales" replace />} />
            <Route path="clients" element={<Clients />} />
            <Route path="clients/:id" element={<ClientDetail />} />
            <Route path="quotes" element={<Quotes />} />
            <Route path="quotes/:id" element={<DocumentEditor kind="quotes" />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="invoices/:id" element={<DocumentEditor kind="invoices" />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="change-requests" element={<ChangeRequests />} />
            <Route path="maintenance" element={<Maintenance />} />
            <Route path="documents" element={<Documents />} />
            <Route path="renewals" element={<Renewals />} />
            <Route path="grants" element={<Grants />} />
            <Route path="grants/:id" element={<GrantDetail />} />
            <Route path="finance" element={<Finance />} />
            <Route path="assets" element={<Assets />} />
            <Route path="vault" element={<Vault />} />
            <Route path="team" element={<Team />} />
            <Route path="settings" element={<Settings />} />
            <Route path="audit" element={<Audit />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </EditorProvider>
    </SessionProvider>
  );
}
