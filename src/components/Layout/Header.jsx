import { useMemo } from 'react';
import { useCosts } from '../../context/CostContext.jsx';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useFleet } from '../../context/FleetContext.jsx';
import { Bike } from 'lucide-react';
import styles from './Header.module.css';

export default function Header({ title, subtitle, actions }) {
  const { config, loading } = useCosts();
  const { scooters } = useMaintenance();
  const { scopeByFleet, isAllFleets } = useFleet();

  // #558: show the live fleet-scoped scooter count (active fleet, or org total under
  // All Fleets); fall back to the config.fleetSize scalar only when no scooters loaded.
  const fleetCount = useMemo(() => {
    if (!scooters || scooters.length === 0) return config?.fleetSize;
    return isAllFleets ? scooters.length : (scopeByFleet(scooters).length || config?.fleetSize);
  }, [scooters, isAllFleets, scopeByFleet, config?.fleetSize]);

  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      <div className={styles.right}>
        {actions}
        <div className={styles.fleet}>
          <Bike size={16} className={styles.fleetIcon} />
          <span className={styles.fleetCount}>{loading ? '—' : fleetCount}</span>
          <span className={styles.fleetLabel}>scooters</span>
        </div>
      </div>
    </header>
  );
}
