import { useState, useMemo } from 'react';
import {
  LayoutDashboard, Wrench, Package, BarChart2, Settings, Database,
} from 'lucide-react';
// Package, BarChart2, Settings used in TABS icon array below
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import MaintenanceIntroOverlay from '../components/Maintenance/MaintenanceIntroOverlay.jsx';
import OverviewTab from '../components/Maintenance/tabs/OverviewTab.jsx';
import RepairLogTab from '../components/Maintenance/tabs/RepairLogTab.jsx';
import PartsTab from '../components/Maintenance/tabs/PartsTab.jsx';
import AnalyticsTab from '../components/Maintenance/tabs/AnalyticsTab.jsx';
import SettingsTab from '../components/Maintenance/tabs/SettingsTab.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import styles from './Maintenance.module.css';

const TABS = [
  { id: 'overview',    label: 'Overview',        icon: LayoutDashboard },
  { id: 'repairlog',   label: 'Repair Log',       icon: Wrench },
  { id: 'parts',       label: 'Parts Pipeline',   icon: Package },
  { id: 'analytics',   label: 'Analytics',        icon: BarChart2 },
  { id: 'settings',    label: 'Settings',         icon: Settings },
];

export default function Maintenance() {
  const { tickets, parts, loadSeedData } = useMaintenance();
  const { config: costConfig } = useCosts();
  const locations = costConfig.locations?.length ? costConfig.locations : ['Corinth', 'Nafplion'];

  const [activeTab,   setActiveTab]   = useState('overview');
  const [city,        setCity]        = useState('');
  const [showIntro,   setShowIntro]   = useState(true);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedDone,    setSeedDone]    = useState(false);

  const filteredTickets = useMemo(
    () => (city ? tickets.filter((t) => t.city === city) : tickets),
    [tickets, city],
  );

  async function handleSeedLoad() {
    if (!loadSeedData) return;
    setSeedLoading(true);
    await loadSeedData();
    setSeedLoading(false);
    setSeedDone(true);
  }

  return (
    <div className={styles.page}>
      {showIntro && <MaintenanceIntroOverlay onDone={() => setShowIntro(false)} />}

      <Header
        title="Maintenance"
        subtitle="Fleet repair tracking &amp; parts pipeline"
        actions={
          <div className={styles.headerControls}>
            <span className={styles.cityLabel}>City:</span>
            <select
              className={styles.citySelect}
              value={city}
              onChange={(e) => setCity(e.target.value)}
            >
              <option value="">All Cities</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>
        }
      />

      <div className={styles.content}>
        {/* Seed banner */}
        {tickets.length === 0 && parts.length === 0 && (
          <div className={styles.seedBanner}>
            <Database size={16} />
            <span>No maintenance data yet. Load the existing Xslide fleet data.</span>
            <Button
              variant="primary"
              size="sm"
              disabled={seedLoading || seedDone}
              onClick={handleSeedLoad}
            >
              {seedLoading ? 'Loading…' : seedDone ? 'Loaded ✓' : 'Load Existing Data'}
            </Button>
          </div>
        )}

        {/* Tab bar */}
        <div className={styles.tabs}>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className={styles.tabContent}>
          {activeTab === 'overview' && (
            <OverviewTab filteredTickets={filteredTickets} />
          )}
          {activeTab === 'repairlog' && (
            <RepairLogTab filteredTickets={filteredTickets} city={city} setCity={setCity} />
          )}
          {activeTab === 'parts' && (
            <PartsTab />
          )}
          {activeTab === 'analytics' && (
            <AnalyticsTab filteredTickets={filteredTickets} />
          )}
          {activeTab === 'settings' && (
            <SettingsTab />
          )}
        </div>
      </div>
    </div>
  );
}
