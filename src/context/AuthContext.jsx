import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase.js';
import { supabase } from '../lib/supabase.js';
import { authedFetch } from '../utils/apiClient.js';
import { useToast } from './ToastContext.jsx';
import { setSentryUser } from '../lib/sentry.js';

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
  const [claimsSyncing, setClaimsSyncing] = useState(false);
  const { error: toastError } = useToast();

  // Keep a stable ref to syncClaims so the onSnapshot closure can call it
  // without needing to be re-created when syncClaims is redefined below.
  const syncClaimsRef = useRef(null);

  // #451 — generation counter to discard stale async onSnapshot callbacks after signOut.
  // Incremented at the top of each onAuthStateChanged callback; captured into a local
  // `epoch` const so any in-flight async closure can detect it has been superseded.
  const authEpoch = useRef(0);

  useEffect(() => {
    // ADR-0023 Stage-1: profile data now lives in Supabase public.users
    // (source_doc_id = Firebase uid, data = original camelCase doc).
    // The realtime channel replaces the Firestore onSnapshot listener.
    let profileChannel = null;

    const authUnsub = onAuthStateChanged(auth, (firebaseUser) => {
      // #451 — bump the epoch so any in-flight async callback from the
      // previous auth state will see authEpoch.current !== epoch and self-abort.
      const epoch = ++authEpoch.current;

      setUser(firebaseUser);
      setSentryUser(firebaseUser ? firebaseUser.uid : null);

      // Tear down any existing realtime channel from the previous auth state.
      if (profileChannel) {
        supabase?.removeChannel(profileChannel);
        profileChannel = null;
      }

      if (!firebaseUser) {
        setUserProfile(null);
        setAuthLoading(false);
        return;
      }

      const uid = firebaseUser.uid;

      // Fetch + claim-check: shared async logic executed on the initial load and
      // on every realtime postgres_changes event for this user's row.
      const fetchAndCheckProfile = async () => {
        // #451 — discard if a newer auth state has since fired.
        if (authEpoch.current !== epoch) return;

        // Supabase must be configured — fall through to null profile if not
        // (preserves the "no access" gate for misconfigured environments).
        if (!supabase) {
          setUserProfile(null);
          setAuthLoading(false);
          return;
        }

        // Initial select — RLS self-read policy: source_doc_id = auth.jwt()->>'sub'.
        // This works before any orgId claim exists because the Firebase ID token
        // sub = uid; the accessToken hook in supabase.js sends it on every request.
        const { data: row } = await supabase
          .from('users')
          .select('data')
          .eq('source_doc_id', uid)
          .maybeSingle();

        // #451 — discard after the await in case signOut fired during the fetch.
        if (authEpoch.current !== epoch) return;

        // The profile is the `data` jsonb column — the original camelCase doc:
        // { role, orgId, displayName, email, isOwner?, assignedScooterIds?, … }
        const profile = row?.data ?? null;

        // #15 — never auto-provision a role. A signed-in user with no row gets
        // userProfile=null → no access (gated in App.jsx). Accounts are created
        // only by an admin via createTechnicianAccount. Clear authLoading either
        // way so the app never hangs on a missing row.
        setUserProfile(profile);

        // #428 — If no profile row, skip claim check (NoAccessScreen gate handles it).
        if (!profile) {
          setAuthLoading(false);
          return;
        }

        // #428 — Verify JWT claims match the Supabase profile before clearing
        // authLoading. Stale or absent claims (first sign-in, role change) cause
        // every useOrgCollection query to be rejected by security/RLS rules.
        try {
          const tokenResult = await firebaseUser.getIdTokenResult();

          // #451 — re-check after the await: signOut may have fired while we were
          // waiting for getIdTokenResult(), making this callback stale.
          if (authEpoch.current !== epoch) return;

          // The reserved 'role' claim is 'authenticated' (Supabase Postgres role);
          // the app RBAC role is mirrored into 'user_role'. Compare user_role
          // against the profile (ADR-0017 / #569).
          const { orgId: claimOrgId, user_role: claimUserRole } = tokenResult.claims;
          const { orgId: profileOrgId, role: profileRole } = profile;

          const claimsMatch =
            claimOrgId === profileOrgId && claimUserRole === profileRole;

          if (!claimsMatch) {
            // Claims are absent or stale — sync them before letting the shell mount.
            setClaimsSyncing(true);
            try {
              if (syncClaimsRef.current) await syncClaimsRef.current();
            } catch (_syncErr) {
              // Sync failed (transient network / server error). Surface a toast so
              // the user knows, but still clear loading — the shell will render and
              // RLS rules will reject individual queries gracefully.
              toastError(
                'Could not update account permissions. Some features may be unavailable.'
              );
            } finally {
              setClaimsSyncing(false);
            }
          }
          // Claims already match — happy path, no extra round-trip needed.
        } catch (_tokenErr) {
          // getIdTokenResult() failed (offline, revoked token, etc.).
          // Don't block the UI — proceed and let RLS rules enforce access.
          toastError(
            'Could not verify account permissions. Some features may be unavailable.'
          );
        }

        // #451 — final guard before writing authLoading (covers the catch-branch path).
        if (authEpoch.current !== epoch) return;
        setAuthLoading(false);
      };

      // Kick off the initial fetch immediately.
      fetchAndCheckProfile();

      // Subscribe to realtime changes on this user's row so the profile stays live
      // (mirrors the onSnapshot behavior). On any INSERT/UPDATE/DELETE we re-run
      // the same select so we always read the authoritative DB value, not the
      // change-event payload (which may be truncated for large JSONB columns).
      if (supabase) {
        profileChannel = supabase
          .channel(`profile:${uid}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'users',
              filter: `source_doc_id=eq.${uid}`,
            },
            () => {
              // Re-fetch on any change; the epoch guard inside handles stale callbacks.
              fetchAndCheckProfile();
            },
          )
          .subscribe();
      }
    });

    return () => {
      authUnsub();
      if (profileChannel) {
        supabase?.removeChannel(profileChannel);
        profileChannel = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // #428 — Keep the ref in sync so the onSnapshot closure (which captures this
  // ref at mount time) always calls the latest syncClaims for the current user.
  syncClaimsRef.current = syncClaims;

  // Admin-only: create a crew/staff/admin account in the caller's org, without signing
  // the current admin out. ADR-0023: the users profile now lives in Supabase and RLS
  // forbids a client creating ANOTHER user's row (insert is self-only), so the WHOLE flow
  // — create the Firebase Auth user, write the Supabase profile row, set custom claims —
  // runs server-side in /api/create-user, which re-verifies the caller is an org owner/
  // admin (#19 is now SERVER-enforced, not client-only). role: 'crew' (default) | 'staff' | 'admin'.
  const createTechnicianAccount = async (email, password, displayName, role = 'crew') => {
    // Client-side guard — defense-in-depth only; /api/create-user re-checks authoritatively.
    if (userProfile?.role !== 'admin' && userProfile?.role !== 'owner')
      throw new Error('Only admins can create accounts');
    // #452 — only the org owner can mint another admin (server re-enforces this too).
    if (role === 'admin' && userProfile?.role !== 'owner')
      throw new Error('Only the organisation owner can create admin accounts');
    if (!userProfile?.orgId) throw new Error("Your account isn't linked to an organization yet.");
    const res = await authedFetch('/api/create-user', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName: (displayName || '').trim(), role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to create the account.');
    }
    const { uid } = await res.json();
    return uid;
  };

  // Thin wrapper so consumers never import `auth` directly — also satisfies the
  // ROADMAP Phase-2 seam (getIdToken(true) after a claim change, ROADMAP.md:618).
  const getIdToken = async (force = false) => {
    if (!auth.currentUser) throw new Error('Not signed in');
    return auth.currentUser.getIdToken(force);
  };

  const userRole = userProfile?.role ?? null;

  return (
    <AuthContext.Provider value={{
      user, authLoading, claimsSyncing, userRole, userProfile,
      signIn, signUp, signOut, createTechnicianAccount,
      refreshClaims, syncClaims, getIdToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
