import { useState, useMemo } from 'react';
import { Activity, X, Image } from 'lucide-react';
import { useRepairSessions } from '../../../context/RepairSessionContext.jsx';
import { sanitizeCloudinaryUrl } from '../../../utils/sanitizeCloudinaryUrl.js';
import EmptyState from '../../Shared/EmptyState.jsx';
import styles from './RepairSessionFeed.module.css';

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('el-GR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

function SessionDetail({ session, onClose }) {
  return (
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailPanel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.detailHeader}>
          <div>
            <h3 className={styles.detailTitle}>Scooter {session.scooterId}</h3>
            <p className={styles.detailSub}>{session.technicianName} · {formatDate(session.completedAt)}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        <div className={styles.detailBody}>
          <div className={styles.detailStat}>
            <span className={styles.detailStatLabel}>Labour time</span>
            <span className={styles.detailStatVal}>{session.labourMinutes ?? 0} min</span>
          </div>
          <div className={styles.detailStat}>
            <span className={styles.detailStatLabel}>Parts cost</span>
            <span className={styles.detailStatVal}>€{(session.totalPartsCost ?? 0).toFixed(2)}</span>
          </div>
        </div>

        {/* Parts */}
        {session.aggregatedPartsUsed?.length > 0 && (
          <div className={styles.detailSection}>
            <p className={styles.detailSectionTitle}>Parts used</p>
            {session.aggregatedPartsUsed.map((p, i) => (
              <div key={i} className={styles.detailPartRow}>
                <span>{p.partName}</span>
                <span className={styles.detailPartQty}>×{p.quantity}</span>
                <span className={styles.detailPartCost}>€{(p.quantity * (p.unitCost ?? 0)).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Steps */}
        {session.steps?.length > 0 && (
          <div className={styles.detailSection}>
            <p className={styles.detailSectionTitle}>Steps</p>
            {session.steps.map((s, i) => (
              <div key={i} className={styles.detailStep}>
                <span className={styles.detailStepNum}>{s.stepNumber}</span>
                <div className={styles.detailStepBody}>
                  {s.notes && <p className={styles.detailStepNote}>{s.notes}</p>}
                  {s.photoUrls?.length > 0 && (
                    <div className={styles.photoThumbs}>
                      {s.photoUrls.map((url, j) => {
                        const safeUrl = sanitizeCloudinaryUrl(url);
                        return safeUrl ? (
                          <a key={j} href={safeUrl} target="_blank" rel="noopener noreferrer">
                            <img src={safeUrl} alt={`Step ${s.stepNumber} photo`} className={styles.photoThumb} />
                          </a>
                        ) : (
                          <img key={j} src={url} alt={`Step ${s.stepNumber} photo`} className={styles.photoThumb} />
                        );
                      })}
                    </div>
                  )}
                  {!s.notes && !s.photoUrls?.length && (
                    <span className={styles.detailStepEmpty}>No notes</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionRow({ session, onClick }) {
  const partsSummary = (session.aggregatedPartsUsed ?? [])
    .map((p) => `${p.partName} ×${p.quantity} (€${(p.quantity * (p.unitCost ?? 0)).toFixed(0)})`)
    .join(', ');

  const hasPhotos = session.steps?.some((s) => s.photoUrls?.length > 0);

  return (
    <div className={styles.row} onClick={onClick}>
      <div className={styles.rowLeft}>
        <Activity size={14} className={styles.rowIcon} />
        <div className={styles.rowBody}>
          <p className={styles.rowTitle}>
            <strong>{session.technicianName}</strong> completed repair on{' '}
            <strong>Scooter {session.scooterId}</strong>
            {(session.aggregatedPartsUsed?.length ?? 0) > 0 && (
              <> · {partsSummary}</>
            )}
            {session.labourMinutes != null && (
              <> · {session.labourMinutes} min</>
            )}
          </p>
          <p className={styles.rowSub}>{formatDate(session.completedAt)}</p>
        </div>
      </div>
      <div className={styles.rowRight}>
        {hasPhotos && <Image size={14} className={styles.photoIcon} title="Has photos" />}
        {session.totalPartsCost > 0 && (
          <span className={styles.rowCost}>€{session.totalPartsCost.toFixed(0)}</span>
        )}
      </div>
    </div>
  );
}

export default function RepairSessionFeed() {
  const { sessions, loading } = useRepairSessions();
  const [filterTech,    setFilterTech]    = useState('');
  const [filterScooter, setFilterScooter] = useState('');
  const [selected,      setSelected]      = useState(null);

  const technicians = useMemo(() =>
    [...new Set(sessions.map((s) => s.technicianName).filter(Boolean))].sort(),
  [sessions]);

  const filtered = useMemo(() =>
    sessions.filter((s) => {
      if (filterTech    && s.technicianName !== filterTech)   return false;
      if (filterScooter && !s.scooterId?.toLowerCase().includes(filterScooter.toLowerCase())) return false;
      return true;
    }),
  [sessions, filterTech, filterScooter]);

  return (
    <div className={styles.root}>
      {/* Filters */}
      <div className={styles.filters}>
        <select className={styles.filterSelect} value={filterTech} onChange={(e) => setFilterTech(e.target.value)}>
          <option value="">All technicians</option>
          {technicians.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          className={styles.filterInput}
          placeholder="Filter by scooter ID…"
          value={filterScooter}
          onChange={(e) => setFilterScooter(e.target.value)}
        />
        {(filterTech || filterScooter) && (
          <button className={styles.clearFilter} onClick={() => { setFilterTech(''); setFilterScooter(''); }}>
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {/* Feed */}
      {loading ? (
        <p className={styles.loading}>Loading activity…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={sessions.length === 0 ? 'No repair sessions yet' : 'No sessions match the current filters'}
          description={sessions.length === 0 ? 'Sessions appear here when technicians complete repairs.' : undefined}
        />
      ) : (
        <div className={styles.feed}>
          <p className={styles.count}>{filtered.length} session{filtered.length !== 1 ? 's' : ''}</p>
          {filtered.map((s) => (
            <SessionRow key={s.id} session={s} onClick={() => setSelected(s)} />
          ))}
        </div>
      )}

      {selected && <SessionDetail session={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
