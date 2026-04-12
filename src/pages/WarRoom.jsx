import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import GreeceMap    from '../components/WarRoom/GreeceMap.jsx';
import ProjectsHUD  from '../components/WarRoom/ProjectsHUD.jsx';
import { useCosts }       from '../context/CostContext.jsx';
import { useRevenue }     from '../context/RevenueContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
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

  const { config }      = useCosts();
  const { revenueData } = useRevenue();
  const { scooters }    = useMaintenance();

  const locations = config.locations || [];

  const cityData = useMemo(
    () => revenuePerCityBreakdown(revenueData, scooters, locations),
    [revenueData, scooters, locations],
  );

  const allCityData = useMemo(() => {
    const withData = new Set(cityData.map((d) => d.city));
    const scooterOnlyCities = locations
      .filter((loc) => !withData.has(loc))
      .map((loc) => ({
        city: loc,
        revenue: 0,
        trips: 0,
        activeScooters: scooters.filter((s) => s.city === loc && s.status === 'Active').length,
        revenuePerScooter: null,
      }));
    return [...cityData, ...scooterOnlyCities];
  }, [cityData, locations, scooters]);

  // Quick stats for top-right HUD
  const totalRevenue     = cityData.reduce((s, d) => s + d.revenue, 0);
  const totalScooters    = scooters.filter((s) => s.status === 'Active').length;
  const activeCityCount  = allCityData.filter((d) => d.activeScooters > 0).length;

  function handleBack() {
    setExiting(true);
    setTimeout(() => navigate(-1), 400);
  }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') handleBack(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          <span className={styles.subtitle}>XSlide Operations · Greece</span>
        </div>

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
