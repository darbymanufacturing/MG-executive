import styles from './MetricCard.module.css';

const VARIANT_COLORS = {
  default: '#0ea5e9',
  warning: '#FF9800',
  success: '#4CAF50',
  danger:  '#F44336',
};

export default function MetricCard({ label, value, icon: Icon, sublabel, variant = 'default' }) {
  const accentColor = VARIANT_COLORS[variant] ?? VARIANT_COLORS.default;

  return (
    <div className={styles.card} style={{ '--accent': accentColor }}>
      {Icon && (
        <div className={styles.iconWrap}>
          <Icon size={18} style={{ color: accentColor }} />
        </div>
      )}
      <div className={styles.valueRow}>
        <span className={styles.value}>{value}</span>
      </div>
      <span className={styles.label}>{label}</span>
      {sublabel && <span className={styles.sublabel}>{sublabel}</span>}
    </div>
  );
}
