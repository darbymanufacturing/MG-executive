import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Mail, Lock, User, Loader2, AlertCircle, Clock, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { auth } from '../lib/firebase.js';
import AsterismMark from '../components/Shared/AsterismMark.jsx';
import styles from './Login.module.css';

const THEME_KEY = 'omni_theme';

/**
 * AcceptInvite — Phase 2.5 F6. A contractor's real "signup": reached via an
 * invite link (/accept-invite?token=…). Validates the token (peek), then the
 * contractor sets a display name + password. The server (api/accept-invite)
 * provisions their users/{uid} doc with the invite's orgId + role and sets claims.
 *
 * Matches the design handoff invite screen (images/03-invite, 04-invite-expired):
 * rust "invited by <org>" callout, read-only pre-filled email, name + password.
 */
export default function AcceptInvite() {
  const { signUp, syncClaims } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const currentTheme = localStorage.getItem(THEME_KEY) || 'light';

  const [phase, setPhase] = useState('checking'); // checking | valid | invalid
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Validate the invite on mount (peek mode — no auth).
  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/accept-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, peek: true }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.valid) {
          setOrgName(data.orgName || 'your operator');
          setEmail(data.email || '');
          setPhase('valid');
        } else {
          setPhase('invalid');
        }
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    let authCreated = false;
    try {
      // 1. Create the auth user with the INVITED email (locked) + chosen password.
      await signUp(email, password);
      authCreated = true;
      if (!auth.currentUser) throw new Error('Sign-up succeeded but no session started. Try signing in.');

      // 2. Redeem the invite server-side — provisions users/{uid} (orgId+role) + claims.
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ token, displayName: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not complete your account setup.');

      // 3. Pull the fresh claims into the token (or sync as a fallback), then enter /crew.
      if (data.claimsPending) {
        try { await syncClaims(auth.currentUser.uid); } catch { /* rules re-sync later */ }
      } else {
        await auth.currentUser.getIdToken(true);
      }
      navigate('/crew', { replace: true });
    } catch (err) {
      // Roll back the auth user if redemption failed, so the token can be retried.
      if (authCreated && auth.currentUser) {
        try { await auth.currentUser.delete(); } catch { /* swallow */ }
      }
      setError(err.message || 'Something went wrong setting up your account.');
      setLoading(false);
    }
  };

  return (
    <div className={`omni-app ${styles.page}`} data-theme={currentTheme}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <AsterismMark size={48} />
          <span className={styles.wordmark}>omni</span>
          <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--accent, #A0521D)' }}>CREW</span>
        </div>

        {phase === 'checking' && (
          <div className={styles.heading}>
            <p className={styles.subtitle}><Loader2 size={16} className={styles.spinner} /> Checking your invite…</p>
          </div>
        )}

        {phase === 'invalid' && (
          <div className={styles.heading}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, color: 'var(--fg-muted, #94a3b8)' }}>
              <Clock size={40} />
            </div>
            <h1 className={styles.title}>This invite has expired</h1>
            <p className={styles.subtitle}>Ask your operator to send you a fresh invite link.</p>
            <p className={styles.toggle} style={{ marginTop: 16 }}>
              Already set up? <Link to="/login" className={styles.toggleBtn}>Sign in</Link>
            </p>
          </div>
        )}

        {phase === 'valid' && (
          <>
            <div className={styles.heading}>
              <h1 className={styles.title}>Set up your account</h1>
            </div>

            {/* Rust "invited by" callout (design images/03) */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 16,
                borderRadius: 8, background: 'color-mix(in srgb, var(--accent, #A0521D) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent, #A0521D) 30%, transparent)',
                color: 'var(--accent, #A0521D)', fontSize: 13, fontWeight: 600,
              }}
            >
              <Building2 size={15} />
              <span>You've been invited to work with {orgName}</span>
            </div>

            {error && (
              <div className={styles.error}>
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            )}

            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                <div className={styles.inputWrap}>
                  <Mail size={15} className={styles.inputIcon} />
                  <input type="email" className={styles.input} value={email} readOnly disabled autoComplete="email" />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Your name</label>
                <div className={styles.inputWrap}>
                  <User size={15} className={styles.inputIcon} />
                  <input
                    type="text" className={styles.input} placeholder="Yannis Pappas"
                    value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Create a password</label>
                <div className={styles.inputWrap}>
                  <Lock size={15} className={styles.inputIcon} />
                  <input
                    type="password" className={styles.input} placeholder="At least 6 characters"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    required autoComplete="new-password" minLength={6}
                  />
                </div>
              </div>

              <button type="submit" className={styles.submitBtn} disabled={loading}>
                {loading
                  ? <><Loader2 size={16} className={styles.spinner} /> Setting up…</>
                  : 'Create my account'}
              </button>
            </form>
          </>
        )}
      </div>
      <p className={styles.footer}>omni · Secure access</p>
    </div>
  );
}
