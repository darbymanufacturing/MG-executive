import styles from './RiskBadge.module.css';

const CONFIG = {
  high:   { label: 'High Risk',   cls: 'high'   },
  medium: { label: 'Medium Risk', cls: 'medium' },
  low:    { label: 'Low Risk',    cls: 'low'    },
};

export default function RiskBadge({ risk, compact = false }) {
  const cfg = CONFIG[risk] || CONFIG.low;
  return (
    <span className={`${styles.badge} ${styles[cfg.cls]} ${compact ? styles.compact : ''}`}>
      {compact ? risk : cfg.label}
    </span>
  );
}
