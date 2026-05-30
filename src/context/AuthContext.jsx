import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';
import { authedFetch } from '../utils/apiClient.js';

const AuthContext = createContext(null);

const ERROR_MESSAGES = {
  'auth/invalid-credential':      'Incorrect email or password.',
  'auth/wrong-password':          'Incorrect email or password.',
  'auth/user-not-found':          'Incorrect email or password.',
  'auth/email-already-in-use':    'An account with this email already exists.',
  'auth/weak-password':           'Password must be at least 6 characters.',
  'auth/invalid-email':           'Please enter a valid email address.',
  'auth/too-many-requests':       'Too many attempts. Please try again later.',
  'EMAIL_EXISTS':                 'An account with this email already exists.',
  'WEAK_PASSWORD':                'Password must be at least 6 characters.',
  'INVALID_EMAIL':                'Please enter a valid email address.',
};

function friendlyError(code) {
  return ERROR_MESSAGES[code] || 'Something went wrong. Please try again.';
}

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let profileUnsub = null;

    const authUnsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);

      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }

      if (!firebaseUser) {
        setUserProfile(null);
        setAuthLoading(false);
        return;
      }

      const userRef = doc(db, 'users', firebaseUser.uid);
      profileUnsub = onSnapshot(userRef, (snap) => {
        // #15 — never auto-provision a role. A signed-in user with no users/{uid}
        // doc gets userProfile=null → no access (gated in App.jsx). Accounts are
        // created only by an admin via createTechnicianAccount. Clear authLoading
        // either way so the app never hangs on a missing doc.
        setUserProfile(snap.exists() ? snap.data() : null);
        setAuthLoading(false);
      });
    });

    return () => {
      authUnsub();
      if (profileUnsub) profileUnsub();
    };
  }, []);

  // #15 — first-login auto-provisioning REMOVED. It used to create a users/{uid}
  // doc with role:'admin' for ANY new sign-in, so anyone who self-signed-up became
  // an admin (CRITICAL privilege escalation). Accounts are now created only by an
  // admin via createTechnicianAccount, and public sign-up is disabled in Login.jsx.
  // Phase 2 adds proper "create your own org" signup (you own a NEW org, not this one).

  const signIn = async (email, password) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      throw new Error(friendlyError(err.code));
    }
  };

  const signUp = async (email, password) => {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      throw new Error(friendlyError(err.code));
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  // ADR-0004: after a custom-claim change, force-refresh the ID token so the new
  // orgId/role reach the token the Firestore rules read. Without this the rules keep
  // seeing the old (or absent) claims until the token naturally rotates (~1h).
  const refreshClaims = async () => {
    if (auth.currentUser) await auth.currentUser.getIdToken(true);
  };

  // Mirror {orgId, role} from the users/{uid} doc into custom claims (server-side,
  // Admin SDK via /api/sync-claim), then refresh the local token if it was our own.
  // Call after signup/onboarding, or after an admin creates/changes a user.
  const syncClaims = async (targetUid) => {
    const uid = targetUid ?? auth.currentUser?.uid ?? null;
    const res = await authedFetch('/api/sync-claim', {
      method: 'POST',
      body: JSON.stringify(uid ? { uid } : {}),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to sync account permissions.');
    }
    // Only the current user's own token needs refreshing to pick up the new claims.
    if (uid && uid === auth.currentUser?.uid) await refreshClaims();
    return res.json();
  };

  // Admin-only: create a crew/staff account without signing out the current admin.
  // Uses the Firebase Auth REST API so the current session is unaffected.
  // role: 'crew' (default, formerly 'technician') | 'staff' | 'admin'
  const createTechnicianAccount = async (email, password, displayName, role = 'crew') => {
    // BUG #19 — client-side admin guard (server-side enforcement is Phase 2)
    if (userProfile?.role !== 'admin') throw new Error('Only admins can create accounts');
    // Phase 2 (ADR-0002): new accounts join the creating admin's org.
    if (!userProfile?.orgId) throw new Error("Your account isn't linked to an organization yet.");
    const apiKey = import.meta.env.VITE_FIREBASE_WEB_API_KEY;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      const code = data.error?.message ?? '';
      throw new Error(friendlyError(code));
    }
    const validRoles = ['crew', 'staff', 'admin', 'technician'];
    const assignedRole = validRoles.includes(role) ? role : 'crew';
    // #362 — route through safeWrite so a Firestore failure surfaces (toast) instead of
    // silently orphaning the just-created Auth account. rethrow so the caller still sees it.
    await safeWrite(
      () => setDoc(doc(db, 'users', data.localId), {
        role: assignedRole,
        orgId: userProfile.orgId,
        displayName: displayName.trim() || email.split('@')[0],
        email,
        createdAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Account created, but saving its profile failed — check Firestore.' },
    );
    // Mirror the new user's role+org into custom claims so the B4 Firestore rules admit
    // them. We're an owner/admin of the same org, so sync-claim authorizes this.
    await syncClaims(data.localId);
    return data.localId;
  };

  const userRole = userProfile?.role ?? null;

  return (
    <AuthContext.Provider value={{
      user, authLoading, userRole, userProfile,
      signIn, signUp, signOut, createTechnicianAccount,
      refreshClaims, syncClaims,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
