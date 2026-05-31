import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { auth } from '../lib/firebase.js';
import AsterismMark from '../components/Shared/AsterismMark.jsx';
import styles from './Login.module.css';

const THEME_KEY = 'omni_theme';

export default function Login() {
  const { signIn } = useAuth();
  const { success: toastSuccess } = useToast();
  const navigate = useNavigate();
  const currentTheme = localStorage.getItem(THEME_KEY) || 'light';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // #15 — sign-in only. Public self-sign-up is disabled (it used to auto-grant
  // admin). Accounts are created by an admin in Settings → Team. Phase 2 adds
  // proper "create your own org" signup.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError('');
    if (!email) { setError('Enter your email address first.'); return; }
    try {
      await sendPasswordResetEmail(auth, email);
      // #361 — use toast for the success confirmation (transient notification)
      toastSuccess('Password reset email sent. Check your inbox.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className={`omni-app ${styles.page}`} data-theme={currentTheme}>
      <div className={styles.card}>
        {/* Omni Asterism mark + wordmark — inline lockup, see docs/BRANDING.md */}
        <div className={styles.logoWrap}>
          <AsterismMark size={48} />
          <span className={styles.wordmark}>omni</span>
        </div>

        {/* Heading */}
        <div className={styles.heading}>
          <h1 className={styles.title}>Welcome back</h1>
          <p className={styles.subtitle}>Sign in to your fleet dashboard</p>
        </div>

        {/* Error banner */}
        {error && (
          <div className={styles.error}>
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form className={styles.form} onSubmit={handleSubmit}>
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
                autoFocus
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
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                minLength={6}
              />
            </div>
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading
              ? <><Loader2 size={16} className={styles.spinner} /> Signing in…</>
              : 'Sign In'
            }
          </button>
        </form>

        {/* Forgot password */}
        <p className={styles.toggle}>
          <button type="button" className={styles.toggleBtn} onClick={handleForgotPassword}>
            Forgot password?
          </button>
        </p>
        {/* Phase 2: public "create your own org" signup (re-enabled after Milestone A). */}
        <p className={styles.toggle}>
          New to Omni?{' '}
          <Link to="/signup" className={styles.toggleBtn}>Create your organization</Link>
        </p>
        <p className={styles.toggle} style={{ color: 'var(--fg-muted)', fontSize: '12px' }}>
          Joining a team? Ask your admin to create your account.
        </p>
      </div>

      {/* Branded footer — lowercase "omni" per brand */}
      <p className={styles.footer}>omni · Secure access</p>
    </div>
  );
}
