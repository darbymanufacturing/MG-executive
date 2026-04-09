import { useMemo } from 'react';
import KpiCards from '../overview/KpiCards.jsx';
import ActiveTicketsList from '../overview/ActiveTicketsList.jsx';
import LowStockAlerts from '../overview/LowStockAlerts.jsx';
import styles from './OverviewTab.module.css';

export default function OverviewTab({ filteredTickets }) {
  const filteredActiveTickets = useMemo(
    () => filteredTickets.filter((t) => t.status === 'Active'),
    [filteredTickets],
  );

  return (
    <div className={styles.wrapper}>
      <KpiCards filteredTickets={filteredTickets} />

      <div className={styles.twoCol}>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Active Repairs</h3>
          <ActiveTicketsList tickets={filteredActiveTickets} />
        </div>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Low Stock Alerts</h3>
          <LowStockAlerts />
        </div>
      </div>
    </div>
  );
}
