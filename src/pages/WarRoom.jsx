import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import GreeceMap    from '../components/WarRoom/GreeceMap.jsx';
import ProjectsHUD  from '../components/WarRoom/ProjectsHUD.jsx';
import { useCosts }       from '../context/CostContext.jsx';
import { useRevenue }     from '../context/RevenueContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { useFleet } from '../context/FleetContext.jsx';
import FleetScopeChip from '../components/Shared/FleetScopeChip.jsx';
import { revenuePerCityBreakdown } from '../utils/revenueCalculations.js';
import { formatEURCompact } from '../utils/formatters.js';
import styles from './WarRoom.module.css';

function todayLabel() {
  return new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export default function WarRoom() {
  const navigate = useNavigate();
  const [exiting, setExiting] = useState(false);
  const exitTimer = useRef(null);

  const { config }      = useCosts();
  const { revenueData } = useRevenue();
  const { scooters }    = useMaintenance();
  const { scopeByFleet, activeFleet, isAllFleets } = useFleet();

  const allLocations = config.locations || [];
  // FF-3 — scope the map to the active fleet's cities (All Fleets = every city).
  const locations = isAllFleets ? allLocations : (activeFleet?.cities ?? allLocations);
  const scopedScooters = useMemo(() => scopeByFleet(scooters), [scopeByFleet, scooters]);
  const scopedRevenue  = useMemo(() => scopeByFleet(revenueData), [scopeByFleet, revenueData]);

  const cityData = useMemo(
    () => revenuePerCityBreakdown(scopedRevenue, scopedScooters, locations),
    [scopedRevenue, scopedScooters, locations],
  );

  const allCityData = useMemo(() => {
    const withData = new Set(cityData.map((d) => d.city));
    const scooterOnlyCities = locations
      .filter((loc) => !withData.has(loc))
      .map((loc) => {
        const cityScooters = scopedScooters.filter((s) => s.city === loc);
        return {
          city: loc,
          revenue: 0,
          trips: 0,
          activeScooters:   cityScooters.filter((s) => s.status === 'Active').length,
          totalScooters:    cityScooters.length,
          revenuePerScooter: null,
        };
      });
    return [...cityData, ...scooterOnlyCities];
  }, [cityData, locations, scopedScooters]);

  // Quick stats for top-right HUD
  const totalRevenue     = cityData.reduce((s, d) => s + d.revenue, 0);
  const totalScooters    = scopedScooters.filter((s) => s.status === 'Active').length;
  const activeCityCount  = allCityData.filter((d) => d.activeScooters > 0).length;

  const handleBack = useCallback(() => {
    if (exitTimer.current) return;
    setExiting(true);
    exitTimer.current = setTimeout(() => navigate(-1), 400);
  }, [navigate]);

  useEffect(() => {
    return () => { if (exitTimer.current) clearTimeout(exitTimer.current); };
  }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') handleBack(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleBack]);

  return (
    <div className={`${styles.overlay} ${exiting ? styles.exiting : ''}`}>
      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={handleBack}>
          <ChevronLeft size={14} />
          Exit
        </button>

        <div className={styles.titleBlock}>
          <span className={styles.title}>War Room</span>
          <span className={styles.subtitle}>Omni Operations · Greece</span>
        </div>
        <FleetScopeChip style={{ marginLeft: 12 }} />

        {/* Top-right quick stats (Victoria 3 resource bar style) */}
        <div className={styles.statsBar}>
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Revenue</span>
            <span className={styles.statValue}>{formatEURCompact(totalRevenue)}</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Active Scooters</span>
            <span className={styles.statValue}>{totalScooters}</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <span className={styles.statLabel}>Cities</span>
            <span className={styles.statValue}>{activeCityCount}</span>
          </div>
          <div className={styles.statDivider} />
          <span className={styles.dateLabel}>{todayLabel()}</span>
        </div>
      </div>

      {/* ── Map + HUD overlays ── */}
      <div className={styles.mapContainer}>
        <GreeceMap cityData={allCityData} />

        {/* Left HUD panel — Projects & Decision Gates */}
        <ProjectsHUD />

        {/* Vignette for atmosphere */}
        <div className={styles.vignette} />
      </div>
    </div>
  );
}
