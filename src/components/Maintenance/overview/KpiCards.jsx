import { useMemo } from 'react';
import {
  Activity, Wrench, Zap, Clock,
  AlertTriangle, Package, DollarSign, CheckCircle2,
} from 'lucide-react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import MetricCard from './MetricCard.jsx';
import styles from './KpiCards.module.css';

const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

export default function KpiCards({ filteredTickets }) {
  const { parts, scooters, config, activeCount, isAtMaxActive, lowStockParts } = useMaintenance();

  const cards = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear  = now.getFullYear();

    // 1. Active tickets
    const activeVariant = isAtMaxActive ? 'warning' : activeCount === 0 ? 'success' : 'default';

    // 2. Total open (non-completed)
    const totalOpen = filteredTickets.filter((t) => t.status !== 'Completed').length;

    // 3. Revenue bleedthrough per day
    // Idle = scooters with status "In Repair" (pulling revenue out of service)
    const monthKey   = MONTH_KEYS[currentMonth];
    const dailyRate  = config.seasonalityIndex?.[monthKey] ?? config.revenueRatePerDay ?? 3.67;
    const idleScooters = scooters.filter((s) => s.status === 'In Repair');
    const bleedthroughPerDay = idleScooters.length * dailyRate;

    // City breakdown for sublabel
    const byCity = idleScooters.reduce((acc, s) => {
      const city = s.city || 'Unknown';
      acc[city] = (acc[city] || 0) + 1;
      return acc;
    }, {});
    const cityStr = Object.entries(byCity)
      .map(([city, count]) => `${city}: ${count}`)
      .join(' · ');
    const bleedSublabel = idleScooters.length === 0
      ? 'no scooters in repair'
      : cityStr || `${idleScooters.length} in repair`;
    const bleedVariant = bleedthroughPerDay > 30 ? 'danger' : bleedthroughPerDay > 10 ? 'warning' : 'default';

    // 4. Avg days open — #173 filter to finite values only to prevent NaN from bad ticket data
    const openTickets = filteredTickets.filter((t) => t.status !== 'Completed');
    const validOpenTickets = openTickets.filter((t) => Number.isFinite(t.daysOpen));
    const avgDaysOpen = validOpenTickets.length > 0
      ? (validOpenTickets.reduce((s, t) => s + t.daysOpen, 0) / validOpenTickets.length).toFixed(1)
      : openTickets.length > 0 ? '—' : '0';

    // 5. Parts low stock (global — not city-filtered)
    const lowStockCount = lowStockParts.length;

    // 6. Parts on order (global)
    const onOrderCount = parts.filter((p) => (p.unitsOnOrder ?? 0) > 0).length;

    // 7. Inventory value (global)
    const inventoryValue = parts.reduce((s, p) => s + (p.unitCost ?? 0) * (p.stockOnHand ?? 0), 0);

    // 8. Completed this month (filtered)
    const completedThisMonth = filteredTickets.filter((t) => {
      if (t.status !== 'Completed' || !t.dateCompleted) return false;
      const d = new Date(t.dateCompleted + 'T12:00:00');
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
        label:    'Revenue Bleedthrough / day',
        value:    `€${bleedthroughPerDay.toFixed(2)}`,
        icon:     Zap,
        sublabel: bleedSublabel,
        variant:  bleedVariant,
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
  }, [filteredTickets, parts, scooters, config, activeCount, isAtMaxActive, lowStockParts]);

  return (
    <div className={styles.grid}>
      {cards.map((card) => (
        <MetricCard key={card.label} {...card} />
      ))}
    </div>
  );
}
