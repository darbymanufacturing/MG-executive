import { useState, useMemo } from 'react';
import { useRevenue } from '../../context/RevenueContext.jsx';
import { formatEUR, formatDate, formatTrips, formatKm } from '../../utils/formatters.js';
import { totalRevenue, totalTrips, totalDistanceKm } from '../../utils/revenueCalculations.js';
import EmptyState from '../Shared/EmptyState.jsx';
import { BarChart2 } from 'lucide-react';
import styles from './RevenueTable.module.css';

export default function RevenueTable({ data }) {
  const { revenueData } = useRevenue();
  const source = data ?? revenueData; // use pre-filtered data if provided
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [sortBy,    setSortBy]    = useState('date');
  const [sortDir,   setSortDir]   = useState('desc');

  const filtered = useMemo(() => {
    let list = source;
    if (startDate) list = list.filter((r) => r.date >= startDate);
    if (endDate)   list = list.filter((r) => r.date <= endDate);
    return [...list].sort((a, b) => {
      let va, vb;
      if (sortBy === 'revenue')  { va = a.totalPaidRevenue; vb = b.totalPaidRevenue; }
      else if (sortBy === 'trips') { va = a.totalTrips; vb = b.totalTrips; }
      else { va = a.date; vb = b.date; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [source, startDate, endDate, sortBy, sortDir]);

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortDir(field === 'date' ? 'desc' : 'desc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <span className={styles.sortNeutral}>↕</span>;
    return <span className={styles.sortActive}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  if (!source.length) {
    return (
      <EmptyState
        icon={BarChart2}
        title="No revenue data yet"
        description="Import a CSV file above to start tracking revenue."
      />
    );
  }

  return (
    <div className={styles.wrapper}>
      {/* Date range filter */}
      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>Filter by date:</span>
        <input type="date" className={styles.dateInput} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <span className={styles.toolbarLabel}>to</span>
        <input type="date" className={styles.dateInput} value={endDate}   onChange={(e) => setEndDate(e.target.value)} />
        {(startDate || endDate) && (
          <button className={styles.clearFilter} onClick={() => { setStartDate(''); setEndDate(''); }}>
            Clear
          </button>
        )}
        <span className={styles.count}>{filtered.length} day{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th} onClick={() => toggleSort('date')}>Date <SortIcon field="date" /></th>
              <th className={styles.th} onClick={() => toggleSort('trips')}>Trips <SortIcon field="trips" /></th>
              <th className={styles.th}>Users</th>
              <th className={styles.th}>Vehicles</th>
              <th className={`${styles.th} ${styles.right}`}>Distance</th>
              <th className={`${styles.th} ${styles.right}`}>Avg Payment</th>
              <th className={`${styles.th} ${styles.right}`} onClick={() => toggleSort('revenue')}>
                Paid Revenue <SortIcon field="revenue" />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r._docId || r.date} className={styles.row}>
                <td className={styles.td}><span className={styles.dateCell}>{formatDate(r.date)}</span></td>
                <td className={styles.td}>{formatTrips(r.totalTrips)}</td>
                <td className={styles.td}>{r.uniqueUsersCount}</td>
                <td className={styles.td}>{r.uniqueVehiclesCount}</td>
                <td className={`${styles.td} ${styles.right}`}>{formatKm(r.totalTripDistanceKm)}</td>
                <td className={`${styles.td} ${styles.right}`}>{formatEUR(r.averagePayment)}</td>
                <td className={`${styles.td} ${styles.right} ${styles.revenue}`}>{formatEUR(r.totalPaidRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals footer */}
      <div className={styles.footer}>
        <span>Total trips: <strong>{formatTrips(totalTrips(filtered))}</strong></span>
        <span>Total distance: <strong>{formatKm(totalDistanceKm(filtered))}</strong></span>
        <span>Total revenue: <strong className={styles.totalRev}>{formatEUR(totalRevenue(filtered))}</strong></span>
      </div>
    </div>
  );
}
