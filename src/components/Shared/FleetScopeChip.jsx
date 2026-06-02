import { useFleet } from '../../context/FleetContext.jsx';

/**
 * FF-3 — a small chip that shows which fleet an operational screen is scoped to
 * ("Fleet: Corinth" / "All Fleets"). Renders nothing until the org has fleets, so
 * single-fleet (or fleet-less) orgs see no extra chrome.
 */
export default function FleetScopeChip({ style }) {
  const { isAllFleets, activeFleet, hasFleets } = useFleet();
  if (!hasFleets) return null;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 11px',
        borderRadius: 'var(--radius-pill)',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        background: isAllFleets ? 'var(--bg-section)' : 'var(--accent-tint)',
        color: isAllFleets ? 'var(--fg-secondary)' : 'var(--accent)',
        ...style,
      }}
    >
      {isAllFleets ? 'All Fleets' : `Fleet: ${activeFleet?.name}`}
    </span>
  );
}
