import { useState, useMemo } from 'react';
import { Trash2, TrendingUp, Info } from 'lucide-react';
import RevenueIntroOverlay from '../components/Revenue/RevenueIntroOverlay.jsx';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import CsvImportPanel from '../components/Revenue/CsvImportPanel.jsx';
import RevenueTable from '../components/Revenue/RevenueTable.jsx';
import LocationSelector from '../components/Shared/LocationSelector.jsx';
import Skeleton from '../components/Shared/Skeleton.jsx';
import { useRevenue } from '../context/RevenueContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useFleet } from '../context/FleetContext.jsx';
import FleetScopeChip from '../components/Shared/FleetScopeChip.jsx';
import { formatEUR, formatTrips, formatKm } from '../utils/formatters.js';
import { totalRevenue, avgTripsPerDay, totalDistanceKm, totalTrips, filterRevenueByLocation } from '../utils/revenueCalculations.js';
import styles from './Revenue.module.css';

export default function Revenue() {
  const { revenueData, revenueLoading, clearAllRevenue } = useRevenue();
  const { config } = useCosts();
  const locations = config.locations || [];
  const { scopeByFleet } = useFleet(); // FF-3 — scope revenue to the active fleet
  const [clearConfirm, setClearConfirm] = useState(false);
  const [locationFilter, setLocationFilter] = useState('all');
  const [showIntro, setShowIntro] = useState(false); // module intro animation removed — only the opening Omni loader animates

  const filteredRevenue = useMemo(
    () => filterRevenueByLocation(scopeByFleet(revenueData), locationFilter),
    [revenueData, locationFilter, scopeByFleet]
  );

  const hasData = revenueData.length > 0;
  const allRev  = totalRevenue(filteredRevenue);
  const allKm   = totalDistanceKm(filteredRevenue);
  const allTrips= totalTrips(filteredRevenue);
  const avgTrips= avgTripsPerDay(filteredRevenue);

  return (
    <div className={styles.page}>
      {showIntro && <RevenueIntroOverlay onDone={() => { localStorage.setItem('omni_revenue_intro_seen', '1'); setShowIntro(false); }} />}
      <Header
        title="Revenue"
        subtitle="Import and browse daily revenue data from your platform CSV exports"
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <FleetScopeChip />
            <LocationSelector locations={locations} value={locationFilter} onChange={setLocationFilter} />
            {hasData && (
              <Button variant="danger" size="sm" onClick={() => setClearConfirm(true)}>
                <Trash2 size={14} /> Clear Revenue Data
              </Button>
            )}
          </div>
        }
      />

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-4)', background: 'var(--bg-subtle, #F8F9FA)', borderBottom: '1px solid var(--border-muted, #E5E7EB)', fontSize: '0.78rem', color: 'var(--fg-muted, #6B7280)', lineHeight: 1.4 }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Revenue figures are <strong>ex-VAT</strong> (24% Greek VAT excluded). Hopp&apos;s web UI shows the same amounts including VAT — divide any Hopp figure by 1.24 to reconcile.</span>
      </div>

      <div className={styles.content}>
        {/* Loading skeleton */}
        {revenueLoading && (
          <>
            <div className={styles.statsRow}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div className={styles.statCard} key={i}>
                  <Skeleton variant="text" lines={2} height="18px" />
                </div>
              ))}
            </div>
            <Skeleton height="280px" radius="var(--radius-lg)" style={{ marginTop: 'var(--space-4)' }} />
          </>
        )}

        {/* Summary stats (only when data exists) */}
        {!revenueLoading && hasData && (
          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Total Revenue (all time)</span>
              <span className={styles.statValue} style={{ color: 'var(--color-success)' }}>{formatEUR(allRev)}</span>
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
        {!revenueLoading && <CsvImportPanel locations={locations} />}

        {/* Data table */}
        {!revenueLoading && hasData && (
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
