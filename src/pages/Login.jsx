import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import AsterismMark from '../components/Shared/AsterismMark.jsx';
import styles from './Login.module.css';

export default function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isSignUp = mode === 'signup';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
    setError('');
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Omni Asterism mark + wordmark — inline lockup, see docs/BRANDING.md */}
        <div className={styles.logoWrap}>
          <AsterismMark size={48} />
          <span className={styles.wordmark}>omni</span>
        </div>

        {/* Heading */}
        <div className={styles.heading}>
          <h1 className={styles.title}>
            {isSignUp ? 'Create account' : 'Welcome back'}
          </h1>
          <p className={styles.subtitle}>
            {isSignUp
              ? 'Sign up to access the fleet dashboard'
              : 'Sign in to your fleet dashboard'}
          </p>
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
                placeholder={isSignUp ? 'At least 6 characters' : '••••••••'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                minLength={6}
              />
            </div>
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading
              ? <><Loader2 size={16} className={styles.spinner} /> {isSignUp ? 'Creating account…' : 'Signing in…'}</>
              : isSignUp ? 'Create Account' : 'Sign In'
            }
          </button>
        </form>

        {/* Toggle */}
        <p className={styles.toggle}>
          {isSignUp ? 'Already have an account?' : "Don't have an account?"}
          {' '}
          <button type="button" className={styles.toggleBtn} onClick={toggleMode}>
            {isSignUp ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>

      {/* Branded footer — lowercase "omni" per brand */}
      <p className={styles.footer}>omni · Secure access</p>
    </div>
  );
}
