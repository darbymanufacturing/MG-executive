import { useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useMaintenance } from '../../context/MaintenanceContext.jsx';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { scooterLedgerRow } from '../../utils/investmentCalculations.js';
import { formatEUR, formatDate, formatPercent } from '../../utils/formatters.js';
import ScooterLedgerDetail from './ScooterLedgerDetail.jsx';
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
  const { scooters, tickets, parts, config: maintConfig } = useMaintenance();
  const { revenueData } = useRevenue();
  const { config: costConfig } = useCosts();
  const financial = costConfig?.financial ?? null;
  const labourRate = maintConfig?.labourRatePerHour ?? 0;
  const defaultFleetSize = costConfig?.fleetSize || scooters.length || 1;

  const [sortKey, setSortKey] = useState('netPosition');
  const [sortDir, setSortDir] = useState('asc'); // ascending = worst first (most negative)
  const [selectedId, setSelectedId] = useState(null);

  // Build all ledger rows — expensive but memoized
  const rows = useMemo(() =>
    scooters.map((s) => scooterLedgerRow(s, revenueData, tickets, parts, financial, labourRate, defaultFleetSize)),
  [scooters, revenueData, tickets, parts, financial, labourRate, defaultFleetSize]);

  // Sort
  const sorted = useMemo(() => {
    const fn = SORT_KEYS[sortKey] || ((r) => r[sortKey]);
    return [...rows].sort((a, b) => {
      const av = fn(a), bv = fn(b);
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [rows, sortKey, sortDir]);

  const selectedRow = useMemo(() => rows.find((r) => r.scooterId === selectedId), [rows, selectedId]);

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
                const isSelected = row.scooterId === selectedId;
                return (
                  <tr
                    key={row.scooterId}
                    className={`${styles.tr} ${isSelected ? styles.trSelected : ''}`}
                    onClick={() => setSelectedId(isSelected ? null : row.scooterId)}
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

        {/* Detail panel */}
        {selectedRow && (
          <ScooterLedgerDetail
            row={selectedRow}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
