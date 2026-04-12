import { formatEUR } from '../../utils/formatters.js';
import styles from './CityNode.module.css';

/**
 * CityNode — rendered inside a react-map-gl <Marker>.
 * Shows a pulsing branded dot, city name label, and a small stats card.
 *
 * @param {object} data — { city, revenue, trips, activeScooters, revenuePerScooter }
 * @param {number} index — used to stagger pulse animation delay
 */
export default function CityNode({ data, index = 0 }) {
  const delay = `${(index * 0.35).toFixed(2)}s`;
  const hasData = data.revenue > 0 || data.activeScooters > 0;

  return (
    <div className={styles.wrapper}>
      {/* Pulsing dot */}
      <div className={styles.dotWrap}>
        <div className={styles.dot} />
        <div className={styles.pulseRing} style={{ animationDelay: delay }} />
      </div>

      {/* City name */}
      <span className={styles.label}>{data.city}</span>

      {/* Stats card */}
      <div className={styles.card}>
        {hasData ? (
          <>
            <div className={styles.cardRow}>
              <span className={styles.cardKey}>Scooters</span>
              <span className={styles.cardVal}>{data.activeScooters}</span>
            </div>
            <div className={styles.cardRow}>
              <span className={styles.cardKey}>Revenue</span>
              <span className={styles.cardVal}>{formatEUR(data.revenue)}</span>
            </div>
            {data.revenuePerScooter != null && (
              <div className={styles.cardRow}>
                <span className={styles.cardKey}>Per scooter</span>
                <span className={styles.cardVal}>{formatEUR(data.revenuePerScooter)}</span>
              </div>
            )}
          </>
        ) : (
          <span className={styles.cardEmpty}>No data yet</span>
        )}
      </div>
    </div>
  );
}
