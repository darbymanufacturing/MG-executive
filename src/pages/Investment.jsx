import { useState } from 'react';
import { TrendingUp, List } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import FleetRoiTab from '../components/Investment/FleetRoiTab.jsx';
import ScooterLedgerTab from '../components/Investment/ScooterLedgerTab.jsx';
import styles from './Investment.module.css';

const TABS = [
  { id: 'roi',    label: 'Fleet ROI',      icon: TrendingUp },
  { id: 'ledger', label: 'Scooter Ledger', icon: List },
];

export default function Investment() {
  const [activeTab, setActiveTab] = useState('roi');

  return (
    <div className={styles.page}>
      <Header
        title="Investment Tracker"
        subtitle="Fleet ROI projections and per-scooter P&L"
      />

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`${styles.tabBtn} ${activeTab === id ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={styles.content}>
        {activeTab === 'roi'    && <FleetRoiTab />}
        {activeTab === 'ledger' && <ScooterLedgerTab />}
      </div>
    </div>
  );
}
