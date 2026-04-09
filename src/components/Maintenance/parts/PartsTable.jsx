import { useState } from 'react';
import Button from '../../Shared/Button.jsx';
import ConfirmDialog from '../../Shared/ConfirmDialog.jsx';
import styles from './PartsTable.module.css';

const STATUS_COLORS = {
  'In Stock': styles.statusGreen,
  'Low Stock': styles.statusOrange,
  'Out of Stock': styles.statusRed,
  'On Order': styles.statusBlue,
  'Discontinued': styles.statusGrey,
};

function fmt(n, decimals = 2) {
  if (n == null || n === '') return '—';
  return Number(n).toFixed(decimals);
}

export default function PartsTable({ parts, onEdit, onDelete }) {
  const [deleteTarget, setDeleteTarget] = useState(null);

  if (!parts || parts.length === 0) {
    return (
      <div className={styles.empty}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={styles.emptyIcon}>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 00-4 0v2M8 7V5a2 2 0 014 0" />
        </svg>
        <p>No parts found. Add your first part or adjust the filters.</p>
      </div>
    );
  }

  return (
    <>
      <div className={styles.wrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Part Name</th>
              <th className={styles.right}>Unit Cost</th>
              <th className={styles.right}>Lead Time</th>
              <th className={styles.right}>Stock</th>
              <th className={styles.right}>Reorder</th>
              <th>Status</th>
              <th>Supplier</th>
              <th className={styles.actionsCol}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((part) => {
              const isLow =
                typeof part.stockOnHand === 'number' &&
                typeof part.reorderPoint === 'number' &&
                part.stockOnHand <= part.reorderPoint &&
                part.status !== 'Discontinued';

              return (
                <tr key={part._docId || part.sku} className={isLow ? styles.rowWarn : ''}>
                  <td className={styles.sku}>{part.sku}</td>
                  <td className={styles.name}>{part.partName}</td>
                  <td className={styles.right}>€{fmt(part.unitCost)}</td>
                  <td className={styles.right}>
                    {part.leadTime != null ? `${part.leadTime}d` : '—'}
                  </td>
                  <td className={`${styles.right} ${isLow ? styles.stockWarn : ''}`}>
                    {part.stockOnHand ?? '—'}
                  </td>
                  <td className={styles.right}>{part.reorderPoint ?? '—'}</td>
                  <td>
                    <span className={`${styles.badge} ${STATUS_COLORS[part.status] || styles.statusGrey}`}>
                      {part.status || '—'}
                    </span>
                  </td>
                  <td className={styles.supplier}>{part.supplier || '—'}</td>
                  <td className={styles.actions}>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(part)}>
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setDeleteTarget(part)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget._docId);
          setDeleteTarget(null);
        }}
        title="Delete Part"
        message={`Are you sure you want to delete "${deleteTarget?.partName}" (${deleteTarget?.sku})? This cannot be undone.`}
      />
    </>
  );
}
