import styles from './Money.module.css';
import { getHealthColor } from '../../utils/financialHealth.js';

/**
 * Traffic-light health chips (ADR-0025) — reuses the existing health engine's
 * thresholds via getHealthColor. A metric with no input (e.g. DSCR when no debt
 * service is configured) renders muted "—" rather than a misleading colour.
 */
export default function HealthChips({ ebitdaMargin, dscr, costRecovery }) {
  const defs = [
    { key: 'ebitdaMargin', label: 'EBITDA margin', value: ebitdaMargin, fmt: (v) => `${Math.round(v)}%` },
    { key: 'dscr', label: 'Loan coverage', value: dscr, fmt: (v) => `${v.toFixed(2)}×` },
    { key: 'costRecovery', label: 'Cost recovery', value: costRecovery, fmt: (v) => `${v.toFixed(2)}×` },
  ];

  return (
    <div className={styles.chips}>
      <span className={styles.chipsLabel}>Health</span>
      {defs.map((d) => {
        const has = typeof d.value === 'number' && isFinite(d.value);
        const color = has ? getHealthColor(d.key, d.value) : 'muted';
        return (
          <span key={d.key} className={`${styles.chip} ${styles[color]}`}>
            {d.label} {has ? d.fmt(d.value) : '—'}
          </span>
        );
      })}
    </div>
  );
}
