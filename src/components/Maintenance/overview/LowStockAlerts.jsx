import { CheckCircle } from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import styles from './LowStockAlerts.module.css';

export default function LowStockAlerts() {
  const { lowStockParts } = useMaintenance();

  const sorted = [...lowStockParts].sort((a, b) => {
    const ratioA = a.reorderPoint > 0 ? a.stockOnHand / a.reorderPoint : 1;
    const ratioB = b.reorderPoint > 0 ? b.stockOnHand / b.reorderPoint : 1;
    return ratioA - ratioB;
  });

  if (sorted.length === 0) {
    return (
      <div className={styles.empty}>
        <CheckCircle size={24} className={styles.emptyIcon} />
        <span className={styles.emptyText}>All parts adequately stocked</span>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {sorted.map((part) => {
        const ratio = part.reorderPoint > 0 ? part.stockOnHand / part.reorderPoint : 1;
        const isCritical = part.stockOnHand === 0;
        return (
          <div
            key={part._docId}
            className={`${styles.row} ${isCritical ? styles.critical : ''}`}
          >
            <div className={styles.partInfo}>
              <span className={styles.partName}>{part.name ?? part._docId}</span>
              <span className={styles.sku}>{part.sku ?? part._docId}</span>
            </div>
            <div className={styles.stockInfo}>
              <span
                className={styles.stockCount}
                style={{ color: isCritical ? '#F44336' : ratio < 0.5 ? '#FF9800' : '#FF9800' }}
              >
                {part.stockOnHand ?? 0}
              </span>
              <span className={styles.divider}>/</span>
              <span className={styles.reorderCount}>{part.reorderPoint ?? 0}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
