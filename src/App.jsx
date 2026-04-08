import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CostProvider } from './context/CostContext.jsx';
import Sidebar from './components/Layout/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CostManager from './pages/CostManager.jsx';
import Settings from './pages/Settings.jsx';
import './styles/variables.css';
import './styles/globals.css';
import styles from './App.module.css';

export default function App() {
  return (
    <BrowserRouter>
      <CostProvider>
        <div className={styles.layout}>
          <Sidebar />
          <main className={styles.main}>
            <Routes>
              <Route path="/"         element={<Dashboard />} />
              <Route path="/costs"    element={<CostManager />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </CostProvider>
    </BrowserRouter>
  );
}
