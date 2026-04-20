/**
 * FinanceTab — wraps ScooterLedgerDetail for the unified scooter page.
 * Computes the ledger row on demand from context data.
 */

import { useMemo } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import { useRevenue } from '../../../context/RevenueContext.jsx';
import { useCosts } from '../../../context/CostContext.jsx';
import { scooterLedgerRow } from '../../../utils/investmentCalculations.js';
import ScooterLedgerDetail from '../../Investment/ScooterLedgerDetail.jsx';
import styles from './Tab.module.css';

export default function FinanceTab({ scooter }) {
  const { tickets, parts, config: maintConfig } = useMaintenance();
  const { revenueData } = useRevenue();
  const { config: costConfig } = useCosts();

  const financial      = costConfig?.financial ?? null;
  const labourRate     = maintConfig?.labourRatePerHour ?? 0;
  const defaultFleet   = costConfig?.fleetSize || 1;

  const row = useMemo(() =>
    scooterLedgerRow(scooter, revenueData, tickets, parts, financial, labourRate, defaultFleet),
  [scooter, revenueData, tickets, parts, financial, labourRate, defaultFleet]);

  return (
    <div className={styles.tab}>
      {/* ScooterLedgerDetail renders its own panels — remove the close button by passing noop */}
      <ScooterLedgerDetail row={row} onClose={() => {}} hideClose />
    </div>
  );
}
