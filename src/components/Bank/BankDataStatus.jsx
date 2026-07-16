import { useMemo } from 'react';
import { Database, CalendarCheck, History } from 'lucide-react';
import { useCosts } from '../../context/CostContext.jsx';
import { bankImportHistory, freshnessLevel, freshnessLabel } from '../../utils/bankImportHistory.js';
import { formatDate, formatEUR } from '../../utils/formatters.js';
import styles from './BankDataStatus.module.css';

const MAX_BATCHES = 5;

/** '2026-06-30T05:24:33Z' → '30 Jun 2026, 05:24' */
function importedAtLabel(iso) {
  if (!iso || iso === 'unknown') return 'Unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * "Your bank data" — how current the imported bank history is, and what to export next.
 * Everything is DERIVED from the cost rows the CSV import already writes (no new table):
 * see src/utils/bankImportHistory.js. Bank data is company-wide, so this reads raw
 * useCosts().costs and is deliberately NOT fleet-scoped.
 */
export default function BankDataStatus() {
  const { costs, loading } = useCosts();
  const info = useMemo(() => bankImportHistory(costs || []), [costs]);

  // Don't flash "no data" while the first load is still in flight.
  if (loading && !(costs || []).length) return null;

  if (info.count === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.head}>
          <Database size={16} className={styles.headIcon} aria-hidden="true" />
          <span className={styles.headTitle}>Your bank data</span>
        </div>
        <p className={styles.empty}>
          No bank CSV imported yet — upload your first Alpha Bank export below.
        </p>
      </div>
    );
  }

  const level = freshnessLevel(info.daysSinceLatest);
  const batches = info.batches.slice(0, MAX_BATCHES);
  const more = info.batches.length - batches.length;

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <Database size={16} className={styles.headIcon} aria-hidden="true" />
        <span className={styles.headTitle}>Your bank data</span>
        <span className={styles.headMeta}>{info.count} transactions imported</span>
      </div>

      <div className={styles.latest}>
        <div className={styles.latestLeft}>
          <div className={styles.latestLabel}>Latest transaction</div>
          <div className={styles.latestDate}>{formatDate(info.latestTxn)}</div>
          <div className={styles.range}>
            Covers {formatDate(info.earliestTxn)} → {formatDate(info.latestTxn)}
          </div>
        </div>
        <span className={`${styles.badge} ${styles[level]}`}>
          {freshnessLabel(info.daysSinceLatest)}
        </span>
      </div>

      {info.nextExportFrom && (
        <div className={styles.nextExport}>
          <CalendarCheck size={14} aria-hidden="true" className={styles.nextIcon} />
          <span>
            Next export: from <strong>{formatDate(info.nextExportFrom)}</strong> onwards — anything
            earlier is already imported (re-importing is a safe no-op).
          </span>
        </div>
      )}

      <div className={styles.uploads}>
        <div className={styles.uploadsHead}>
          <History size={13} aria-hidden="true" /> Recent uploads
        </div>
        {batches.map((b) => (
          <div key={b.importedAt} className={styles.uploadRow}>
            <span className={styles.uploadWhen}>{importedAtLabel(b.importedAt)}</span>
            <span className={styles.uploadCount}>{b.count} txns</span>
            <span className={styles.uploadRange}>
              {formatDate(b.earliest)} – {formatDate(b.latest)}
            </span>
            <span className={styles.uploadTotal}>{formatEUR(b.total)}</span>
          </div>
        ))}
        {more > 0 && (
          <div className={styles.moreNote}>+{more} earlier upload{more > 1 ? 's' : ''}</div>
        )}
      </div>
    </div>
  );
}
