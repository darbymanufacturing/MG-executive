import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { useMetrics } from '../../context/MetricsContext.jsx';
import { scooterLedgerRow } from '../../utils/investmentCalculations.js';
import { formatEUR, formatPercent } from '../../utils/formatters.js';
import styles from './ScooterLedgerTab.module.css';

const SORT_KEYS = {
  scooterId:    (r) => r.scooterId,
  city:         (r) => r.city || '',
  purchasePrice:(r) => r.purchasePrice ?? -Infinity,
  monthsInService:(r) => r.monthsInService ?? -1,
  revenueTotal: (r) => r.revenueTotal,
  repairTotal:  (r) => r.repairTotal,
  netPosition:  (r) => r.netPosition,
  paybackPct:   (r) => r.paybackPct ?? -Infinity,
};

function SortIcon({ col, sortKey, dir }) {
  if (col !== sortKey) return <ChevronsUpDown size={13} className={styles.sortIcon} />;
  return dir === 'asc'
    ? <ChevronUp size={13} className={`${styles.sortIcon} ${styles.sortActive}`} />
    : <ChevronDown size={13} className={`${styles.sortIcon} ${styles.sortActive}`} />;
}

export default function ScooterLedgerTab() {
  const navigate = useNavigate();
  const { scooters, tickets, parts, config: maintConfig } = useMaintenance();
  const { revenueData } = useRevenue();
  const { config: costConfig } = useCosts();
  const { allTime } = useMetrics();
  const financial = costConfig?.financial ?? null;
  const labourRate = maintConfig?.labourRatePerHour ?? 0;
  // #558 / W5-ADR-0024 — fleet-count basis unified on the hub's live scooter total
  // (scooterCountTotal). The trailing || 1 preserves the #175 guard against a 0 divisor
  // when nothing is loaded. Deliberate change: this drops the old config.fleetSize middle
  // fallback so the ledger's per-scooter-share denominator matches the live count used
  // everywhere else — they're identical whenever scooters are loaded (the normal case).
  const defaultFleetSize = allTime.scooterCountTotal || 1;

  const [sortKey, setSortKey] = useState('netPosition');
  const [sortDir, setSortDir] = useState('asc'); // ascending = worst first (most negative)

  // Build all ledger rows — expensive but memoized
  const rows = useMemo(() =>
    scooters.map((s) => scooterLedgerRow(s, revenueData, tickets, parts, financial, labourRate, defaultFleetSize)),
  [scooters, revenueData, tickets, parts, financial, labourRate, defaultFleetSize]);

  // Sort
  const sorted = useMemo(() => {
    const fn = SORT_KEYS[sortKey] || ((r) => r[sortKey]);
    // #174 — stable three-way compare (was missing the equal case)
    return [...rows].sort((a, b) => {
      const av = fn(a), bv = fn(b);
      if (sortDir === 'asc') return av < bv ? -1 : av > bv ? 1 : 0;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });
  }, [rows, sortKey, sortDir]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  // Fleet totals
  const totals = useMemo(() => ({
    revenue: rows.reduce((s, r) => s + r.revenueTotal, 0),
    repair:  rows.reduce((s, r) => s + r.repairTotal, 0),
    net:     rows.reduce((s, r) => s + r.netPosition, 0),
  }), [rows]);

  return (
    <div className={styles.tab}>

      {/* Fleet totals strip */}
      <div className={styles.totalsStrip}>
        <div className={styles.total}>
          <span className={styles.totalLabel}>Fleet Revenue (est.)</span>
          <span className={`${styles.totalValue} ${styles.positive}`}>{formatEUR(totals.revenue)}</span>
        </div>
        <div className={styles.total}>
          <span className={styles.totalLabel}>Fleet Repair Cost</span>
          <span className={`${styles.totalValue} ${styles.warning}`}>{formatEUR(totals.repair)}</span>
        </div>
        <div className={styles.total}>
          <span className={styles.totalLabel}>Fleet Net (excl. purchase)</span>
          <span className={`${styles.totalValue} ${totals.net >= 0 ? styles.positive : styles.negative}`}>
            {formatEUR(totals.net)}
          </span>
        </div>
        <div className={styles.total}>
          <span className={styles.totalLabel}>Scooters Tracked</span>
          <span className={styles.totalValue}>{rows.length}</span>
        </div>
      </div>

      <div className={styles.body}>
        {/* Table */}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {[
                  { key: 'scooterId',      label: 'Scooter ID' },
                  { key: 'city',           label: 'City' },
                  { key: 'purchasePrice',  label: 'Purchase €' },
                  { key: 'monthsInService',label: 'Months' },
                  { key: 'revenueTotal',   label: 'Revenue (est.)' },
                  { key: 'repairTotal',    label: 'Repair Cost' },
                  { key: 'netPosition',    label: 'Net Position' },
                  { key: 'paybackPct',     label: 'Payback %' },
                ].map(({ key, label }) => (
                  <th key={key} onClick={() => handleSort(key)} className={styles.th}>
                    <span className={styles.thInner}>
                      {label}
                      <SortIcon col={key} sortKey={sortKey} dir={sortDir} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                return (
                  <tr
                    key={row.scooterId}
                    className={styles.tr}
                    onClick={() => navigate(`/scooters/${row.scooterId}?tab=finance`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className={styles.idCell}>#{row.scooterId}</td>
                    <td>{row.city || '—'}</td>
                    <td>{row.purchasePrice != null ? formatEUR(row.purchasePrice) : '—'}</td>
                    <td>{row.monthsInService != null ? `${row.monthsInService} mo` : '—'}</td>
                    <td className={styles.positive}>{formatEUR(row.revenueTotal)}</td>
                    <td className={styles.warning}>{formatEUR(row.repairTotal)}</td>
                    <td>
                      <span className={row.netPosition >= 0 ? styles.positive : styles.negative}>
                        {formatEUR(row.netPosition)}
                      </span>
                    </td>
                    <td>
                      {row.paybackPct !== null ? (
                        <span className={row.paybackPct >= 0 ? styles.positive : styles.negative}>
                          {formatPercent(row.paybackPct)}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className={styles.empty}>
                    No scooters registered. Add scooters in Maintenance → Fleet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
