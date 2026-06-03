import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, Lock, User, Building2, Loader2, AlertCircle } from 'lucide-react';
import { doc, setDoc, deleteDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext.jsx';
import { auth, db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import AsterismMark from '../components/Shared/AsterismMark.jsx';
import styles from './Login.module.css';

const THEME_KEY = 'omni_theme';
const TRIAL_DAYS = 14;

/**
 * Signup — public "create your own org" funnel (Phase 2 / ROADMAP 2.5, ADR-0002/0004).
 * Milestone A disabled the old public signup (it auto-granted admin on THIS org). This
 * is the safe replacement: a new user creates a brand-new org and owns it.
 *
 * Flow: create auth user → create organizations/{id} → create users/{uid} (role:owner,
 * orgId) → syncClaims() (mirror role+org into custom claims + refresh token) → /onboarding.
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

    // Rollback trackers — set after each step succeeds so the catch block
    // knows exactly what to undo if a later step fails.
    let authCreated = false;
    let orgDocId = null;
    let userDocCreated = false;

    try {
      // 1. Create the auth user (this also signs them in).
      await signUp(email, password);
      authCreated = true;
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error('Sign-up succeeded but no session was created. Please try signing in.');

      // 2. Create the org — flat collection with an auto-id (ADR-0002).
      const orgRef = doc(collection(db, 'organizations'));
      const orgId = orgRef.id;
      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
      await safeWrite(
        () => setDoc(orgRef, {
          name: orgName.trim(),
          ownerUid: uid,
          members: [uid],
          plan: 'trial',
          trialEndsAt,
          settings: {},
          createdAt: serverTimestamp(),
        }),
        { rethrow: true, errorMessage: 'Could not create your organization. Please try again.' },
      );
      orgDocId = orgId;

      // 3. Create the owner profile — the UI + claims source of truth (ADR-0004).
      await safeWrite(
        () => setDoc(doc(db, 'users', uid), {
          role: 'owner',
          orgId,
          displayName: name.trim() || email.split('@')[0],
          email,
          createdAt: serverTimestamp(),
        }),
        { rethrow: true, errorMessage: 'Account created, but saving your profile failed. Contact support.' },
      );
      userDocCreated = true;
      // 4. Mirror {orgId, role:'owner'} into custom claims so the B4 Firestore rules
      //    admit this user, then refresh the local token (ADR-0004).
      await syncClaims(uid);

      // 5. Into the onboarding wizard.
      navigate('/onboarding', { replace: true });
    } catch (err) {
      // Rollback (order matters — Firestore deletes need a live auth session, and
      // auth.delete() invalidates it): org doc, then the user profile doc, then the
      // Auth user. #526 — the users/{uid} doc is NOT auto-removed when the auth user
      // is deleted, so without this it orphans (role:'owner' pointing at a deleted org).
      // Errors are swallowed so the original error message reaches the user.
      if (orgDocId) {
        try { await deleteDoc(doc(db, 'organizations', orgDocId)); } catch (_) { /* rollback best-effort */ }
      }
      if (userDocCreated && auth.currentUser) {
        try { await deleteDoc(doc(db, 'users', auth.currentUser.uid)); } catch (_) { /* rollback best-effort */ }
      }
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
