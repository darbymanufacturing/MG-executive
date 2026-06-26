import { Calculator } from 'lucide-react';
import styles from './Money.module.css';
import { formatEUR } from '../../utils/formatters.js';

/**
 * "Show how each number is calculated" (ADR-0025) — a founder-facing, non-dev
 * version of the Numbers Inspector. Makes the headline figures auditable, so the
 * Money overview is provably the single source of truth (every number here is the
 * same value the rest of the app reads from the hub).
 */
export default function ShowTheMath({ summary, upcoming }) {
  if (!summary) return null;
  const r = summary.revenue || {};
  const rows = [
    { name: 'Money in (operating revenue)', formula: 'gross − Hopp fee (19%) − SIM', value: formatEUR(r.operatingRevenue) },
    { name: 'Money out (costs this period)', formula: 'monthly run-rate × months + one-time in period', value: formatEUR(summary.displayTotal) },
    { name: 'Net', formula: 'money in − money out', value: formatEUR(summary.displayPnL) },
    { name: 'Per-scooter cost', formula: 'monthly costs ÷ active fleet', value: `${formatEUR(summary.perScooterMonthly)} /mo` },
  ];
  if (upcoming) {
    rows.push({
      name: `Coming (next ${upcoming.horizonDays} days)`,
      formula: 'projected from each cost’s frequency + start date',
      value: formatEUR(upcoming.total),
    });
  }
  const inp = summary._inputs || {};

  return (
    <details className={styles.math}>
      <summary className={styles.mathSummary}>
        <Calculator size={15} aria-hidden="true" /> Show how each number is calculated
      </summary>
      <div className={styles.mathBody}>
        {rows.map((row) => (
          <div key={row.name} className={styles.mathRow}>
            <div className={styles.mathName}>
              {row.name} = <span className={styles.mathValue}>{row.value}</span>
            </div>
            <div className={styles.mathFormula}>{row.formula}</div>
          </div>
        ))}
        <div className={styles.mathInputs}>
          Based on {inp.costCount ?? 0} cost rows · {inp.revenueRowCount ?? 0} revenue rows · fleet{' '}
          {summary.fleetSizeEffective ?? '—'}. These are the same numbers used across the app — one source of truth.
        </div>
      </div>
    </details>
  );
}
