import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ErrorBoundary } from './components/Shared/ErrorBoundary.jsx';
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
import AsterismMark from './components/Shared/AsterismMark.jsx';

/* Pages */
import Home from './pages/Home.jsx';
import Issues from './pages/Issues.jsx';
import IssueDetail from './pages/IssueDetail.jsx';
import Dashboard from './pages/Dashboard.jsx';   /* becomes /pulse */
import CostManager from './pages/CostManager.jsx';
import Revenue from './pages/Revenue.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
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

import './styles/variables.css';
import './styles/globals.css';
import styles from './App.module.css';

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
  '/war-room':    'War Room',
  '/scooters':    'Scooters',
  '/pme':         'PME',
  '/pow':         'POW v3',
  '/costs':       'Costs',
  '/revenue':     'Revenue',
  '/investment':  'Investment',
  '/spr':         'SPR',
  '/settings':    'Settings',
};

function getTitle(pathname) {
  if (pathname.startsWith('/issues/')) return 'Issue';
  if (pathname.startsWith('/projects/')) return 'Project';
  if (pathname.startsWith('/scooters/')) return 'Scooter';
  return ROUTE_TITLES[pathname] || 'Omni';
}

/* ─── Loading screen ─── */
function LoadingScreen() {
  return (
    <div className={styles.loadingScreen}>
      {/* Asterism mark — theme-aware via `fg="var(--fg-strong)"`; rust accent stays rust on both themes */}
      <div className={styles.loadingMark}>
        <AsterismMark size={48} fg="var(--fg-strong)" />
      </div>
      <div className={styles.spinner} />
      <p className={styles.loadingText}>Loading Omni…</p>
    </div>
  );
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

/* ─── Admin app shell ─── */
function AppShell() {
  const { userRole } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const rootRef = useRef(null);

  /* Theme — also propagate to <html> so body/globals.css can read it */
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY) || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    return saved;
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  const toggleTheme = useCallback(() => {
    if (rootRef.current) {
      rootRef.current.classList.add('theme-transitioning');
      setTimeout(() => rootRef.current?.classList.remove('theme-transitioning'), 700);
    }
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }, []);

  /* ⌘K global shortcut */
  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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
  if (userRole === 'technician' || userRole === 'crew') {
    return <Navigate to="/crew" replace />;
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
            <Route path="/"               element={<ErrorBoundary><Home /></ErrorBoundary>} />
            <Route path="/issues"         element={<ErrorBoundary><Issues /></ErrorBoundary>} />
            <Route path="/issues/:id"     element={<ErrorBoundary><IssueDetail /></ErrorBoundary>} />
            <Route path="/pulse"          element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
            <Route path="/brief"          element={<ErrorBoundary><Home /></ErrorBoundary>} />
            <Route path="/notifications"  element={<ErrorBoundary><Notifications /></ErrorBoundary>} />
            <Route path="/projects"       element={<ErrorBoundary><Projects /></ErrorBoundary>} />
            <Route path="/projects/:id"   element={<ErrorBoundary><Projects /></ErrorBoundary>} />
            <Route path="/war-room"       element={<ErrorBoundary><WarRoomPage /></ErrorBoundary>} />
            <Route path="/investment"     element={<ErrorBoundary><Investment /></ErrorBoundary>} />
            <Route path="/costs"          element={<ErrorBoundary><CostManager /></ErrorBoundary>} />
            <Route path="/revenue"        element={<ErrorBoundary><Revenue /></ErrorBoundary>} />
            <Route path="/maintenance"    element={<ErrorBoundary><Maintenance /></ErrorBoundary>} />
            <Route path="/pow"            element={<ErrorBoundary><Pow /></ErrorBoundary>} />
            <Route path="/settings"       element={<ErrorBoundary><Settings /></ErrorBoundary>} />

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

              {/* Crew routes — lightweight shell, no heavy admin contexts */}
              <Route
                path="/crew/*"
                element={
                  <ProtectedRoute>
                    <MaintenanceProvider>
                      <RepairProcedureProvider>
                        <ErrorBoundary>
                          <CrewShell />
                        </ErrorBoundary>
                      </RepairProcedureProvider>
                    </MaintenanceProvider>
                  </ProtectedRoute>
                }
              />
              {/* Legacy /technician/* redirect */}
              <Route path="/technician/*" element={<Navigate to="/crew" replace />} />

              {/* Admin routes — always-on providers at root.
                  Phase 1.6a: Telemetry / Trip / ScooterConfig / Spr moved into route-scoped
                  wrappers inside AppShell (see ScooterScopedRoutes, SprScopedRoutes). */}
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
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
