import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ErrorBoundary } from './components/Shared/ErrorBoundary.jsx';
import { OrgProvider } from './context/OrgContext.jsx';
import { FleetProvider } from './context/FleetContext.jsx';
import { CostProvider } from './context/CostContext.jsx';
import { RevenueProvider } from './context/RevenueContext.jsx';
import { SprProvider } from './context/SprContext.jsx';
import { MaintenanceProvider } from './context/MaintenanceContext.jsx';
import { ProjectProvider } from './context/ProjectContext.jsx';
import { DiaryProvider } from './context/DiaryContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import { TelemetryProvider } from './context/TelemetryContext.jsx';
import { ScooterConfigProvider } from './context/ScooterConfigContext.jsx';
import { TripProvider } from './context/TripContext.jsx';
import { IssueProvider } from './context/IssueContext.jsx';
import { InboxProvider } from './context/InboxContext.jsx';
import { RepairProcedureProvider } from './context/RepairProcedureContext.jsx';
import { RepairSessionProvider } from './context/RepairSessionContext.jsx';
import DiaryBubble from './components/Diary/DiaryBubble.jsx';
import Sidebar from './components/Layout/Sidebar.jsx';
import TopBar from './components/Layout/TopBar.jsx';
import CaptureModal from './components/Capture/CaptureModal.jsx';
import OmniLoading from './components/Shared/OmniLoading.jsx';

/* Pages */
import Home from './pages/Home.jsx';
import Issues from './pages/Issues.jsx';
import IssueDetail from './pages/IssueDetail.jsx';
import Dashboard from './pages/Dashboard.jsx';   /* becomes /pulse */
import CostManager from './pages/CostManager.jsx';
import Revenue from './pages/Revenue.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import AcceptInvite from './pages/AcceptInvite.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Spr from './pages/Spr.jsx';
import Maintenance from './pages/Maintenance.jsx';
import Projects from './pages/Projects.jsx';
import WarRoomPage from './pages/WarRoom.jsx';
import PredictiveMaintenance from './pages/PredictiveMaintenance.jsx';
import Investment from './pages/Investment.jsx';
import Pow from './pages/Pow.jsx';
import Scooters from './pages/Scooters.jsx';
import ScooterDetail from './pages/ScooterDetail.jsx';
import TechnicianDashboard from './pages/TechnicianDashboard.jsx';
import RepairSession from './components/Technician/RepairSession.jsx';
import Notifications from './pages/Notifications.jsx';
import Contractors from './pages/Contractors.jsx';
import FleetPnl from './pages/FleetPnl.jsx';
import OwnerLedger from './pages/OwnerLedger.jsx';

import './styles/variables.css';
import './styles/globals.css';
import styles from './App.module.css';
import { safeStorage } from './utils/safeStorage.js';

/* ─── Route title map ─── */
const ROUTE_TITLES = {
  '/':            'Inbox',
  '/issues':      'Issues',
  '/pulse':       'Pulse',
  '/brief':       'Daily Brief',
  '/notifications':'Notifications',
  '/maintenance': 'Tickets',
  '/projects':    'Projects',
  '/crew':        'Crew',
  '/contractors': 'Contractors',
  '/war-room':    'War Room',
  '/scooters':    'Scooters',
  '/pme':         'PME',
  '/pow':         'POW v3',
  '/costs':       'Costs',
  '/revenue':     'Revenue',
  '/investment':  'Investment',
  '/fleet-pnl':   'Fleet P&L',
  '/owner-ledger': 'Owner Ledger',
  '/spr':         'SPR',
  '/settings':    'Settings',
};

function getTitle(pathname) {
  if (pathname.startsWith('/issues/')) return 'Issue';
  if (pathname.startsWith('/projects/')) return 'Project';
  if (pathname.startsWith('/scooters/')) return 'Scooter';
  return ROUTE_TITLES[pathname] || 'Omni';
}

