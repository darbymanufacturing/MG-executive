import { useState, useMemo } from 'react';
import { Trash2, TrendingUp } from 'lucide-react';
import RevenueIntroOverlay from '../components/Revenue/RevenueIntroOverlay.jsx';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import CsvImportPanel from '../components/Revenue/CsvImportPanel.jsx';
import RevenueTable from '../components/Revenue/RevenueTable.jsx';
import LocationSelector from '../components/Shared/LocationSelector.jsx';
import { useRevenue } from '../context/RevenueContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { formatEUR, formatTrips, formatKm } from '../utils/formatters.js';
import { totalRevenue, avgTripsPerDay, totalDistanceKm, totalTrips, filterRevenueByLocation } from '../utils/revenueCalculations.js';
import styles from './Revenue.module.css';

export default function Revenue() {
  const { revenueData, clearAllRevenue } = useRevenue();
  const { config } = useCosts();
  const locations = config.locations || [];
  const [clearConfirm, setClearConfirm] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [showIntro, setShowIntro] = useState(true);

  const filteredRevenue = useMemo(
    () => filterRevenueByLocation(revenueData, locationFilter),
    [revenueData, locationFilter]
  );

  const hasData = revenueData.length > 0;
  const allRev  = totalRevenue(filteredRevenue);
  const allKm   = totalDistanceKm(filteredRevenue);
  const allTrips= totalTrips(filteredRevenue);
  const avgTrips= avgTripsPerDay(filteredRevenue);

  return (
    <div className={styles.page}>
      {showIntro && <RevenueIntroOverlay onDone={() => setShowIntro(false)} />}
      <Header
        title="Revenue"
        subtitle="Import and browse daily revenue data from your platform CSV exports"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <LocationSelector locations={locations} value={locationFilter} onChange={setLocationFilter} />
            {hasData && (
              <Button variant="danger" size="sm" onClick={() => setClearConfirm(true)}>
                <Trash2 size={14} /> Clear Revenue Data
              </Button>
            )}
          </div>
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
              <span className={styles.statValue}>{filteredRevenue.length}</span>
            </div>
          </div>
        )}

        {/* CSV Import */}
        <CsvImportPanel locations={locations} />

        {/* Data table */}
        {hasData && (
          <div className={styles.tableSection}>
            <div className={styles.tableSectionHeader}>
              <TrendingUp size={16} className={styles.tableSectionIcon} />
              <h2 className={styles.tableSectionTitle}>Daily Revenue Records</h2>
            </div>
            <RevenueTable data={filteredRevenue} />
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
