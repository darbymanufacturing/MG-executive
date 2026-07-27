import { PLANNER_METRICS, PLANNER_METRIC_LABELS } from '../../utils/financialPlanner.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './Planner.module.css';

// Excel trend semantics (see task spec): 0 → blank, 1 → up, 2 → stable, -1 → down.
const TREND_GLYPH = { 1: '▲', 2: '=', '-1': '▼' };
const TREND_CLASS = { 1: styles.trendUp, 2: styles.trendStable, '-1': styles.trendDown };

function TrendChip({ value }) {
  if (value === null || value === undefined || value === 0) {
    return <div className={styles.trendCell} aria-hidden="true" />;
  }
  const glyph = TREND_GLYPH[value];
  if (!glyph) return <div className={styles.trendCell} aria-hidden="true" />;
  return (
    <div className={styles.trendCell}>
      <span className={`${styles.trendChip} ${TREND_CLASS[value] ?? ''}`}>{glyph}</span>
    </div>
  );
}

/**
 * One 6-month band of the Yearly Summary grid (band 0 = Jan–Jun, band 1 = Jul–Dec).
 * Layout is a single CSS grid: a label column, then 6 month columns with a narrow
 * trend-chip column before every month except JANUARY. Band 1 has a LEADING chip
 * column too — in the workbook, July carries a chip comparing July vs June
 * (YEAR SUMMARY!E19), so only the very first month of the year lacks one.
 */
export default function YearGrid({ months, trends, band, onSelectMonth }) {
  const start = band === 1 ? 6 : 0;
  const slice = (months || []).slice(start, start + 6);
  // Chip before month i? Every month except the year's first (January).
  const hasChipBefore = (i) => i > 0 || band === 1;

  return (
    <div className={styles.yearGridWrap}>
      <div className={`${styles.yearGrid} ${band === 1 ? styles.yearGridLeadingChip : ''}`}>
        {/* header row */}
        <div className={`${styles.cell} ${styles.cornerCell}`} />
        {slice.map((m, i) => (
          <div key={`h-${m?.key ?? i}`} className={styles.contentsWrap}>
            {hasChipBefore(i) && <div className={`${styles.cell} ${styles.chipHeaderCell}`} />}
            <button
              type="button"
              className={styles.monthPill}
              onClick={() => onSelectMonth?.(start + i)}
            >
              {m?.name ?? '—'}
            </button>
          </div>
        ))}

        {/* one row per planner metric, in the fixed 7-metric order */}
        {PLANNER_METRICS.map((metricKey) => (
          <div key={metricKey} className={styles.contentsWrap}>
            <div className={`${styles.cell} ${styles.rowLabel}`}>
              {PLANNER_METRIC_LABELS[metricKey]}
            </div>
            {slice.map((m, i) => {
              const monthIndex = start + i;
              const trendValue = trends?.[metricKey]?.[monthIndex];
              return (
                <div key={`${metricKey}-${m?.key ?? i}`} className={styles.contentsWrap}>
                  {hasChipBefore(i) && <TrendChip value={trendValue} />}
                  <div className={`${styles.cell} ${styles.valueCell}`}>
                    {formatEUR(m?.summary?.[metricKey] ?? 0)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {band === 1 && (
        <div className={styles.legend}>
          <span className={styles.legendTitle}>Comparison with Previous Month:</span>
          <span className={styles.legendItem}>
            <span className={`${styles.trendChip} ${styles.trendUp}`}>▲</span> Increase
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.trendChip} ${styles.trendStable}`}>=</span> Stable
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.trendChip} ${styles.trendDown}`}>▼</span> Decrease
          </span>
        </div>
      )}
    </div>
  );
}
