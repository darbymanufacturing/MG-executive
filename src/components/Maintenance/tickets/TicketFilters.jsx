import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import styles from './TicketFilters.module.css';

const PRIMARY_TAGS = [
  'Loose Neck', 'Brake Lines', 'IoT', 'Motor/Tire', 'Throttle', 'Inspection',
  'Tooling Required', 'Unknown Process', 'Front Fork', 'Bearing Cap',
  'Twisted Neck', 'Handlebar Centering', 'Headlight', 'Kickstand', 'Bolts',
];

// Active-only statuses (Completed/Donor live in Archived)
const STATUSES = ['Active', 'Backlog', 'Investigation', 'Blocked'];

const CATEGORIES = [
  { code: 'Q', label: 'Q — Quick (<2hr)' },
  { code: 'M', label: 'M — Medium/Estimated' },
  { code: 'C', label: 'C — Complex' },
  { code: 'B', label: 'B — Blocked' },
  { code: 'F', label: 'F — Finished' },
];

function ChipRow({ label, options, selected, onToggle, colorFn }) {
  return (
    <div className={styles.filterRow}>
      <span className={styles.filterLabel}>{label}:</span>
      <div className={styles.chips}>
        {options.map((opt) => {
          const value = typeof opt === 'string' ? opt : opt.code;
          const display = typeof opt === 'string' ? opt : opt.code;
          const isActive = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              title={typeof opt === 'object' ? opt.label : undefined}
              className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
              style={isActive && colorFn ? { background: `${colorFn(value)}22`, borderColor: `${colorFn(value)}66`, color: colorFn(value) } : {}}
              onClick={() => onToggle(value)}
            >
              {display}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_COLOR = {
  Active: '#0ea5e9', Backlog: '#888', Investigation: '#FF9800', Blocked: '#F44336',
};

export default function TicketFilters({ filters, onSearch, onToggle, onClear }) {
  const { config } = useMaintenance();
  const allTags = [...new Set([...PRIMARY_TAGS, ...(config.customPrimaryTags || [])])];
  const hasActive =
    filters.search ||
    filters.statuses?.length > 0 ||
    filters.categories?.length > 0 ||
    filters.tags?.length > 0;

  return (
    <div className={styles.bar}>
      <div className={styles.topRow}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search scooter ID or issue…"
          value={filters.search ?? ''}
          onChange={(e) => onSearch(e.target.value)}
        />
        {hasActive && (
          <button className={styles.clearBtn} type="button" onClick={onClear}>
            Clear filters
          </button>
        )}
      </div>

      <ChipRow
        label="Status"
        options={STATUSES}
        selected={filters.statuses || []}
        onToggle={(v) => onToggle('statuses', v)}
        colorFn={(v) => STATUS_COLOR[v]}
      />

      <ChipRow
        label="Category"
        options={CATEGORIES}
        selected={filters.categories || []}
        onToggle={(v) => onToggle('categories', v)}
      />

      <div className={styles.filterRow}>
        <span className={styles.filterLabel}>Tags:</span>
        <div className={styles.chips}>
          {allTags.map((tag) => {
            const isActive = (filters.tags || []).includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
                onClick={() => onToggle('tags', tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
