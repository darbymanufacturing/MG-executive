import { useState } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import ConfigEditor from '../settings/ConfigEditor.jsx';
import SeasonalityEditor from '../settings/SeasonalityEditor.jsx';
import CsvImporter from '../settings/CsvImporter.jsx';
import styles from './SettingsTab.module.css';

function SectionHeader({ title, subtitle }) {
  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {subtitle && <p className={styles.sectionSubtitle}>{subtitle}</p>}
    </div>
  );
}

export default function SettingsTab() {
  const { importTickets, importParts } = useMaintenance();

  const [ticketsSuccess, setTicketsSuccess] = useState(null);
  const [partsSuccess, setPartsSuccess] = useState(null);

  async function handleImportTickets(rows) {
    setTicketsSuccess(null);
    await importTickets(rows);
    setTicketsSuccess(rows.length);
    setTimeout(() => setTicketsSuccess(null), 4000);
  }

  async function handleImportParts(rows) {
    setPartsSuccess(null);
    await importParts(rows);
    setPartsSuccess(rows.length);
    setTimeout(() => setPartsSuccess(null), 4000);
  }

  return (
    <div className={styles.container}>
      {/* Operational Settings */}
      <section className={styles.section}>
        <SectionHeader
          title="Operational Settings"
          subtitle="Configure revenue rate and capacity limits used in cost calculations."
        />
        <ConfigEditor />
      </section>

      {/* Seasonality */}
      <section className={styles.section}>
        <SectionHeader
          title="Seasonality Index"
          subtitle="Monthly average daily revenue values used to weight seasonal revenue loss estimates."
        />
        <SeasonalityEditor />
      </section>

      {/* Import */}
      <section className={styles.section}>
        <SectionHeader
          title="Import Data"
          subtitle="Import repair logs or parts inventory from CSV files. Existing records will not be overwritten."
        />
        <div className={styles.importGrid}>
          <div className={styles.importCard}>
            <h3 className={styles.importCardTitle}>Repair Log (Tickets)</h3>
            <p className={styles.importCardDesc}>
              Expected columns: scooter_id, city, date_entered, issue_description, category,
              status, primary_tag, secondary_tag, date_completed, notes
            </p>
            <CsvImporter type="tickets" onImport={handleImportTickets} />
            {ticketsSuccess != null && (
              <div className={styles.successMsg}>
                {ticketsSuccess} ticket{ticketsSuccess !== 1 ? 's' : ''} imported successfully.
              </div>
            )}
          </div>

          <div className={styles.importCard}>
            <h3 className={styles.importCardTitle}>Parts Inventory</h3>
            <p className={styles.importCardDesc}>
              Expected columns: sku, part_name, unit_cost, lead_time, stock_on_hand,
              reorder_point, units_on_order, order_date, eta, supplier, status, notes
            </p>
            <CsvImporter type="parts" onImport={handleImportParts} />
            {partsSuccess != null && (
              <div className={styles.successMsg}>
                {partsSuccess} part{partsSuccess !== 1 ? 's' : ''} imported successfully.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
