import { AlertTriangle } from 'lucide-react';
import styles from './ActiveTicketsBanner.module.css';

export default function ActiveTicketsBanner({ activeCount, maxActiveTickets }) {
  return (
    <div className={styles.banner}>
      <AlertTriangle size={16} className={styles.icon} />
      <span className={styles.text}>
        <strong>MAX ACTIVE REPAIRS REACHED ({activeCount}/{maxActiveTickets})</strong>
        {' '}— Move a ticket to Backlog or Completed before adding another Active.
      </span>
    </div>
  );
}
