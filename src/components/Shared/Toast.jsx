import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import styles from './Toast.module.css';

const ICONS = {
  success: CheckCircle,
  error:   AlertCircle,
  info:    Info,
  warning: AlertTriangle,
};

export default function Toast({ variant = 'info', message, onDismiss, action }) {
  const Icon = ICONS[variant] || Info;
  return (
    <div
      className={`${styles.toast} ${styles[variant]}`}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-atomic={variant === 'error' ? 'true' : undefined}
    >
      <Icon size={16} className={styles.icon} aria-hidden="true" />
      <span className={styles.message}>{message}</span>
      {action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => { action.onClick?.(); onDismiss?.(); }}
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}
