import { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { CostProvider, useCosts } from './context/CostContext.jsx';
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
      <div className={styles.loadingMark}>
        <svg width="42" height="42" viewBox="0 0 26 26" fill="none">
          <rect width="26" height="26" rx="7" fill="var(--accent, #A0521D)" />
          <path d="M7 13C7 9.69 9.69 7 13 7s6 2.69 6 6-2.69 6-6 6-6-2.69-6-6z" stroke="#fff" strokeWidth="2.2" fill="none"/>
          <circle cx="13" cy="13" r="2.2" fill="#fff"/>
        </svg>
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

/* ─── Admin app shell ─── */
function AppShell() {
  const { loading } = useCosts();
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

  /* Preload Mapbox */
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => { import('mapbox-gl').catch(() => {}); }, 2000);
    return () => clearTimeout(t);
  }, [loading]);

  /* Redirect crew to /crew shell */
  if (userRole === 'technician' || userRole === 'crew') {
    return <Navigate to="/crew" replace />;
  }

  if (loading) return <LoadingScreen />;

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
            <Route path="/"               element={<Home />} />
            <Route path="/issues"         element={<Issues />} />
            <Route path="/issues/:id"     element={<IssueDetail />} />
            <Route path="/pulse"          element={<Dashboard />} />      {/* old Dashboard = Pulse */}
            <Route path="/brief"          element={<Home />} />            {/* brief shown inside Home */}
            <Route path="/notifications"  element={<Notifications />} />
            <Route path="/projects"       element={<Projects />} />
            <Route path="/projects/:id"   element={<Projects />} />
            <Route path="/war-room"       element={<WarRoomPage />} />
            <Route path="/scooters"       element={<Scooters />} />
            <Route path="/scooters/:id"   element={<ScooterDetail />} />
            <Route path="/investment"     element={<Investment />} />
            <Route path="/costs"          element={<CostManager />} />
            <Route path="/revenue"        element={<Revenue />} />
            <Route path="/spr"            element={<Spr />} />
            <Route path="/maintenance"    element={<Maintenance />} />
            <Route path="/pme"            element={<PredictiveMaintenance />} />
            <Route path="/pow"            element={<Pow />} />
            <Route path="/settings"       element={<Settings />} />
            {/* Redirect old paths */}
            <Route path="/technician"     element={<Navigate to="/crew" replace />} />
            <Route path="/dashboard"      element={<Navigate to="/pulse" replace />} />
            <Route path="*"              element={<Navigate to="/" replace />} />
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
                    <CrewShell />
                  </RepairProcedureProvider>
                </MaintenanceProvider>
              </ProtectedRoute>
            }
          />
          {/* Legacy /technician/* redirect */}
          <Route path="/technician/*" element={<Navigate to="/crew" replace />} />

          {/* Admin routes — full provider stack */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <CostProvider>
                  <RevenueProvider>
                    <SprProvider>
                      <MaintenanceProvider>
                        <RepairProcedureProvider>
                          <RepairSessionProvider>
                            <TelemetryProvider>
                              <ScooterConfigProvider>
                                <TripProvider>
                                  <ProjectProvider>
                                    <IssueProvider>
                                      <InboxProvider>
                                        <NotificationProvider>
                                          <DiaryProvider>
                                            <AppShell />
                                          </DiaryProvider>
                                        </NotificationProvider>
                                      </InboxProvider>
                                    </IssueProvider>
                                  </ProjectProvider>
                                </TripProvider>
                              </ScooterConfigProvider>
                            </TelemetryProvider>
                          </RepairSessionProvider>
                        </RepairProcedureProvider>
                      </MaintenanceProvider>
                    </SprProvider>
                  </RevenueProvider>
                </CostProvider>
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
