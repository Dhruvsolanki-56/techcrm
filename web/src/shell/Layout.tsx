import { Component, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuthState, useSession } from '../lib/session';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Avatar, Skeleton } from '../ui/primitives';
import { useAttention } from '../components/Attention';
import { Bell } from './Bell';
import { PasswordModal, TwoFactorModal } from './AccountModals';
import { visibleNav } from './nav';
import { Palette } from './Palette';

class Boundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info.componentStack); }
  override componentDidUpdate(prev: { resetKey: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div id="page"><div className="empty iconic-lg" style={{ marginTop: 80 }}>
        <span className="em-i"><Icon name="alert" /></span><b>Something went wrong on this page</b>{this.state.error.message}
        <div className="row" style={{ marginTop: 14, justifyContent: 'center' }}><button type="button" className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button></div>
      </div></div>
    );
  }
}

export function Layout() {
  const { user, isFounder, can, lookups, signOut } = useSession();
  const auth = useAuthState();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  const [palette, setPalette] = useState(false);
  const [meMenu, setMeMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const [tfa, setTfa] = useState(false);
  const meBtn = useRef<HTMLButtonElement>(null);
  const company = String(lookups.settings.company_name ?? auth.data?.company_name ?? 'CRM');
  const logo = lookups.settings.logo as string | null;

  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); } };
    const openSearch = (): void => setPalette(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('crm:search', openSearch);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('crm:search', openSearch); };
  }, []);

  const att = useAttention();
  const urgent = (att.data?.counts.critical ?? 0) + (att.data?.counts.high ?? 0);
  const mustChange = user.must_change_password;
  return (
    <div className="app">
      <aside className={`side${menu ? ' open' : ''}`} id="side">
        <div className="ws"><span className="mark">{logo ? <img src={logo} alt="" /> : company[0]}</span><span className="nm">{company}</span></div>
        <button type="button" className="cmdk" onClick={() => setPalette(true)}><Icon name="search" /><span>Search…</span><kbd>Ctrl K</kbd></button>
        <nav className="nav" aria-label="Main">
          {visibleNav(isFounder, can).map((g, gi) => (
            <div key={gi}>
              {g.group && <div className="nav-h">{g.group}</div>}
              {g.items.map((i) => <NavLink key={i.to} to={i.to} className={({ isActive }) => (isActive ? 'on' : '')}><Icon name={i.icon} /><span>{i.label}</span>{i.to === '/actions' && urgent > 0 ? <span className="count" aria-label={`${urgent} need attention`}>{urgent}</span> : null}</NavLink>)}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <button ref={meBtn} type="button" className="me" onClick={() => setMeMenu((m) => !m)} aria-haspopup="menu">
            <Avatar name={user.name} /><span className="grow"><div className="n ellipsis">{user.name}</div><div className="r">{isFounder ? 'Founder' : 'Intern'}</div></span>
          </button>
        </div>
      </aside>
      {menu && <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.25)' }} onClick={() => setMenu(false)} aria-hidden="true" />}
      <div className="main">
        <div className="mobilebar">
          <button type="button" className="btn icon ghost" aria-label="Menu" onClick={() => setMenu((m) => !m)}><Icon name="menu" /></button>
          <span className="grow ellipsis">{company}</span>
          <button type="button" className="btn icon ghost" aria-label="Search" onClick={() => setPalette(true)}><Icon name="search" /></button>
          <Bell />
        </div>
        <main id="view">
          {mustChange
            ? <div className="empty" style={{ marginTop: 120 }}>Choose your own password to continue.</div>
            : <Boundary resetKey={loc.pathname + loc.search}><Suspense fallback={<Skeleton />}><Outlet /></Suspense></Boundary>}
        </main>
      </div>
      <nav className="tabbar" aria-label="Quick tabs">
        <NavLink to="/dashboard"><Icon name="home" /><span>Home</span></NavLink>
        <NavLink to="/actions"><Icon name="alert" /><span>Actions</span>{urgent > 0 ? <s className="tab-dot" aria-label={`${urgent} need you`}>{urgent > 9 ? '9+' : urgent}</s> : null}</NavLink>
        {can('leads') ? <NavLink to="/leads"><Icon name="target" /><span>Pipeline</span></NavLink> : <NavLink to="/tasks"><Icon name="check" /><span>My work</span></NavLink>}
        <NavLink to="/projects"><Icon name="briefcase" /><span>Projects</span></NavLink>
        <button type="button" className={menu ? 'on' : ''} aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="menu" /><span>More</span></button>
      </nav>
      {meMenu && (
        <Popover anchor={meBtn.current} onClose={() => setMeMenu(false)} className="narrow" placement="above">
          <div style={{ padding: '10px 14px 8px' }}><div style={{ fontWeight: 600 }}>{user.name}</div><div className="small muted">{user.email}</div></div>
          <div className="menu-i" role="menuitem" tabIndex={0} onClick={() => { setMeMenu(false); setPw(true); }}><Icon name="key" />Change password</div>
          <div className="menu-i" role="menuitem" tabIndex={0} onClick={() => { setMeMenu(false); setTfa(true); }}><Icon name="shield" />Two-step login <span className="grow" /><span className={`small ${user.two_factor ? '' : 'warn'}`}>{user.two_factor ? 'On' : 'Off'}</span></div>
          <div className="menu-i" role="menuitem" tabIndex={0} onClick={() => { setMeMenu(false); void signOut(); }}><Icon name="logout" />Sign out</div>
        </Popover>
      )}
      {palette && <Palette onClose={() => setPalette(false)} />}
      {(pw || mustChange) && <PasswordModal forced={mustChange} onClose={() => setPw(false)} />}
      {tfa && <TwoFactorModal onClose={() => setTfa(false)} />}
    </div>
  );
}