/* ─── Loading screen ───
 * Plays the cinematic 2.0s Asterism-assembly intro from the design handoff,
 * then transitions into a subtle 1.2s breath loop if the wait exceeds 2s.
 * The "no animation in brand surfaces" rule (docs/BRANDING.md) has a carved-out
 * exception specifically for OmniLoading. See docs/BRANDING.md "Loading intro exception". */
function LoadingScreen() {
  return <OmniLoading variant="splash" loop />;
}

/* ─── Protected route ─── */
function ProtectedRoute({ children }) {
  const { user, authLoading } = useAuth();
  if (authLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/* ─── Theme key in localStorage ─── */
const THEME_KEY = 'omni_theme';

/* ─── Location-aware ErrorBoundary (#305) ───
 * Passes location.pathname as a resetKey so the boundary auto-resets when the
 * user navigates away from the errored route, instead of persisting the fallback. */
function RouteErrorBoundary({ children, ...props }) {
  const location = useLocation();
  return (
    <ErrorBoundary {...props} resetKeys={[location.pathname]}>
      {children}
    </ErrorBoundary>
  );
}

/* ─── Route-scoped provider wrappers (Phase 1.6a) ───
 *
 * Each wrapper mounts the providers only while its inner routes are active.
 * Heavy collections (telemetry, trips, SPR) are unmounted on every other route,
 * cutting initial Firestore reads roughly in half. Providers that are needed
 * across most routes (Cost, Revenue, Maintenance, Project, Notification, Inbox,
 * Diary, Issue) stay at the admin root.
 *
 * Routes inside a wrapper share the providers — navigating between siblings
 * (e.g. /pme → /scooters) does NOT remount them; only leaving the group does.
 */
function ScooterScopedRoutes() {
  return (
    <TelemetryProvider>
      <TripProvider>
        <ScooterConfigProvider>
          <ErrorBoundary><Outlet /></ErrorBoundary>
        </ScooterConfigProvider>
      </TripProvider>
    </TelemetryProvider>
  );
}

function SprScopedRoutes() {
  return (
    <SprProvider>
      <ErrorBoundary><Outlet /></ErrorBoundary>
    </SprProvider>
  );
}

/* ─── No-access screen (#15) — signed in but no provisioned role ─── */
function NoAccessScreen() {
  const { user, signOut } = useAuth();
  return (
    <div
      className="omni-app"
      data-theme={safeStorage.getRaw(THEME_KEY) || 'light'}
      style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px' }}
    >
      <div style={{ maxWidth: 440, textAlign: 'center' }}>
        <h1 style={{ marginBottom: 8 }}>Account not provisioned</h1>
        <p style={{ color: 'var(--fg-muted)', marginBottom: 20 }}>
          You&rsquo;re signed in as <strong>{user?.email}</strong>, but your account hasn&rsquo;t been
          granted access yet. Ask an administrator to set up your role.
        </p>
        <button
          onClick={signOut}
          style={{
            padding: '8px 16px', borderRadius: 'var(--radius-md)', background: 'var(--accent)',
            color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 'var(--text-sm)',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ─── Admin app shell ─── */
function AppShell() {
  const { userRole } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [_notificationsOpen, setNotificationsOpen] = useState(false);
  const rootRef = useRef(null);

  /* Theme — also propagate to <html> so body/globals.css can read it */
  // BUG #158 — use safeStorage so this doesn't throw in Safari Private Mode
  const [theme, setTheme] = useState(() => safeStorage.getRaw(THEME_KEY) || 'light');
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const toggleTheme = useCallback(() => {
    if (rootRef.current) {
      rootRef.current.classList.add('theme-transitioning');
      setTimeout(() => rootRef.current?.classList.remove('theme-transitioning'), 700);
    }
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      safeStorage.setRaw(THEME_KEY, next); // BUG #158 — safe write
      return next;
    });
  }, []);

  /* ⌘K global shortcut */
  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCaptureOpen(o => !o);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  /* Preload Mapbox after a short idle — Phase 1.6a decoupled this from CostContext.loading
     so the shell doesn't gate on data loading any more. Each page handles its own
     loading skeleton (Phase 1.5 adoption). */
  useEffect(() => {
    const t = setTimeout(() => { import('mapbox-gl').catch(() => {}); }, 2000);
    return () => clearTimeout(t);
  }, []);

  /* Redirect crew to /crew shell */
  // #185 — 'staff' intentionally stays in the admin shell (full ops access); only technician/crew/contractor go to /crew
  // Phase 2.5 F5 — 'contractor' (external tech) is crew-tier: same focused /crew portal.
  if (userRole === 'technician' || userRole === 'crew' || userRole === 'contractor') {
    return <Navigate to="/crew" replace />;
  }

  // #15 / #499 — fail closed: only admin/owner/staff reach the admin shell. A signed-in
  // user with no valid role (e.g. a Firebase Auth account with no users/{uid} doc), or a
  // crew-tier role that slipped past the redirect above, gets a no-access screen + sign-out.
  // 'owner' is the org-owner role (ADR-0014) — it MUST be admitted, not locked out.
  if (userRole !== 'admin' && userRole !== 'owner' && userRole !== 'staff') {
    return <NoAccessScreen />;
  }

  const title = getTitle(location.pathname);

  return (
    <div
      ref={rootRef}
      className={`omni-app ${styles.layout}`}
      data-theme={theme}
    >
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
      />

      <div
        className={styles.content}
        style={{ marginLeft: sidebarCollapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)' }}
      >
        <TopBar
          title={title}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenCapture={() => setCaptureOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(o => !o)}
          onMenuToggle={() => setSidebarOpen(o => !o)}
          sidebarOpen={sidebarOpen}
        />

        <main className={styles.main}>
          <Routes>
            {/* Always-on routes — providers at admin root cover everything here. */}
            {/* #305 — RouteErrorBoundary resets on navigation so fallback doesn't persist */}
            <Route path="/"               element={<RouteErrorBoundary><Home /></RouteErrorBoundary>} />
            <Route path="/issues"         element={<RouteErrorBoundary><Issues /></RouteErrorBoundary>} />
            <Route path="/issues/:id"     element={<RouteErrorBoundary><IssueDetail /></RouteErrorBoundary>} />
            <Route path="/pulse"          element={<RouteErrorBoundary><Dashboard /></RouteErrorBoundary>} />
            <Route path="/brief"          element={<RouteErrorBoundary><Home /></RouteErrorBoundary>} />
            <Route path="/notifications"  element={<RouteErrorBoundary><Notifications /></RouteErrorBoundary>} />
            <Route path="/projects"       element={<RouteErrorBoundary><Projects /></RouteErrorBoundary>} />
            <Route path="/projects/:id"   element={<RouteErrorBoundary><Projects /></RouteErrorBoundary>} />
            <Route path="/war-room"       element={<RouteErrorBoundary><WarRoomPage /></RouteErrorBoundary>} />
            <Route path="/investment"     element={<RouteErrorBoundary><Investment /></RouteErrorBoundary>} />
            <Route path="/costs"          element={<RouteErrorBoundary><CostManager /></RouteErrorBoundary>} />
            <Route path="/revenue"        element={<RouteErrorBoundary><Revenue /></RouteErrorBoundary>} />
            <Route path="/fleet-pnl"      element={<RouteErrorBoundary><FleetPnl /></RouteErrorBoundary>} />
            <Route path="/owner-ledger"   element={<RouteErrorBoundary><OwnerLedger /></RouteErrorBoundary>} />
            <Route path="/maintenance"    element={<RouteErrorBoundary><Maintenance /></RouteErrorBoundary>} />
            <Route path="/pow"            element={<RouteErrorBoundary><Pow /></RouteErrorBoundary>} />
            <Route path="/contractors"    element={<RouteErrorBoundary><Contractors /></RouteErrorBoundary>} />
            <Route path="/settings"       element={<RouteErrorBoundary><Settings /></RouteErrorBoundary>} />

            {/* Scoped — heavy telemetry stack only mounts while user is on these routes */}
            <Route element={<ScooterScopedRoutes />}>
              <Route path="/scooters"     element={<Scooters />} />
              <Route path="/scooters/:id" element={<ScooterDetail />} />
              <Route path="/pme"          element={<PredictiveMaintenance />} />
            </Route>

            {/* Scoped — SPR */}
            <Route element={<SprScopedRoutes />}>
              <Route path="/spr"          element={<Spr />} />
            </Route>

            {/* Redirect old paths */}
            <Route path="/technician"     element={<Navigate to="/crew" replace />} />
            <Route path="/dashboard"      element={<Navigate to="/pulse" replace />} />
            <Route path="*"               element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      {/* Global overlays */}
      <DiaryBubble />
      <CaptureModal open={captureOpen} onClose={() => setCaptureOpen(false)} />
    </div>
  );
}

/* ─── Crew shell ─── */
function CrewShell() {
  return (
    <Routes>
      <Route index               element={<TechnicianDashboard />} />
      <Route path=":ticketId"    element={<RepairSession />} />
      <Route path="*"            element={<Navigate to="/crew" replace />} />
    </Routes>
  );
}

/* ─── Root ─── */
export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary
        title="Omni hit a snag"
        message="An unexpected error stopped the app from rendering. Click below to retry — your data is safe."
        onReset={() => window.location.reload()}
      >
        <ToastProvider>
          <AuthProvider>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              {/* Phase 2.5 F6 — contractor invite acceptance (public; token in query) */}
              <Route path="/accept-invite" element={<AcceptInvite />} />

              {/* Crew routes — lightweight shell, no heavy admin contexts */}
              <Route
                path="/crew/*"
                element={
                  <ProtectedRoute>
                    <OrgProvider>
                      <MaintenanceProvider>
                        <RepairProcedureProvider>
                          <ErrorBoundary>
                            <CrewShell />
                          </ErrorBoundary>
                        </RepairProcedureProvider>
                      </MaintenanceProvider>
                    </OrgProvider>
                  </ProtectedRoute>
                }
              />
              {/* Legacy /technician/* redirect */}
              <Route path="/technician/*" element={<Navigate to="/crew" replace />} />

              {/* Post-signup onboarding wizard — needs org + cost context */}
              <Route
                path="/onboarding"
                element={
                  <ProtectedRoute>
                    <OrgProvider>
                      <CostProvider>
                        <ErrorBoundary>
                          <Onboarding />
                        </ErrorBoundary>
                      </CostProvider>
                    </OrgProvider>
                  </ProtectedRoute>
                }
              />

              {/* Admin routes — always-on providers at root.
                  Phase 1.6a: Telemetry / Trip / ScooterConfig / Spr moved into route-scoped
                  wrappers inside AppShell (see ScooterScopedRoutes, SprScopedRoutes). */}
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <OrgProvider>
                      <FleetProvider>
                      <CostProvider>
                        <RevenueProvider>
                          <MaintenanceProvider>
                            <RepairProcedureProvider>
                              <RepairSessionProvider>
                                <ProjectProvider>
                                  <IssueProvider>
                                    <InboxProvider>
                                      <NotificationProvider>
                                        <DiaryProvider>
                                          <ErrorBoundary>
                                            <AppShell />
                                          </ErrorBoundary>
                                        </DiaryProvider>
                                      </NotificationProvider>
                                    </InboxProvider>
                                  </IssueProvider>
                                </ProjectProvider>
                              </RepairSessionProvider>
                            </RepairProcedureProvider>
                          </MaintenanceProvider>
                        </RevenueProvider>
                      </CostProvider>
                      </FleetProvider>
                    </OrgProvider>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
