import { useState } from 'react';
import { useMaintenance } from '../../../context/MaintenanceContext.jsx';
import Button from '../../Shared/Button.jsx';
import ConfigEditor from '../settings/ConfigEditor.jsx';
import SeasonalityEditor from '../settings/SeasonalityEditor.jsx';
import CsvImporter from '../settings/CsvImporter.jsx';
import RepairProcedureEditor from '../settings/RepairProcedureEditor.jsx';
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
  const { importTickets, importParts, patchPartModels, loadSeedData } = useMaintenance();

  const [ticketsSuccess, setTicketsSuccess] = useState(null);
  const [ticketsError, setTicketsError] = useState(null);
  const [partsSuccess, setPartsSuccess] = useState(null);
  const [partsError, setPartsError] = useState(null);
  const [patchState, setPatchState] = useState('idle');   // idle | loading | done | error
  const [seedState,  setSeedState]  = useState('idle');   // idle | loading | done | error
  const [patchError, setPatchError] = useState(null);
  const [seedError,  setSeedError]  = useState(null);

  async function handleImportTickets(rows) {
    setTicketsSuccess(null);
    setTicketsError(null);
    try {
      await importTickets(rows);
      setTicketsSuccess(rows.length);
      setTimeout(() => setTicketsSuccess(null), 4000);
    } catch (err) {
      setTicketsError(err?.message || 'Import failed.');
      setTimeout(() => setTicketsError(null), 6000);
    }
  }

  async function handleReseedParts() {
    setSeedState('loading');
    setSeedError(null);
    try {
      await loadSeedData();
      setSeedState('done');
      setTimeout(() => setSeedState('idle'), 4000);
    } catch (err) {
      setSeedError(err?.message || 'Reseed failed.');
      setTimeout(() => { setSeedState('idle'); setSeedError(null); }, 6000);
    }
  }

  async function handlePatchModels() {
    setPatchState('loading');
    setPatchError(null);
    try {
      await patchPartModels();
      setPatchState('done');
      setTimeout(() => setPatchState('idle'), 4000);
    } catch (err) {
      setPatchError(err?.message || 'Sync failed.');
      setTimeout(() => { setPatchState('idle'); setPatchError(null); }, 6000);
    }
  }

  async function handleImportParts(rows) {
    setPartsSuccess(null);
    setPartsError(null);
    try {
      await importParts(rows);
      setPartsSuccess(rows.length);
      setTimeout(() => setPartsSuccess(null), 4000);
    } catch (err) {
      setPartsError(err?.message || 'Import failed.');
      setTimeout(() => setPartsError(null), 6000);
    }
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

      {/* Sync Part Models */}
      <section className={styles.section}>
        <SectionHeader
          title="Sync Part Models"
          subtitle="Re-assigns each part's Model field (Shared / ES400B 2022 / ES400B 2023) from the master Excel mapping. Run this once to fix any incorrect model labels."
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            size="sm"
            onClick={handlePatchModels}
            disabled={patchState === 'loading'}
          >
            {patchState === 'loading' ? 'Syncing…' : patchState === 'done' ? 'Synced ✓' : 'Sync Part Models'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReseedParts}
            disabled={seedState === 'loading'}
          >
            {seedState === 'loading' ? 'Reseeding…' : seedState === 'done' ? 'Done ✓' : 'Reseed All Parts'}
          </Button>
          {(patchState === 'done' || seedState === 'done') && (
            <span style={{ fontSize: '0.875rem', color: 'var(--color-success)' }}>
              Parts updated successfully.
            </span>
          )}
          {(patchError || seedError) && (
            <span style={{ fontSize: '0.875rem', color: 'var(--color-danger, #DC2626)' }}>
              {patchError || seedError}
            </span>
          )}
        </div>
      </section>

      {/* Repair Procedure Library */}
      <section className={styles.section}>
        <SectionHeader
          title="Repair Procedure Library (SOPs)"
          subtitle="Create step-by-step procedures for each repair type. Technicians follow these guides during repairs."
        />
        <RepairProcedureEditor />
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
            {ticketsError && (
              <div style={{ fontSize: '0.875rem', color: 'var(--color-danger, #DC2626)', marginTop: 6 }}>
                {ticketsError}
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
            {partsError && (
              <div style={{ fontSize: '0.875rem', color: 'var(--color-danger, #DC2626)', marginTop: 6 }}>
                {partsError}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
