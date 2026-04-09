import styles from './KpiCard.module.css';

const HEALTH_BORDER = {
  green: 'var(--color-success)',
  amber: 'var(--color-warning)',
  red:   'var(--color-danger)',
};

export default function KpiCard({ icon: Icon, label, value, sub, trend, accent = false, highlight = false, healthColor }) {
  const borderColor = healthColor ? HEALTH_BORDER[healthColor] : undefined;
  return (
    <div
      className={`${styles.card} ${accent ? styles.accent : ''} ${highlight ? styles.highlight : ''}`}
      style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
    >
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        {Icon && <div className={styles.iconWrap}><Icon size={16} /></div>}
      </div>
      <div className={styles.value}>{value}</div>
      {sub && <div className={styles.sub}>{sub}</div>}
      {trend !== undefined && trend !== null && (
        <div className={`${styles.trend} ${trend >= 0 ? styles.over : styles.under}`}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}% vs target
        </div>
      )}
    </div>
  );
}
