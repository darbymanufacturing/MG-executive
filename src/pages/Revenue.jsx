import { useState } from 'react';
import { Trash2, TrendingUp } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import CsvImportPanel from '../components/Revenue/CsvImportPanel.jsx';
import RevenueTable from '../components/Revenue/RevenueTable.jsx';
import { useRevenue } from '../context/RevenueContext.jsx';
import { formatEUR, formatTrips, formatKm } from '../utils/formatters.js';
import { totalRevenue, avgTripsPerDay, totalDistanceKm, totalTrips } from '../utils/revenueCalculations.js';
import styles from './Revenue.module.css';

export default function Revenue() {
  const { revenueData, clearAllRevenue } = useRevenue();
  const [clearConfirm, setClearConfirm] = useState(false);

  const hasData = revenueData.length > 0;
  const allRev  = totalRevenue(revenueData);
  const allKm   = totalDistanceKm(revenueData);
  const allTrips= totalTrips(revenueData);
  const avgTrips= avgTripsPerDay(revenueData);

  return (
    <div className={styles.page}>
      <Header
        title="Revenue"
        subtitle="Import and browse daily revenue data from your platform CSV exports"
        actions={
          hasData && (
            <Button variant="danger" size="sm" onClick={() => setClearConfirm(true)}>
              <Trash2 size={14} /> Clear Revenue Data
            </Button>
          )
        }
      />

      <div className={styles.content}>
        {/* Summary stats (only when data exists) */}
        {hasData && (
          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Total Revenue (all time)</span>
              <span className={styles.statValue} style={{ color: '#4CAF50' }}>{formatEUR(allRev)}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Total Trips</span>
              <span className={styles.statValue}>{formatTrips(allTrips)}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Avg Trips / Day</span>
              <span className={styles.statValue}>{formatTrips(avgTrips)}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Total Distance</span>
              <span className={styles.statValue}>{formatKm(allKm)}</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Days Imported</span>
              <span className={styles.statValue}>{revenueData.length}</span>
            </div>
          </div>
        )}

        {/* CSV Import */}
        <CsvImportPanel />

        {/* Data table */}
        {hasData && (
          <div className={styles.tableSection}>
            <div className={styles.tableSectionHeader}>
              <TrendingUp size={16} className={styles.tableSectionIcon} />
              <h2 className={styles.tableSectionTitle}>Daily Revenue Records</h2>
            </div>
            <RevenueTable />
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={clearConfirm}
        onClose={() => setClearConfirm(false)}
        onConfirm={clearAllRevenue}
        title="Clear Revenue Data"
        message="This will permanently delete all imported revenue records. This cannot be undone."
        confirmLabel="Clear All"
      />
    </div>
  );
}
