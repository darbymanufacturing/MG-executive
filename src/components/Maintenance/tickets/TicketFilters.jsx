import Button from '../../Shared/Button.jsx';
import styles from './TicketFilters.module.css';

const PRIMARY_TAGS = [
  'Loose Neck', 'Brake Lines', 'IoT', 'Motor/Tire', 'Throttle', 'Inspection',
  'Tooling Required', 'Unknown Process', 'Front Fork', 'Bearing Cap',
  'Twisted Neck', 'Handlebar Centering', 'Headlight', 'Kickstand', 'Bolts',
];

const STATUSES = ['Active', 'Backlog', 'Investigation', 'Blocked', 'Donor', 'Completed'];

const CATEGORIES = { Q: 'Quoted', M: 'Medium/Estimated', C: 'Complex', B: 'Basic', F: 'Finished' };

export default function TicketFilters({ filters, onChange, onClear }) {
  return (
    <div className={styles.bar}>
      <input
        type="text"
        className={styles.searchInput}
        placeholder="Search scooter ID or issue…"
        value={filters.search ?? ''}
        onChange={(e) => onChange('search', e.target.value)}
      />

      <select
        className={styles.select}
        value={filters.status ?? ''}
        onChange={(e) => onChange('status', e.target.value)}
      >
        <option value="">All Statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        className={styles.select}
        value={filters.category ?? ''}
        onChange={(e) => onChange('category', e.target.value)}
      >
        <option value="">All Categories</option>
        {Object.entries(CATEGORIES).map(([code, label]) => (
          <option key={code} value={code}>{code} — {label}</option>
        ))}
      </select>

      <select
        className={styles.select}
        value={filters.tag ?? ''}
        onChange={(e) => onChange('tag', e.target.value)}
      >
        <option value="">All Tags</option>
        {PRIMARY_TAGS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
