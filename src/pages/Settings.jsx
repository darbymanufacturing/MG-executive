import { useState, useRef } from 'react';
import {
  Download, Upload, Trash2, Database, Bike, Target,
  DollarSign, TrendingUp, MapPin, Plus, X, Link2,
} from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import BankConnect from '../components/Bank/BankConnect.jsx';
import BankTransactionReview from '../components/Bank/BankTransactionReview.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { exportToJSON, importFromJSON, exportDashboardToPDF } from '../utils/exportData.js';
import { projectedCostPerScooterSimple } from '../utils/calculations.js';
import { formatEUR } from '../utils/formatters.js';
import styles from './Settings.module.css';

export default function Settings() {
  const { costs, config, updateConfig, loadSampleData, clearAllData, importData } = useCosts();
  const [clearConfirm, setClearConfirm] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const [projFleet, setProjFleet] = useState(config.fleetSize);
  const [newLocation, setNewLocation] = useState('');
  const fileRef = useRef();

  const locations = config.locations || [];

  const handleAddLocation = () => {
    const trimmed = newLocation.trim();
    if (!trimmed || locations.includes(trimmed)) return;
    updateConfig({ locations: [...locations, trimmed] });
    setNewLocation('');
  };

  const handleRemoveLocation = (loc) => {
    updateConfig({ locations: locations.filter((l) => l !== loc) });
  };

  const field = (key, label, type = 'text', extra = {}) => (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input
        type={type}
        className={styles.input}
        value={config[key] ?? ''}
        onChange={(e) => {
          const v = type === 'number' ? (e.target.value === '' ? null : parseFloat(e.target.value)) : e.target.value;
          updateConfig({ [key]: v });
        }}
        {...extra}
      />
    </div>
  );

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importFromJSON(file);
      importData(data, 'replace');
      setImportMsg({ type: 'success', text: `Imported ${data.costs.length} cost items successfully.` });
    } catch (err) {
      setImportMsg({ type: 'error', text: err.message });
    }
    e.target.value = '';
    setTimeout(() => setImportMsg(null), 5000);
  };

  const projectedCPS = projectedCostPerScooterSimple(costs, config.fleetSize, projFleet);

  return (
    <div className={styles.page}>
      <Header title="Settings" subtitle="Configure your fleet and manage data" />

      <div className={styles.content}>

        {/* Fleet Configuration */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Bike size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Fleet Configuration</h2>
          </div>
          <div className={styles.grid}>
            {field('companyName', 'Company Name')}
            {field('fleetSize', 'Fleet Size (scooters)', 'number', { min: 1, step: 1 })}
          </div>
        </section>

        {/* Financial Targets */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Target size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Financial Targets</h2>
          </div>
          <p className={styles.sectionDesc}>
            Set optional targets to see budget variance indicators on the Dashboard.
          </p>
          <div className={styles.grid}>
            <div className={styles.field}>
              <label className={styles.label}>Budget Target per Scooter / Month (EUR)</label>
              <div className={styles.amountWrap}>
                <span className={styles.eurSymbol}>€</span>
                <input
                  type="number"
                  className={`${styles.input} ${styles.amountInput}`}
                  value={config.targetCostPerScooter ?? ''}
                  onChange={(e) => updateConfig({ targetCostPerScooter: e.target.value === '' ? null : parseFloat(e.target.value) })}
                  placeholder="e.g. 120"
                  min="0"
                  step="0.01"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Fleet Size Projection */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <TrendingUp size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Fleet Growth Projection</h2>
          </div>
          <p className={styles.sectionDesc}>
            See how your cost-per-scooter changes as the fleet grows. Fixed costs spread across more
            scooters; variable costs scale proportionally.
          </p>
          <div className={styles.projCard}>
            <div className={styles.projLabels}>
              <span>Current: <strong>{config.fleetSize} scooters</strong></span>
              <span className={styles.projNew}>Projected: <strong>{projFleet} scooters</strong></span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min={1}
              max={Math.max(config.fleetSize * 3, 100)}
              value={projFleet}
              onChange={(e) => setProjFleet(Number(e.target.value))}
            />
            <div className={styles.projResults}>
              <div className={styles.projItem}>
                <span className={styles.projLabel}>Current cost/scooter/month</span>
                <span className={styles.projValue}>{formatEUR(projectedCostPerScooterSimple(costs, config.fleetSize, config.fleetSize))}</span>
              </div>
              <div className={styles.projArrow}>→</div>
              <div className={styles.projItem}>
                <span className={styles.projLabel}>Projected cost/scooter/month</span>
                <span className={`${styles.projValue} ${projectedCPS < projectedCostPerScooterSimple(costs, config.fleetSize, config.fleetSize) ? styles.projBetter : styles.projWorse}`}>
                  {formatEUR(projectedCPS)}
                </span>
              </div>
              {projFleet !== config.fleetSize && (
                <div className={styles.projSaving}>
                  {projectedCPS < projectedCostPerScooterSimple(costs, config.fleetSize, config.fleetSize)
                    ? `Save ${formatEUR(projectedCostPerScooterSimple(costs, config.fleetSize, config.fleetSize) - projectedCPS)}/scooter by growing to ${projFleet} units`
                    : `Cost increases by ${formatEUR(projectedCPS - projectedCostPerScooterSimple(costs, config.fleetSize, config.fleetSize))}/scooter at ${projFleet} units`}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Locations */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <MapPin size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Locations</h2>
          </div>
          <p className={styles.sectionDesc}>
            Add your operating cities or zones. Once configured, you can tag costs and revenue imports
            to a specific location and filter the dashboard by city.
          </p>

          {locations.length > 0 ? (
            <ul className={styles.locationList}>
              {locations.map((loc) => (
                <li key={loc} className={styles.locationPill}>
                  <span className={styles.locationPillName}>{loc}</span>
                  <button
                    className={styles.locationPillRemove}
                    onClick={() => handleRemoveLocation(loc)}
                    title={`Remove ${loc}`}
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.locationEmpty}>
              No locations added yet. Add your first city to enable location filtering.
            </p>
          )}

          <div className={styles.locationAdd}>
            <input
              className={styles.input}
              placeholder="e.g. Athens"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddLocation()}
              style={{ flex: 1 }}
            />
            <Button variant="outline" size="sm" onClick={handleAddLocation} disabled={!newLocation.trim()}>
              <Plus size={14} /> Add
            </Button>
          </div>
        </section>

        {/* Bank Integration */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Link2 size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Bank Integration</h2>
          </div>
          <p className={styles.sectionDesc}>
            Connect your Alpha Bank account to automatically import outgoing transactions as draft
            cost entries. Powered by GoCardless open banking (free, PSD2 compliant).
            You will need a free GoCardless account — set <code>GOCARDLESS_SECRET_ID</code> and{' '}
            <code>GOCARDLESS_SECRET_KEY</code> in Vercel environment variables to activate.
          </p>
          <BankConnect />
          <BankTransactionReview />
        </section>

        {/* Data Management */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Database size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Data Management</h2>
          </div>
          <div className={styles.dataActions}>
            <div className={styles.dataCard}>
              <div className={styles.dataCardHeader}>
                <Download size={16} />
                <span>Export Backup</span>
              </div>
              <p className={styles.dataCardDesc}>Download all your costs and settings as a JSON file.</p>
              <Button variant="outline" size="sm" onClick={() => exportToJSON(costs, config)}>
                <Download size={14} /> Download JSON
              </Button>
            </div>

            <div className={styles.dataCard}>
              <div className={styles.dataCardHeader}>
                <Download size={16} />
                <span>Export Dashboard PDF</span>
              </div>
              <p className={styles.dataCardDesc}>Save your dashboard as a PDF report.</p>
              <Button variant="outline" size="sm" onClick={() => exportDashboardToPDF('dashboard-export')}>
                <Download size={14} /> Export PDF
              </Button>
            </div>

            <div className={styles.dataCard}>
              <div className={styles.dataCardHeader}>
                <Upload size={16} />
                <span>Import Backup</span>
              </div>
              <p className={styles.dataCardDesc}>Restore from a previously exported JSON file (replaces current data).</p>
              <input type="file" accept=".json" ref={fileRef} style={{ display: 'none' }} onChange={handleImport} />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> Import JSON
              </Button>
              {importMsg && (
                <div className={`${styles.importMsg} ${importMsg.type === 'error' ? styles.importError : styles.importSuccess}`}>
                  {importMsg.text}
                </div>
              )}
            </div>

            <div className={styles.dataCard}>
              <div className={styles.dataCardHeader}>
                <Database size={16} />
                <span>Sample Data</span>
              </div>
              <p className={styles.dataCardDesc}>Load realistic sample costs for a 20-scooter Greek fleet.</p>
              <Button variant="secondary" size="sm" onClick={loadSampleData}>Load Sample Data</Button>
            </div>

            <div className={`${styles.dataCard} ${styles.dataCardDanger}`}>
              <div className={styles.dataCardHeader}>
                <Trash2 size={16} style={{ color: 'var(--color-danger)' }} />
                <span style={{ color: 'var(--color-danger)' }}>Clear All Data</span>
              </div>
              <p className={styles.dataCardDesc}>Permanently delete all costs and reset settings. Cannot be undone.</p>
              <Button variant="danger" size="sm" onClick={() => setClearConfirm(true)}>
                <Trash2 size={14} /> Clear Everything
              </Button>
            </div>
          </div>
        </section>

      </div>

      <ConfirmDialog
        isOpen={clearConfirm}
        onClose={() => setClearConfirm(false)}
        onConfirm={clearAllData}
        title="Clear All Data"
        message="This will permanently delete all cost entries and reset all settings. Export a backup first if needed."
        confirmLabel="Clear All"
      />
    </div>
  );
}
