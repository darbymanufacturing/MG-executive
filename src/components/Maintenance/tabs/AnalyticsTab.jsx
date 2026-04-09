import TicketsByStatusChart from '../analytics/TicketsByStatusChart.jsx';
import TicketsByTagChart from '../analytics/TicketsByTagChart.jsx';
import RevenueLostChart from '../analytics/RevenueLostChart.jsx';
import InventoryValueChart from '../analytics/InventoryValueChart.jsx';
import styles from './AnalyticsTab.module.css';

function ChartCard({ title, subtitle, children }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
        {subtitle && <p className={styles.cardSubtitle}>{subtitle}</p>}
      </div>
      <div className={styles.cardBody}>{children}</div>
    </div>
  );
}

export default function AnalyticsTab({ filteredTickets }) {
  const tickets = filteredTickets || [];

  return (
    <div className={styles.grid}>
      <ChartCard
        title="Tickets by Status"
        subtitle="Distribution of all tickets across statuses"
      >
        <TicketsByStatusChart tickets={tickets} />
      </ChartCard>

      <ChartCard
        title="Tickets by Primary Tag"
        subtitle="Top 10 issue categories by ticket count"
      >
        <TicketsByTagChart tickets={tickets} />
      </ChartCard>

      <ChartCard
        title="Revenue Lost Over Time"
        subtitle="Monthly revenue impact from open tickets"
      >
        <RevenueLostChart tickets={tickets} />
      </ChartCard>

      <ChartCard
        title="Inventory Value by Part"
        subtitle="Top 15 parts by total stock value (cost × quantity)"
      >
        <InventoryValueChart />
      </ChartCard>
    </div>
  );
}
