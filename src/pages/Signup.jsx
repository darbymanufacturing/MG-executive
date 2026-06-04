import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, User, Building2, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { auth } from '../lib/firebase.js';
import AsterismMark from '../components/Shared/AsterismMark.jsx';
import styles from './Login.module.css';

const THEME_KEY = 'omni_theme';

/**
 * Signup — public "create your own org" funnel (Phase 2 / ROADMAP 2.5, ADR-0002/0004).
 * Milestone A disabled the old public signup (it auto-granted admin on THIS org). This
 * is the safe replacement: a new user creates a brand-new org and owns it.
 *
 * Flow: create auth user → POST /api/signup (org + profile + claims, all server-side,
 * ADR-0023) → syncClaims() (refresh the local token) → /onboarding.
 * On any server error: delete the auth user and surface the error.
 */
export default function Signup() {
  const { signUp, syncClaims } = useAuth();
  const navigate = useNavigate();
  const currentTheme = localStorage.getItem(THEME_KEY) || 'light';

  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!orgName.trim()) { setError('Please enter your company or organization name.'); return; }
    setLoading(true);

    let authCreated = false;

    try {
      // 1. Create the Firebase auth user (this also signs them in).
      await signUp(email, password);
      authCreated = true;
      if (!auth.currentUser) throw new Error('Sign-up succeeded but no session was created. Please try signing in.');

      // 2. POST to the server to provision the org + owner profile + custom claims
      //    (ADR-0023: all identity writes are server-side, service-role Supabase).
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          orgName: orgName.trim(),
          displayName: name.trim() || email.split('@')[0],
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not create your organization. Please try again.');
      }

      // 3. Refresh the local token to pick up the new custom claims.
      await syncClaims();

      // 4. Into the onboarding wizard.
      navigate('/onboarding', { replace: true });
    } catch (err) {
      // If the server call failed (or anything after auth creation), roll back the
      // auth user so the email isn't permanently locked to a broken account.
      if (authCreated && auth.currentUser) {
        try { await auth.currentUser.delete(); } catch (_) { /* rollback best-effort */ }
      }
      setError(err.message || 'Something went wrong creating your account.');
      setLoading(false);
    }
  };

  return (
    <div className={`omni-app ${styles.page}`} data-theme={currentTheme}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <AsterismMark size={48} />
          <span className={styles.wordmark}>omni</span>
        </div>

        <div className={styles.heading}>
          <h1 className={styles.title}>Create your organization</h1>
          <p className={styles.subtitle}>Start managing your micromobility fleet</p>
        </div>

        {error && (
          <div className={styles.error}>
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>Your name</label>
            <div className={styles.inputWrap}>
              <User size={15} className={styles.inputIcon} />
              <input
                type="text"
                className={styles.input}
                placeholder="Alex Papadopoulos"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                autoFocus
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Company / organization</label>
            <div className={styles.inputWrap}>
              <Building2 size={15} className={styles.inputIcon} />
              <input
                type="text"
                className={styles.input}
                placeholder="Acme Mobility"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Email</label>
            <div className={styles.inputWrap}>
              <Mail size={15} className={styles.inputIcon} />
              <input
                type="email"
                className={styles.input}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Password</label>
            <div className={styles.inputWrap}>
              <Lock size={15} className={styles.inputIcon} />
              <input
                type="password"
                className={styles.input}
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={6}
              />
            </div>
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading
              ? <><Loader2 size={16} className={styles.spinner} /> Creating your organization…</>
              : 'Create organization'
            }
          </button>
        </form>

        <p className={styles.toggle}>
          Already have an account?{' '}
          <Link to="/login" className={styles.toggleBtn}>Sign in</Link>
        </p>
      </div>

      <p className={styles.footer}>omni · Secure access</p>
    </div>
  );
}
