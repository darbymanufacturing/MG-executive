import Modal from './Modal.jsx';
import Button from './Button.jsx';
import styles from './ConfirmDialog.module.css';

export default function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Delete', confirmVariant = 'danger' }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title || 'Are you sure?'} width={400}>
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={confirmVariant} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
