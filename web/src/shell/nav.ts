export interface NavItem { to: string; label: string; icon: string; show?: 'founder' | 'leads' | 'clients' | 'maintenance' }
export interface NavGroup { group?: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { items: [{ to: '/dashboard', label: 'Home', icon: 'home' }, { to: '/actions', label: 'Action center', icon: 'alert' }, { to: '/analytics', label: 'Analytics', icon: 'activity' }, { to: '/tasks', label: 'My work', icon: 'check' }, { to: '/calendar', label: 'Calendar', icon: 'calendar' }] },
  {
    group: 'Sales',
    items: [
      { to: '/leads', label: 'Pipeline', icon: 'target', show: 'leads' },
      { to: '/followups', label: 'Follow-ups', icon: 'phone', show: 'leads' },
      { to: '/contact-log', label: 'Contact Log', icon: 'note', show: 'leads' },
      { to: '/clients', label: 'Clients', icon: 'building', show: 'clients' },
      { to: '/quotes', label: 'Quotations', icon: 'file', show: 'founder' },
    ],
  },
  {
    group: 'Delivery',
    items: [
      { to: '/projects', label: 'Projects', icon: 'briefcase' },
      { to: '/change-requests', label: 'Change requests', icon: 'edit' },
      { to: '/maintenance', label: 'Maintenance', icon: 'tool', show: 'maintenance' },
      { to: '/documents', label: 'Documents', icon: 'folder' },
    ],
  },
  {
    group: 'Money',
    items: [
      { to: '/invoices', label: 'Invoices', icon: 'receipt', show: 'founder' },
      { to: '/renewals', label: 'Subscriptions', icon: 'refresh', show: 'founder' },
      { to: '/grants', label: 'Grants', icon: 'shield', show: 'founder' },
      { to: '/finance', label: 'Finance', icon: 'trend', show: 'founder' },
      { to: '/assets', label: 'Assets', icon: 'box', show: 'founder' },
    ],
  },
  {
    group: 'Company',
    items: [
      { to: '/vault', label: 'Credentials', icon: 'lock', show: 'founder' },
      { to: '/team', label: 'Team & access', icon: 'users', show: 'founder' },
      { to: '/audit', label: 'Activity log', icon: 'activity', show: 'founder' },
      { to: '/settings', label: 'Settings', icon: 'settings', show: 'founder' },
    ],
  },
];

export function visibleNav(isFounder: boolean, can: (f: string) => boolean): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.show || (i.show === 'founder' ? isFounder : can(i.show))) })).filter((g) => g.items.length);
}
