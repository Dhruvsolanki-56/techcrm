import { useState } from 'react';
import { CredentialsPanel } from '../components/Credentials';
import { useDebounced } from '../ui/DataTable';
import { Page } from '../ui/Page';

export default function Vault() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  return (
    <Page title="Credentials" sub="Hosting, server, database and admin logins for client sites. Passwords are encrypted, and every reveal is written to the activity log.">
      <div className="toolbar"><input type="search" placeholder="Search label, URL, username, client…" aria-label="Search credentials" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <CredentialsPanel q={dq || undefined} />
    </Page>
  );
}
