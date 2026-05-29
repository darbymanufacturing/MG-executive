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
  const { userProfile, userRole, authLoading } = useAuth();
  const orgId = userProfile?.orgId ?? null;

  // Mirror orgId into the write-layer singleton (cleared on sign-out / org change).
  useEffect(() => {
    setActiveOrg(orgId);
    return () => setActiveOrg(null);
  }, [orgId]);

  const value = useMemo(() => ({
    orgId,
    role: userRole ?? null,
    loading: authLoading,
  }), [orgId, userRole, authLoading]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (ctx === null) throw new Error('useOrg must be used within <OrgProvider>');
  return ctx;
}
