import { useState, useCallback } from 'react';
import { formatEUR } from '../../utils/formatters.js';
import styles from './CityNode.module.css';

/**
 * CityNode — rendered inside a react-map-gl <Marker>.
 * At rest: shows only a pulsing branded dot (avoids cards overlapping at
 * default zoom — bug #588).
 * On hover or click: expands to show the city name label + stats card.
 * Click-to-pin keeps the card open until a second click or blur.
 *
 * @param {object} data — { city, revenue, trips, activeScooters, revenuePerScooter }
 * @param {number} index — used to stagger pulse animation delay
 */
export default function CityNode({ data, index = 0 }) {
  const [hovered, setHovered]   = useState(false);
  const [pinned,  setPinned]    = useState(false);

  const isExpanded = hovered || pinned;

  const delay       = `${(index * 0.35).toFixed(2)}s`;
  const total       = data.totalScooters  ?? data.activeScooters ?? 0;
  const active      = data.activeScooters ?? 0;
  const hasData     = data.revenue > 0 || total > 0;
  const showBreakdown = total > 0 && active !== total;

  const handleClick = useCallback((e) => {
    e.stopPropagation();          // prevent map click-to-navigate
    setPinned(prev => !prev);
  }, []);

  const handleMouseEnter = useCallback(() => setHovered(true),  []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

  return (
    <div
      className={`${styles.wrapper} ${isExpanded ? styles.wrapperExpanded : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* Pulsing dot — always visible */}
      <div className={styles.dotWrap}>
        <div className={`${styles.dot} ${isExpanded ? styles.dotExpanded : ''}`} />
        <div className={styles.pulseRing} style={{ animationDelay: delay }} />
      </div>

      {/* City name + stats card — only when expanded */}
      {isExpanded && (
        <>
          <span className={styles.label}>{data.city}</span>

          <div className={styles.card}>
            {hasData ? (
              <>
                <div className={styles.cardRow}>
                  <span className={styles.cardKey}>Scooters</span>
                  <span className={styles.cardVal}>{total}</span>
                </div>
                {showBreakdown && (
                  <div className={styles.cardRow}>
                    <span className={styles.cardKey} style={{ opacity: 0.65 }}>↳ Active</span>
                    <span className={styles.cardVal} style={{ color: '#00C896', opacity: 0.9 }}>{active}</span>
                  </div>
                )}
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
        </>
      )}
    </div>
  );
}
