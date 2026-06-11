import { useMemo, useState } from 'react';
import { useTelemetry } from '../../../context/TelemetryContext.jsx';
import EmptyState from '../../Shared/EmptyState.jsx';
import styles from './Scooter.module.css';

const TYPE_STYLE = {
  trip_start:        { dot: '#00C896', label: 'Trip start' },
  trip_end:          { dot: '#1a8a68', label: 'Trip end' },
  overturned:        { dot: '#E84545', label: 'Overturned' },
  raised:            { dot: '#F5A623', label: 'Raised' },
  rebalance_start:   { dot: '#888',    label: 'Rebalance ▶' },
  rebalance_end:     { dot: '#888',    label: 'Rebalance ■' },
  battery_swap:      { dot: '#C97D49', label: 'Battery swap' },
  low_battery:       { dot: '#A0521D', label: 'Low battery' },
  reserved:          { dot: '#2196F3', label: 'Reserved' },
  removed:           { dot: '#555',    label: 'Removed' },
  maintenance_start: { dot: '#F5A623', label: 'Maintenance' },
  other:             { dot: '#333',    label: 'Event' },
};

const PAGE_SIZE = 50;

export default function ScooterEventTimeline({ scooterId }) {
  const { events } = useTelemetry();
  const [page, setPage]     = useState(0);
  const [typeFilter, setTypeFilter] = useState('all');

  const scooterEvents = useMemo(() => {
    return events
      .filter((e) => String(e.scooterId) === String(scooterId))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // newest first
  }, [events, scooterId]);

  const filtered = typeFilter === 'all'
    ? scooterEvents
    : scooterEvents.filter((e) => e.eventType === typeFilter);

  const types = [...new Set(scooterEvents.map((e) => e.eventType))].sort();

  const visible = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const hasMore = visible.length < filtered.length;

  if (!scooterId) return null;

  return (
    <div className={styles.timeline}>
      <div className={styles.timelineHeader}>
        <h4 className={styles.sectionTitle}>Event Timeline ({filtered.length.toLocaleString()})</h4>
        <select
          className={styles.typeFilter}
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{TYPE_STYLE[t]?.label || t}</option>
          ))}
        </select>
      </div>

      {scooterEvents.length === 0 ? (
        <EmptyState
          title="No events loaded for this scooter."
          description="Upload a Status Log CSV on the Ingest tab."
        />
      ) : (
        <>
          <div className={styles.eventList}>
            {visible.map((ev, i) => {
              const style = TYPE_STYLE[ev.eventType] || TYPE_STYLE.other;
              return (
                <div key={ev._docId || i} className={styles.eventRow}>
                  <span className={styles.eventDot} style={{ background: style.dot }} />
                  <span className={styles.eventTime}>
                    {ev.timestamp ? ev.timestamp.slice(0, 16).replace('T', ' ') : '—'}
                  </span>
                  <span className={styles.eventType}>{style.label}</span>
                  <span className={styles.eventDetail}>
                    {ev.beforeState && ev.afterState
                      ? `${ev.beforeState} → ${ev.afterState}`
                      : ev.afterState || ''}
                  </span>
                  {ev.batteryLevel != null && (
                    <span className={styles.eventBatt}>🔋 {ev.batteryLevel}%</span>
                  )}
                </div>
              );
            })}
          </div>

          {hasMore && (
            <button className={styles.loadMore} onClick={() => setPage((p) => p + 1)}>
              Load {Math.min(PAGE_SIZE, filtered.length - visible.length)} more…
            </button>
          )}
        </>
      )}
    </div>
  );
}
