import styles from './PartsFilters.module.css';

const STATUS_OPTIONS = [
  'All',
  'In Stock',
  'Low Stock',
  'Out of Stock',
  'On Order',
  'Discontinued',
];

const MODEL_OPTIONS = ['Shared', 'ES400B 2022', 'ES400B 2023'];

export default function PartsFilters({ filters, onChange, onClear }) {
  const hasActive =
    filters.search || (filters.status && filters.status !== 'All') || filters.supplier || filters.model;

  return (
    <div className={styles.bar}>
      <div className={styles.fields}>
        <div className={styles.inputWrap}>
          <svg className={styles.icon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="9" r="6" />
            <path d="M15 15l3 3" strokeLinecap="round" />
          </svg>
          <input
            className={styles.input}
            type="text"
            placeholder="Search name or SKU…"
            value={filters.search}
            onChange={(e) => onChange('search', e.target.value)}
          />
        </div>

        <select
          className={styles.select}
          value={filters.status}
          onChange={(e) => onChange('status', e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s === 'All' ? '' : s}>
              {s}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={filters.model}
          onChange={(e) => onChange('model', e.target.value)}
        >
          <option value="">All Models</option>
          {MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <div className={styles.inputWrap}>
          <svg className={styles.icon} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="5" width="16" height="12" rx="1" />
            <path d="M14 5V4a2 2 0 00-4 0v1" strokeLinecap="round" />
          </svg>
          <input
            className={styles.input}
            type="text"
            placeholder="Filter by supplier…"
            value={filters.supplier}
            onChange={(e) => onChange('supplier', e.target.value)}
          />
        </div>
      </div>

      {hasActive && (
        <button className={styles.clearBtn} onClick={onClear} type="button">
          Clear filters
        </button>
      )}
    </div>
  );
}
