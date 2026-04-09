import { useMemo } from 'react';
import {
  Activity, Wrench, TrendingDown, Clock,
  AlertTriangle, Package, DollarSign, CheckCircle2,
} from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import MetricCard from './MetricCard.jsx';
import styles from './KpiCards.module.css';

export default function KpiCards({ filteredTickets }) {
  const { parts, config, activeCount, isAtMaxActive, totalRevenueLost, lowStockParts } = useMaintenance();

  const cards = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear  = now.getFullYear();

    // 1. Active tickets
    const activeVariant = isAtMaxActive ? 'warning' : activeCount === 0 ? 'success' : 'default';

    // 2. Total open (non-completed)
    const totalOpen = filteredTickets.filter((t) => t.status !== 'Completed').length;

    // 3. Revenue at risk (from filteredTickets open)
    const filteredRevenueLost = filteredTickets
      .filter((t) => t.status !== 'Completed')
      .reduce((s, t) => s + (t.revenueLost ?? 0), 0);
    const revenueVariant = filteredRevenueLost > 500 ? 'danger' : filteredRevenueLost > 100 ? 'warning' : 'default';

    // 4. Avg days open
    const openTickets = filteredTickets.filter((t) => t.status !== 'Completed');
    const avgDaysOpen = openTickets.length > 0
      ? (openTickets.reduce((s, t) => s + (t.daysOpen ?? 0), 0) / openTickets.length).toFixed(1)
      : '0';

    // 5. Parts low stock (global — not city-filtered)
    const lowStockCount = lowStockParts.length;

    // 6. Parts on order (global)
    const onOrderCount = parts.filter((p) => (p.unitsOnOrder ?? 0) > 0).length;

    // 7. Inventory value (global)
    const inventoryValue = parts.reduce((s, p) => s + (p.unitCost ?? 0) * (p.stockOnHand ?? 0), 0);

    // 8. Completed this month (filtered)
    const completedThisMonth = filteredTickets.filter((t) => {
      if (t.status !== 'Completed' || !t.dateCompleted) return false;
      const d = new Date(t.dateCompleted);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length;

    return [
      {
        label:    'Active Tickets',
        value:    `${activeCount} / ${config.maxActiveTickets ?? 3}`,
        icon:     Activity,
        sublabel: isAtMaxActive ? 'Limit reached' : undefined,
        variant:  activeVariant,
      },
      {
        label:   'Total Open',
        value:   totalOpen,
        icon:    Wrench,
        variant: 'default',
      },
      {
        label:    'Revenue at Risk',
        value:    `€${filteredRevenueLost.toFixed(0)}`,
        icon:     TrendingDown,
        sublabel: 'non-completed tickets',
        variant:  revenueVariant,
      },
      {
        label:    'Avg Days Open',
        value:    avgDaysOpen,
        icon:     Clock,
        sublabel: 'non-completed tickets',
        variant:  'default',
      },
      {
        label:    'Parts Low Stock',
        value:    lowStockCount,
        icon:     AlertTriangle,
        sublabel: lowStockCount > 0 ? 'need reorder' : 'all stocked',
        variant:  lowStockCount > 0 ? 'warning' : 'success',
      },
      {
        label:    'Parts On Order',
        value:    onOrderCount,
        icon:     Package,
        sublabel: 'SKUs with pending order',
        variant:  'default',
      },
      {
        label:    'Inventory Value',
        value:    `€${inventoryValue.toFixed(0)}`,
        icon:     DollarSign,
        sublabel: 'stock × unit cost',
        variant:  'default',
      },
      {
        label:    'Completed This Month',
        value:    completedThisMonth,
        icon:     CheckCircle2,
        variant:  'success',
      },
    ];
  }, [filteredTickets, parts, config, activeCount, isAtMaxActive, totalRevenueLost, lowStockParts]);

  return (
    <div className={styles.grid}>
      {cards.map((card) => (
        <MetricCard key={card.label} {...card} />
      ))}
    </div>
  );
}
