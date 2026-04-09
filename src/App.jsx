import { useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { CostProvider, useCosts } from './context/CostContext.jsx';
import { RevenueProvider } from './context/RevenueContext.jsx';
import Sidebar from './components/Layout/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CostManager from './pages/CostManager.jsx';
import Revenue from './pages/Revenue.jsx';
import Settings from './pages/Settings.jsx';
import './styles/variables.css';
import './styles/globals.css';
import styles from './App.module.css';

function AppShell() {
  const { loading } = useCosts();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <img src="/logo.svg" alt="XSlide" className={styles.loadingLogo} />
        <div className={styles.spinner} />
        <p className={styles.loadingText}>Connecting to cloud…</p>
      </div>
    );
  }

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
        <div
          className={styles.overlay}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className={styles.main}>
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/costs"    element={<CostManager />} />
          <Route path="/revenue"  element={<Revenue />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <CostProvider>
        <RevenueProvider>
          <AppShell />
        </RevenueProvider>
      </CostProvider>
    </BrowserRouter>
  );
}
