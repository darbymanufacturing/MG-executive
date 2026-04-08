import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
      <Sidebar />
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
