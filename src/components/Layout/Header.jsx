import { useCosts } from '../../context/CostContext.jsx';
import { Bike } from 'lucide-react';
import styles from './Header.module.css';

export default function Header({ title, subtitle, actions }) {
  const { config } = useCosts();

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
          <span className={styles.fleetCount}>{config.fleetSize}</span>
          <span className={styles.fleetLabel}>scooters</span>
        </div>
      </div>
    </header>
  );
}
