import { useState, useMemo } from 'react';
import { Download } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { useSpr } from '../../context/SprContext.jsx';
import { computeSpotPerformance } from '../../utils/sprCalculations.js';
import styles from './SpotPerformanceTable.module.css';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function monthAgoStr() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

export default function SpotPerformanceTable({ city }) {
  const { events, weather, sprConfig } = useSpr();

  const [startDate,    setStartDate]    = useState(monthAgoStr);
  const [endDate,      setEndDate]      = useState(todayStr);
  const [excludeRainy, setExcludeRainy] = useState(true);

  const zones = useMemo(
    () => (sprConfig.zones || []).filter((z) => !city || z.city === city),
    [sprConfig.zones, city]
  );

  const rows = useMemo(() => {
    if (!city || !startDate || !endDate || zones.length === 0) return [];
    return computeSpotPerformance({
      events,
      zones,
      weather,
      startDate,
      endDate,
      city,
      excludeRainy,
      morningHour: sprConfig.morningHour ?? 10,
    });
  }, [events, zones, weather, city, startDate, endDate, excludeRainy, sprConfig.morningHour]);

  // Aggregated summary
  const totals = useMemo(() => {
    if (!rows.length) return null;
    const totalRides   = rows.reduce((s, r) => s + r.rideVolume,   0);
    const totalReturns = rows.reduce((s, r) => s + r.returnVolume, 0);
    const totalFlow    = rows.reduce((s, r) => s + r.zoneFlow,     0);
    const days         = new Set(rows.map((r) => r.date)).size;
    return { totalRides, totalReturns, totalFlow, days };
  }, [rows]);

  function exportCSV() {
    const escapeCSV = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const header = ['Date', 'Zone', 'Morning Stock', 'Rides', 'Returns', 'Flow', 'Pickup Rate'].map(escapeCSV).join(',') + '\n';
    const body = rows.map((r) =>
      [
        r.date, r.zone, r.morningStock, r.rideVolume, r.returnVolume, r.zoneFlow,
        Number.isFinite(r.pickupRate) ? (r.pickupRate * 100).toFixed(1) + '%' : '',
      ].map(escapeCSV).join(',')
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeCity = city.replace(/[\\/:*?"<>|,\s]/g, '_');
    a.download = `spr_performance_${safeCity}_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.container}>
      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.formField}>
          <label className={styles.fieldLabel}>From</label>
          <input type="date" className={styles.input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className={styles.formField}>
          <label className={styles.fieldLabel}>To</label>
          <input type="date" className={styles.input} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className={styles.toggleRow}>
          <input
            type="checkbox"
            id="rainy-toggle"
            className={styles.toggle}
            checked={excludeRainy}
            onChange={(e) => setExcludeRainy(e.target.checked)}
          />
          <label htmlFor="rainy-toggle" className={styles.toggleLabel}>Exclude rainy days</label>
        </div>
      </div>

      {/* Summary */}
      {totals && (
        <div className={styles.summaryBar}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Days</span>
            <span className={styles.summaryValue}>{totals.days}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Total Rides</span>
            <span className={styles.summaryValue}>{totals.totalRides}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Returns</span>
            <span className={styles.summaryValue}>{totals.totalReturns}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Net Flow</span>
            <span className={`${styles.summaryValue} ${totals.totalFlow > 0 ? styles.positive : totals.totalFlow < 0 ? styles.negative : styles.neutral}`}>
              {totals.totalFlow > 0 ? '+' : ''}{totals.totalFlow}
            </span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Zones</span>
            <span className={styles.summaryValue}>{zones.length}</span>
          </div>
        </div>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <div className={styles.empty}>
          {!city
            ? 'Select a city to view performance data.'
            : zones.length === 0
            ? `No zones defined for ${city}. Add zones in the Zones tab first.`
            : events.filter((e) => e.city === city).length === 0
            ? `No events imported for ${city} yet. Import a CSV in the Events tab.`
            : 'No data for this date range.'}
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Date</th>
                <th className={styles.th}>Zone</th>
                <th className={`${styles.th} ${styles.thRight}`}>Morning Stock</th>
                <th className={`${styles.th} ${styles.thRight}`}>Rides</th>
                <th className={`${styles.th} ${styles.thRight}`}>Returns</th>
                <th className={`${styles.th} ${styles.thRight}`}>Flow</th>
                <th className={`${styles.th} ${styles.thRight}`}>Pickup Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rate = r.pickupRate;
                return (
                  <tr key={i}>
                    <td className={styles.td}>{r.date}</td>
                    <td className={styles.td}>{r.zone}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>{r.morningStock}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>{r.rideVolume}</td>
                    <td className={`${styles.td} ${styles.tdRight}`}>{r.returnVolume}</td>
                    <td className={`${styles.td} ${styles.tdRight} ${r.zoneFlow > 0 ? styles.positive : r.zoneFlow < 0 ? styles.negative : styles.neutral}`}>
                      {r.zoneFlow > 0 ? '+' : ''}{r.zoneFlow}
                    </td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      {Number.isFinite(rate) ? (
                        <div className={styles.rateWrap}>
                          <span>{(rate * 100).toFixed(0)}%</span>
                          <div className={styles.rateBar}>
                            <div className={styles.rateFill} style={{ width: `${Math.min(100, rate * 100)}%` }} />
                          </div>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.count}>
          {rows.length > 0 ? `${rows.length} row${rows.length !== 1 ? 's' : ''}` : ''}
        </span>
        {rows.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download size={13} /> Export CSV
          </Button>
        )}
      </div>
    </div>
  );
}
