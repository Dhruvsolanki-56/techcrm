import { DOC_CATEGORIES } from '@crm/shared';
import { useState } from 'react';
import { UploadModal, useDocColumns } from '../components/Docs';
import { DataTable } from '../ui/DataTable';
import { Icon } from '../ui/Icon';
import { Page } from '../ui/Page';
import { useSession } from '../lib/session';

export default function Documents() {
  const { isFounder } = useSession();
  const cols = useDocColumns(true);
  const [open, setOpen] = useState(false);
  return (
    <Page title="Documents" sub="Contracts, specs, designs and KYC — files you uploaded and links to Drive."
      actions={isFounder ? <button type="button" className="btn primary" onClick={() => setOpen(true)}><Icon name="upload" />Add document</button> : undefined}>
      <DataTable resource="documents" columns={cols} searchPlaceholder="Search documents…" noun="document" defaultSort="created_at:desc"
        filters={[{ key: 'category', label: 'All categories', options: DOC_CATEGORIES }, { key: 'entity_type', label: 'Linked to anything', options: [['client', 'Clients'], ['project', 'Projects'], ['lead', 'Leads'], ['invoice', 'Invoices'], ['quote', 'Quotations'], ['general', 'Company']] }]}
        empty={{ title: 'No documents yet', text: 'Upload a file or save a link to get started.' }} />
      {open && <UploadModal entityType="general" onClose={() => setOpen(false)} />}
    </Page>
  );
}
