import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { CostProvider, useCosts } from './context/CostContext.jsx';
import { RevenueProvider } from './context/RevenueContext.jsx';
import { SprProvider } from './context/SprContext.jsx';
import { MaintenanceProvider } from './context/MaintenanceContext.jsx';
import { ProjectProvider } from './context/ProjectContext.jsx';
import { DiaryProvider } from './context/DiaryContext.jsx';
import { NotificationProvider } from './context/NotificationContext.jsx';
import DiaryBubble from './components/Diary/DiaryBubble.jsx';
import Sidebar from './components/Layout/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CostManager from './pages/CostManager.jsx';
import Revenue from './pages/Revenue.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import Spr from './pages/Spr.jsx';
import Maintenance from './pages/Maintenance.jsx';
import Projects from './pages/Projects.jsx';
import WarRoomPage from './pages/WarRoom.jsx';
import './styles/variables.css';
import './styles/globals.css';
import styles from './App.module.css';

/** Shows during auth check and Firestore load */
function LoadingScreen() {
  return (
    <div className={styles.loadingScreen}>
      <img src="/logo.svg" alt="XSlide" className={styles.loadingLogo} />
      <div className={styles.spinner} />
      <p className={styles.loadingText}>Connecting to cloud…</p>
    </div>
  );
}

/** Redirects to /login if not authenticated */
function ProtectedRoute({ children }) {
  const { user, authLoading } = useAuth();
  if (authLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppShell() {
  const { loading } = useCosts();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Preload Mapbox + WarRoom chunk in the background after app is ready
  // so War Room opens near-instantly when the user navigates to /war-room
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      import('mapbox-gl').catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [loading]);

  if (loading) return <LoadingScreen />;

  return (
    <div className={styles.layout}>
      {/* Mobile top bar */}
      <div className={styles.mobileTopBar}>
        <img src="/logo.svg" alt="XSlide" className={styles.mobileLogoImg} />
        <button
          className={styles.menuBtn}
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Overlay (mobile only) */}
      {sidebarOpen && (
        <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className={styles.main}>
        <Routes>
          <Route path="/"              element={<Dashboard />} />
          <Route path="/projects"      element={<Projects />} />
          <Route path="/projects/:id"  element={<Projects />} />
          <Route path="/war-room"      element={<WarRoomPage />} />
          <Route path="/costs"         element={<CostManager />} />
          <Route path="/revenue"       element={<Revenue />} />
          <Route path="/spr"           element={<Spr />} />
          <Route path="/maintenance"   element={<Maintenance />} />
          <Route path="/settings"      element={<Settings />} />
        </Routes>
      </main>

      {/* Diary bubble — floats above all content including War Room (z-index 300) */}
      <DiaryBubble />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<Login />} />

          {/* Protected — everything else */}
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <CostProvider>
                  <RevenueProvider>
                    <SprProvider>
                      <MaintenanceProvider>
                        <ProjectProvider>
                          <NotificationProvider>
                            <DiaryProvider>
                              <AppShell />
                            </DiaryProvider>
                          </NotificationProvider>
                        </ProjectProvider>
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
