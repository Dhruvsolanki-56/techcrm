import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../lib/api';
import { authKey, type AuthState } from '../lib/session';
import { Icon } from '../ui/Icon';

const DEMO = [
  ['aarav@demo.test', 'Aarav Mehta', 'Founder: sees everything'],
  ['kabir@demo.test', 'Kabir Singh', 'Intern: with maintenance access'],
  ['tara@demo.test', 'Tara Nair', 'Intern: own tasks and projects only'],
] as const;

export function AuthScreen({ state }: { state: AuthState }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ company_name: state.company_name || 'TechSentinals', name: '', email: '', password: '', code: '' });
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setup = state.setup_needed;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e?: FormEvent, override?: Partial<typeof form>) => {
    e?.preventDefault();
    const d = { ...form, ...override };
    setBusy(true);
    setError('');
    try {
      await api.post(setup ? '/auth/setup' : '/auth/login', setup ? { company_name: d.company_name, name: d.name, email: d.email, password: d.password } : { email: d.email, password: d.password, ...(d.code ? { code: d.code } : {}) });
      await qc.invalidateQueries({ queryKey: authKey });
    } catch (err) {
      if (err instanceof ApiError && err.body.need_code) {
        const first = !needCode;
        setNeedCode(true);
        if (first && !d.code) { setBusy(false); return; }
      }
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const brand = state.company_name || 'CRM';
  return (
    <div className="auth">
      <div className="auth-l">
        <div className="ws" style={{ padding: 0 }}><span className="mark">{state.logo ? <img src={state.logo} alt="" /> : brand[0]}</span><span>{brand}</span></div>
        <div className="auth-form">
          {setup ? (
            <>
              <h1>Set up your workspace</h1>
              <p className="sub">Create the first founder account. You can invite the other founders and interns right after.</p>
              <form onSubmit={submit} noValidate>
                <label className="f"><span>Company name</span><input value={form.company_name} onChange={set('company_name')} required /></label>
                <label className="f"><span>Your name</span><input value={form.name} onChange={set('name')} required autoComplete="name" /></label>
                <label className="f"><span>Work email</span><input type="email" value={form.email} onChange={set('email')} required autoComplete="username" /></label>
                <label className="f"><span>Password</span><input type="password" value={form.password} onChange={set('password')} required autoComplete="new-password" /></label>
                <p className="hint" style={{ margin: '6px 0 16px' }}>Password: 10+ characters with letters and numbers.</p>
                {error && <div className="callout err" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
                <button className={`btn primary ${busy ? 'busy' : ''}`} disabled={busy}>Create workspace</button>
              </form>
            </>
          ) : (
            <>
              <h1>Welcome back</h1>
              <p className="sub">Sign in with your work email.</p>
              <form onSubmit={submit} noValidate>
                <label className="f"><span>Email</span><input type="email" value={form.email} onChange={set('email')} required autoComplete="username" autoFocus /></label>
                <label className="f"><span>Password</span><input type="password" value={form.password} onChange={set('password')} required autoComplete="current-password" /></label>
                {needCode && <label className="f"><span>Code from your authenticator app</span><input value={form.code} onChange={set('code')} inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" maxLength={7} autoFocus /></label>}
                {error && <div className="callout err" role="alert" style={{ marginTop: 14 }}>{error}</div>}
                <div style={{ marginTop: 18 }}><button className={`btn primary ${busy ? 'busy' : ''}`} disabled={busy}>Sign in</button></div>
              </form>
              {state.demo && (
                <div className="demo-box"><b>Public demo</b><span>Sample company data. It resets on its own every so often. Pick an account:</span>
                  <div className="demo-acc">
                    {DEMO.map(([email, name, role]) => (
                      <button key={email} type="button" className="btn" onClick={() => { setForm((f) => ({ ...f, email, password: 'Demo-Pass-2026' })); void submit(undefined, { email, password: 'Demo-Pass-2026' }); }}>
                        <span className="grow" style={{ textAlign: 'left' }}><b style={{ display: 'block' }}>{name}</b><span className="small muted">{role}</span></span><Icon name="arrowR" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="auth-foot">Private workspace · access is limited to your team</div>
      </div>
      <div className="auth-r">
        <div className="auth-quote">
          <div className="big">Every client, project, file, invoice and login — in one place instead of five.</div>
          <ul>
            <li><Icon name="building" />Leads, clients and full project history</li>
            <li><Icon name="receipt" />Quotations, change requests, GST invoices and payments</li>
            <li><Icon name="lock" />Encrypted vault for client server access</li>
            <li><Icon name="check" />Tasks for the team, with deadlines that do not slip</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
