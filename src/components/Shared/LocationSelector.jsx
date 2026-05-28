/**
 * Reusable location <select> used on Dashboard, CostManager, Revenue, and CsvImportPanel.
 * Returns null when no locations have been configured yet.
 */
export default function LocationSelector({ locations, value, onChange, style }) {
  if (!locations?.length) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by location"
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-body)',
        fontSize: 'var(--text-sm)',
        padding: '7px 10px',
        outline: 'none',
        cursor: 'pointer',
        transition: 'border-color var(--transition-fast)',
        ...style,
      }}
    >
      <option value="all">All Locations</option>
      {locations.map((loc) => (
        <option key={loc} value={loc}>{loc}</option>
      ))}
    </select>
  );
}
