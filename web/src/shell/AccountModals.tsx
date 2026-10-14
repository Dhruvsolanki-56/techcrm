import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/Toasts';

function useAction(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  return { busy, error, run };
}

function Shell({ title, onClose, locked, intro, submit, busy, error, onSubmit, children, danger }: {
  title: string; onClose(): void; locked?: boolean; intro?: ReactNode; submit: string; busy: boolean; error: string; onSubmit(e: FormEvent): void; children: ReactNode; danger?: boolean;
}) {
  return (
    <Modal title={title} size="sm" onClose={onClose} locked={locked}
      footer={<>{!locked && <button type="button" className="btn" onClick={onClose}>Cancel</button>}
        <button type="submit" form="acct-form" className={`btn ${danger ? 'danger' : 'primary'} ${busy ? 'busy' : ''}`} disabled={busy}>{submit}</button></>}>
      <form id="acct-form" onSubmit={onSubmit} noValidate>
        {intro && <div className="form-intro">{intro}</div>}
        <div className="form-grid">{children}</div>
        {error && <div className="callout err" role="alert" style={{ marginTop: 16 }}>{error}</div>}
      </form>
    </Modal>
  );
}

export function PasswordModal({ forced, onClose }: { forced?: boolean; onClose(): void }) {
  const { refreshUser } = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const a = useAction(async () => {
    await api.post('/password', { current, next });
    toast.ok('Password updated');
    await refreshUser();
    onClose();
  });
  return (
    <Shell title={forced ? 'Choose your password' : 'Change password'} onClose={onClose} locked={forced} submit="Update password" busy={a.busy} error={a.error} onSubmit={a.run}
      intro={forced ? 'You signed in with a temporary password. Pick your own to continue.' : undefined}>
      <label className="f full"><span>Current password <i>*</i></span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
      <label className="f full"><span>New password <i>*</i></span><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <div className="hint">At least 10 characters, with letters and numbers.</div></label>
    </Shell>
  );
}

export function TwoFactorModal({ onClose }: { onClose(): void }) {
  const { user, refreshUser } = useSession();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);

  const off = useAction(async () => {
    await api.post('/2fa/disable', { password });
    toast.err('Two-step login turned off');
    await refreshUser();
    onClose();
  });
  const start = useAction(async () => { setSetup(await api.post<{ secret: string; uri: string }>('/2fa/setup', { password })); });
  const enable = useAction(async () => {
    await api.post('/2fa/enable', { code });
    toast.ok('Two-step login is on. Other devices were signed out.');
    await refreshUser();
    onClose();
  });

  if (user.two_factor) {
    return (
      <Shell title="Two-step login is on" onClose={onClose} danger submit="Turn off" busy={off.busy} error={off.error} onSubmit={off.run}
        intro="Signing in needs your password and a code from your authenticator app. Turning it off makes your account easier to break into.">
        <label className="f full"><span>Your password <i>*</i></span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      </Shell>
    );
  }
  if (setup) {
    return (
      <Shell title="Add CRM to your authenticator" onClose={onClose} submit="Turn on" busy={enable.busy} error={enable.error} onSubmit={enable.run}
        intro={<>In the app choose <b>Add account → Enter a setup key</b> and type this key (time-based):
          <div className="mono" style={{ margin: '12px 0', padding: 12, border: '1px solid var(--line)', borderRadius: 8, fontSize: 15, letterSpacing: '.06em', wordBreak: 'break-all', userSelect: 'all' }}>{setup.secret.match(/.{1,4}/g)?.join(' ')}</div>
          On your phone you can also <a className="ln" href={setup.uri}>open it in the app directly</a>. Then type the 6-digit code it shows.</>}>
        <label className="f full"><span>6-digit code <i>*</i></span><input inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} /></label>
      </Shell>
    );
  }
  return (
    <Shell title="Turn on two-step login" onClose={onClose} submit="Continue" busy={start.busy} error={start.error} onSubmit={start.run}
      intro="After this, signing in needs your password plus a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password).">
      <label className="f full"><span>Confirm your password <i>*</i></span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    </Shell>
  );
}
