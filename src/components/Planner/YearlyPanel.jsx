import { useCallback, useState } from 'react';
import { PLANNER_METRICS, PLANNER_METRIC_LABELS } from '../../utils/financialPlanner.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './Planner.module.css';

const LABEL_CLASS = {
  revenue: styles.labelRevenue,
  expenses: styles.labelExpenses,
};

/**
 * Right-column "YEARLY SUMMARY" card — the 7 planner metrics stacked. OPENING
 * BALANCE is the Excel template's manual input cell — but only for the EARLIEST
 * data year: later years chain from the previous December's closing
 * (openingDerived, CASH-VIEW §3) and render read-only with a "= DEC Y−1
 * CLOSING" note. CLOSING BALANCE is computed (opening + retained), read-only.
 */
export default function YearlyPanel({ yearly, year, openingBalance, onCommitOpening, openingDerived = false }) {
  // Reset the in-progress draft whenever the committed value or selected year
  // changes — done during render (React's documented "adjusting state" pattern,
  // https://react.dev/learn/you-might-not-need-an-effect) rather than in a
  // useEffect, so switching years can't leak the previous year's draft.
  const syncKey = `${year}:${openingBalance}`;
  const [lastSyncKey, setLastSyncKey] = useState(syncKey);
  const [draft, setDraft] = useState(String(openingBalance ?? 0));
  if (syncKey !== lastSyncKey) {
    setLastSyncKey(syncKey);
    setDraft(String(openingBalance ?? 0));
  }

  const commit = useCallback(() => {
    onCommitOpening?.(draft);
  }, [draft, onCommitOpening]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  }, []);

  return (
    <aside className={styles.yearlyPanel}>
      <div className={styles.blackPill}>YEARLY SUMMARY</div>
      <div className={styles.summaryBody}>
        {PLANNER_METRICS.map((metricKey) => (
          <div key={metricKey} className={styles.summaryRow}>
            <span className={`${styles.summaryLabel} ${LABEL_CLASS[metricKey] ?? ''}`}>
              {PLANNER_METRIC_LABELS[metricKey]}
            </span>
            {metricKey === 'opening' ? (
              openingDerived ? (
                <span className={styles.derivedOpening}>
                  <span className={`${styles.summaryValue} ${styles.greyValue}`}>
                    {formatEUR(openingBalance ?? 0)}
                  </span>
                  <span className={styles.derivedNote}>= DEC {year - 1} CLOSING</span>
                </span>
              ) : (
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  className={styles.openingInput}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commit}
                  onKeyDown={handleKeyDown}
                  aria-label="Opening balance"
                />
              )
            ) : (
              <span
                className={`${styles.summaryValue} ${metricKey === 'closing' ? styles.greyValue : ''}`}
              >
                {formatEUR(yearly?.[metricKey] ?? 0)}
              </span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
