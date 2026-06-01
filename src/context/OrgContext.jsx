/**
 * OrgContext — the org dimension for multi-tenancy (ADR-0001/0002/0003/0004).
 *
 * Derives the active `orgId` + `role` from the signed-in user's profile
 * (`users/{uid}.orgId` / `.role` — the UI source of truth per ADR-0004; the
 * matching custom claims are what the Firestore rules read). Publishes `orgId`
 * into the write-layer singleton (`setActiveOrg`) so the standalone
 * `orgWrite`/`orgUpdate`/`orgDelete` helpers can stamp it without prop-drilling.
 *
 * `useOrg()` → `{ orgId, role, loading }`. While auth/profile is still resolving,
 * `loading` is true and `orgId` may be null; the org-scoped hooks return
 * `loading` rather than throwing in that window. Once resolved, a still-absent
 * `orgId` is a genuine no-org user — the hooks then throw (fail loud, ADR-0003),
 * which the route ErrorBoundary catches (and B2's onboarding prevents by ensuring
 * every signed-in user has an org).
 *
 * Placement: inside <AuthProvider> (orgId derives from the user) and ABOVE every
 * data provider (Cost, Revenue, …) that needs it — see App.jsx.
 */
import { createContext, useContext, useEffect, useMemo } from 'react';
import { useAuth } from './AuthContext.jsx';
import { setActiveOrg } from '../hooks/orgWrite.js';

const OrgContext = createContext(null);

export function OrgProvider({ children }) {
  const { userProfile, userRole, authLoading, user } = useAuth();
  const orgId = userProfile?.orgId ?? null;
  const uid = user?.uid ?? null;

  // Mirror orgId + uid into the write-layer singleton atomically (cleared on sign-out /
  // org change). Both are set together so they can never be out of sync (bug #425).
  useEffect(() => {
    setActiveOrg(orgId, uid);
    // No cleanup: the effect body itself handles sign-out (orgId→null) and org changes.
    // A cleanup here would null the singleton during HMR/nav unmounts, breaking
    // in-flight orgWrite batches (bug #455). The next mount's effect re-sets the
    // singleton idempotently.
  }, [orgId, uid]);

  const value = useMemo(() => ({
    orgId,
    role: userRole ?? null,
    loading: authLoading,
    hasUser: userProfile !== null,
  }), [orgId, userRole, authLoading, userProfile]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (ctx === null) throw new Error('useOrg must be used within <OrgProvider>');
  return ctx;
}
