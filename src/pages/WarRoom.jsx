import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Crosshair } from 'lucide-react';
import GreeceMap from '../components/WarRoom/GreeceMap.jsx';
import { useCosts }       from '../context/CostContext.jsx';
import { useRevenue }     from '../context/RevenueContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { revenuePerCityBreakdown } from '../utils/revenueCalculations.js';
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

  // All-time revenue breakdown per city
  const cityData = useMemo(
    () => revenuePerCityBreakdown(revenueData, scooters, locations),
    [revenueData, scooters, locations],
  );

  // Also include cities that have scooters but no revenue yet (so they show on map)
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

  function handleBack() {
    setExiting(true);
    setTimeout(() => navigate(-1), 400);
  }

  // ESC key also exits
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') handleBack();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const activeCityCount = allCityData.filter((d) => d.activeScooters > 0).length;

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

        <div className={styles.topRight}>
          <span className={styles.dateLabel}>{todayLabel()}</span>
          <span className={styles.cityCount}>
            {activeCityCount} active {activeCityCount === 1 ? 'city' : 'cities'}
          </span>
        </div>
      </div>

      {/* ── Map ── */}
      <div className={styles.mapContainer}>
        <GreeceMap cityData={allCityData} />
        {/* Scanlines + vignette for tactical atmosphere */}
        <div className={styles.scanlines} />
        <div className={styles.vignette} />
      </div>
    </div>
  );
}
