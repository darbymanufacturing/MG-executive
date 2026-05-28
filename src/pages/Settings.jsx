import { useState, useRef, useEffect } from 'react';
import {
  Download, Upload, Trash2, Database, Bike, Target,
  DollarSign, TrendingUp, MapPin, Plus, X, Link2, PieChart, ClipboardList,
  Users, UserPlus, Loader2, CheckCircle, AlertCircle, Archive, Terminal, RefreshCw,
} from 'lucide-react';
import useHoppSync from '../hooks/useHoppSync.js';
import { collection, onSnapshot, query, where, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { seedProjectsIfEmpty } from '../utils/seedProjects.js';
import { CATEGORIES } from '../utils/constants.js';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import BankConnect from '../components/Bank/BankConnect.jsx';
import BankTransactionReview from '../components/Bank/BankTransactionReview.jsx';
import ScooterTabsConfig from '../components/Settings/ScooterTabsConfig.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { exportToJSON, importFromJSON, exportDashboardToPDF } from '../utils/exportData.js';
import { projectedCostPerScooterSimple } from '../utils/calculations.js';
import { formatEUR } from '../utils/formatters.js';
import styles from './Settings.module.css';

export default function Settings() {
  const { costs, config, updateConfig, loadSampleData, clearAllData, importData } = useCosts();
  const { createTechnicianAccount } = useAuth();
  const [clearConfirm, setClearConfirm] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const [projFleet, setProjFleet] = useState(config.fleetSize);
  const [newLocation, setNewLocation] = useState('');
  const fileRef = useRef();

  // Team management state
  const [technicians, setTechnicians] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('crew'); // crew | staff | admin
  const [inviteStatus, setInviteStatus] = useState(null); // { type: 'success'|'error', text }
  const [inviteLoading, setInviteLoading] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(null); // uid to remove
  // Accountant email config
  const [accountantEmail, setAccountantEmail] = useState(() => localStorage.getItem('omni_accountant_email') || 'nsoukoulis@outlook.com');
  const [accountantSaved, setAccountantSaved] = useState(false);

  // Load crew accounts in real time (crew + technician roles)
  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', 'in', ['technician', 'crew', 'staff']));
    const unsub = onSnapshot(q, (snap) => {
      setTechnicians(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const handleSaveAccountant = () => {
    localStorage.setItem('omni_accountant_email', accountantEmail.trim());
    setAccountantSaved(true);
    setTimeout(() => setAccountantSaved(false), 2000);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !invitePassword.trim()) return;
    setInviteLoading(true);
    setInviteStatus(null);
    try {
      await createTechnicianAccount(inviteEmail.trim(), invitePassword, inviteName.trim(), inviteRole);
      const roleLabel = inviteRole === 'crew' ? 'Crew' : inviteRole === 'staff' ? 'Staff' : 'Admin';
      setInviteStatus({ type: 'success', text: `${roleLabel} account created for ${inviteEmail.trim()}.` });
      setInviteEmail('');
      setInvitePassword('');
      setInviteName('');
      setInviteRole('crew');
    } catch (err) {
      setInviteStatus({ type: 'error', text: err.message });
    } finally {
      setInviteLoading(false);
      setTimeout(() => setInviteStatus(null), 6000);
    }
  };

  const handleRemoveTechnician = async (uid) => {
    await deleteDoc(doc(db, 'users', uid));
    setRemoveConfirm(null);
  };

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

        {/* Monthly Category Budgets */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <PieChart size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Monthly Category Budgets</h2>
          </div>
          <p className={styles.sectionDesc}>
            Set a monthly spend budget per cost category. The Dashboard will show actual vs budget variance for each.
            Leave blank to skip tracking for that category.
          </p>
          <div className={styles.grid}>
            {Object.entries(CATEGORIES).map(([key, cat]) => (
              <div key={key} className={styles.field}>
                <label className={styles.label}>{cat.fullLabel} / month (€)</label>
                <div className={styles.amountWrap}>
                  <span className={styles.eurSymbol}>€</span>
                  <input
                    type="number"
                    className={`${styles.input} ${styles.amountInput}`}
                    value={config.categoryBudgets?.[key] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : parseFloat(e.target.value);
                      updateConfig({
                        categoryBudgets: { ...(config.categoryBudgets || {}), [key]: val },
                      });
                    }}
                    placeholder="No budget set"
                    min="0"
                    step="1"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Revenue Adjustments */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <DollarSign size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Revenue Adjustments</h2>
          </div>
          <p className={styles.sectionDesc}>
            Configure how gross revenue is adjusted before P&amp;L and financial health calculations.
            VAT (24%) is always applied — it is collected but owed to the government.
          </p>
          <div className={styles.grid}>
            {/* Hopp franchise fee toggle */}
            <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
              <label className={styles.label} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.financial?.applyFranchiseFee ?? true}
                  onChange={(e) => updateConfig({
                    financial: { ...(config.financial || {}), applyFranchiseFee: e.target.checked },
                  })}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--color-brand)' }}
                />
                <span>Apply Hopp franchise fee (19% deducted from net revenue)</span>
              </label>
              <p style={{ margin: '6px 0 0 26px', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Turn this off when migrating to OTORide. All KPIs update immediately.
              </p>
            </div>

            {/* Monthly SIM cost */}
            <div className={styles.field}>
              <label className={styles.label}>Monthly SIM Cost (€)</label>
              <div className={styles.amountWrap}>
                <span className={styles.eurSymbol}>€</span>
                <input
                  type="number"
                  className={`${styles.input} ${styles.amountInput}`}
                  value={config.financial?.monthlySimCost ?? 150}
                  onChange={(e) => updateConfig({
                    financial: { ...(config.financial || {}), monthlySimCost: e.target.value === '' ? 0 : parseFloat(e.target.value) },
                  })}
                  placeholder="150"
                  min="0"
                  step="1"
                />
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Fleet-level flat SIM cost (≈ €3/scooter regardless of active status). Update when fleet size changes.
              </p>
            </div>

            {/* Read-only info strip */}
            <div className={styles.field}>
              <label className={styles.label}>Fixed Rates</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <span style={{ padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)', fontSize: 'var(--text-xs)', border: '1px solid var(--color-border)' }}>
                  VAT 24%
                </span>
                <span style={{ padding: '3px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-2)', fontSize: 'var(--text-xs)', border: '1px solid var(--color-border)' }}>
                  Hopp 19%
                </span>
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
            Connect your Greek bank account (Alpha Bank, Eurobank, NBG) to automatically import
            outgoing transactions as draft cost entries. Powered by Salt Edge (PSD2 compliant).
            Set <code>SALTEDGE_APP_ID</code> and <code>SALTEDGE_SECRET</code> in Vercel environment
            variables to activate.
          </p>
          <BankConnect />
          <BankTransactionReview />
        </section>

        {/* Team Management */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Users size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Team — Technician Accounts</h2>
          </div>
          <p className={styles.sectionDesc}>
            Create logins for field technicians. They see only their repair queue — no financial data.
          </p>

          {/* Existing technicians */}
          {technicians.length > 0 && (
            <div className={styles.teamList}>
              {technicians.map((tech) => (
                <div key={tech.uid} className={styles.teamRow}>
                  <div className={styles.teamInfo}>
                    <span className={styles.teamName}>{tech.displayName}</span>
                    <span className={styles.teamEmail}>{tech.email}</span>
                  </div>
                  <button
                    className={styles.teamRemoveBtn}
                    onClick={() => setRemoveConfirm(tech.uid)}
                    title="Remove technician"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Invite form */}
          <div className={styles.inviteForm}>
            <h3 className={styles.inviteTitle}>
              <UserPlus size={15} />
              Add Team Member
            </h3>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label className={styles.label}>Full Name</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Nikos Papadopoulos"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Email</label>
                <input
                  type="email"
                  className={styles.input}
                  placeholder="member@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Temporary Password</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="Min. 6 characters"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Role</label>
                <select
                  className={styles.input}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{ cursor: 'pointer' }}
                >
                  <option value="crew">Crew — repairs, tickets, procedures only</option>
                  <option value="staff">Staff — full ops, no financial details</option>
                  <option value="admin">Admin — full access</option>
                </select>
              </div>
            </div>
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleInvite}
                disabled={inviteLoading || !inviteEmail.trim() || !invitePassword.trim()}
              >
                {inviteLoading
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</>
                  : <><UserPlus size={14} /> Create Account</>
                }
              </Button>
              {inviteStatus && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)',
                  color: inviteStatus.type === 'success' ? '#00C896' : 'var(--color-danger)' }}>
                  {inviteStatus.type === 'success'
                    ? <CheckCircle size={14} />
                    : <AlertCircle size={14} />
                  }
                  {inviteStatus.text}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Scooter Page */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Bike size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Scooter Page</h2>
          </div>
          <p className={styles.sectionDesc}>
            Configure the tabs shown on each scooter's detail page. Drag to reorder, toggle to show/hide.
          </p>
          <ScooterTabsConfig />
        </section>

        {/* Accountant / Integrations */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Link2 size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>Integrations</h2>
          </div>
          <p className={styles.sectionDesc}>
            Configure external connections — accountant email forwarding, bank sync, etc.
          </p>
          <div className={styles.dataCard}>
            <div className={styles.dataCardHeader}>
              <Download size={16} />
              <span>Accountant Email</span>
            </div>
            <p className={styles.dataCardDesc}>
              Invoices captured via Omni Capture will be forwarded to this address when you click
              &quot;Forward to Accountant&quot;.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="email"
                className={styles.input}
                style={{ maxWidth: 320 }}
                placeholder="accountant@example.com"
                value={accountantEmail}
                onChange={e => { setAccountantEmail(e.target.value); setAccountantSaved(false); }}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveAccountant(); }}
              />
              <Button variant="secondary" size="sm" onClick={handleSaveAccountant}
                disabled={!accountantEmail.trim()}>
                {accountantSaved ? <><CheckCircle size={14} /> Saved</> : 'Save'}
              </Button>
            </div>
            <p className={styles.dataCardDesc} style={{ marginTop: 8, fontSize: 12 }}>
              This is stored locally. Set <code>ACCOUNTANT_EMAIL</code> env var in Vercel for the API.
            </p>
          </div>
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
                <ClipboardList size={16} />
                <span>Seed Projects</span>
              </div>
              <p className={styles.dataCardDesc}>Load the 7 launch projects into the Projects module (skips if projects already exist).</p>
              <Button variant="secondary" size="sm" onClick={async () => {
                const seeded = await seedProjectsIfEmpty();
                alert(seeded ? '✓ 7 projects seeded.' : 'Projects already exist — nothing changed.');
              }}>Seed Launch Projects</Button>
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

        {/* V1 Backup restore */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Archive size={18} className={styles.sectionIcon} />
            <h2 className={styles.sectionTitle}>V1 Backup</h2>
          </div>
          <p className={styles.sectionDesc}>
            The pre-Omni version of this app is preserved as a git tag.
            Use the command below in your terminal to restore it to a branch, or browse the code on GitHub.
          </p>
          <div className={styles.dataCard} style={{ borderColor: 'var(--status-amber-bg)' }}>
            <div className={styles.dataCardHeader}>
              <Terminal size={16} />
              <span>Restore V1 locally</span>
            </div>
            <p className={styles.dataCardDesc} style={{ marginBottom: 10 }}>
              Tagged as <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg-section)', padding: '2px 6px', borderRadius: 4 }}>v1-backup</code> on the main branch.
            </p>
            <pre style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              background: 'var(--bg-section)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              overflowX: 'auto',
              color: 'var(--fg-secondary)',
              margin: '0 0 12px',
              lineHeight: 1.6,
            }}>
{`# Browse the V1 snapshot
git checkout v1-backup

# Or create a branch from it
git checkout -b v1-restore v1-backup

# Return to Omni
git checkout main`}
            </pre>
            <a
              href="https://github.com/darbymanufacturing/MG-executive/releases/tag/v1-backup"
              target="_blank"
              rel="noreferrer"
              className="btn btn-outline btn-sm"
            >
              View V1 on GitHub
            </a>
          </div>
        </section>

        {/* ─── Hopp Sync ─────────────────────────────────────────
            Mirrors the hourly cron + Refresh button. Shows recent sync history
            from the syncLogs collection so admins can confirm freshness +
            spot per-scooter errors. See docs/runbooks/hopp-sync-troubleshooting.md. */}
        <HoppSyncSection />

      </div>

      <ConfirmDialog
        isOpen={clearConfirm}
        onClose={() => setClearConfirm(false)}
        onConfirm={clearAllData}
        title="Clear All Data"
        message="This will permanently delete all cost entries and reset all settings. Export a backup first if needed."
        confirmLabel="Clear All"
      />

      <ConfirmDialog
        isOpen={!!removeConfirm}
        onClose={() => setRemoveConfirm(null)}
        onConfirm={() => handleRemoveTechnician(removeConfirm)}
        title="Remove Technician"
        message="This will remove the technician's access. Their Firebase Auth account remains — contact Firebase console to fully delete it."
        confirmLabel="Remove Access"
      />
    </div>
  );
}

/* ── Hopp Sync section (Phase 1.8) ──────────────────────────── */
function HoppSyncSection() {
  const { refresh, syncing, lastSync, recentSyncs } = useHoppSync();

  const lastTs = lastSync?.finishedAt?.toDate?.() ?? null;
  // ageMin is intentionally derived from Date.now() at render time so the
  // "Last synced N min ago" label updates when the user navigates back to this
  // page. The react-hooks/purity rule flags this as impure but it's the desired
  // behaviour for a freshness indicator.
  // eslint-disable-next-line react-hooks/purity
  const ageMin = lastTs ? Math.floor((Date.now() - lastTs.getTime()) / 60000) : null;
  const allOk = recentSyncs.length > 0 && recentSyncs.slice(0, 3).every((s) => s.ok);
  const statusColor = !lastTs
    ? 'var(--fg-muted)'
    : !lastSync.ok ? 'var(--status-red)'
    : ageMin > 120 ? 'var(--status-amber)'
    : allOk ? 'var(--status-green)' : 'var(--status-amber)';

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <RefreshCw size={18} className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>Hopp Sync</h2>
      </div>
      <p className={styles.sectionDesc}>
        Trips, status events, and repair tickets auto-sync from Hopp every hour. The Refresh button in the top bar (or below) triggers an on-demand sync. Manual CSV imports remain available at <code>PME → Ingest</code>, <code>Maintenance → Repair Log</code>, and <code>Scooter Detail → Trips</code> as a fallback for backfill.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, display: 'inline-block' }} />
          <span style={{ fontSize: 13, color: 'var(--fg-secondary)' }}>
            {lastTs
              ? `Last synced ${ageMin < 1 ? 'just now' : `${ageMin} min ago`}`
              : 'No sync history yet'}
          </span>
        </div>
        <button
          className="btn btn-outline btn-sm"
          onClick={refresh}
          disabled={syncing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {syncing
            ? <><Loader2 size={14} className={styles.spinning} /> Syncing…</>
            : <><RefreshCw size={14} /> Sync now</>}
        </button>
      </div>

      {recentSyncs.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-section)', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--fg-secondary)' }}>When</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--fg-secondary)' }}>Trigger</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--fg-secondary)' }}>Trips / Events / Tickets</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--fg-secondary)' }}>Duration</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--fg-secondary)' }}>Errors</th>
              </tr>
            </thead>
            <tbody>
              {recentSyncs.map((s) => {
                const when = s.finishedAt?.toDate ? s.finishedAt.toDate() : null;
                const w = s.written || {};
                const errs = s.errors?.length || 0;
                return (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {s.ok
                          ? <CheckCircle size={13} style={{ color: 'var(--status-green)' }} />
                          : <AlertCircle size={13} style={{ color: 'var(--status-red)' }} />}
                        {when ? when.toLocaleString() : '—'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--fg-muted)' }}>{s.trigger}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)' }}>
                      {(w.trips || 0)} / {(w.events || 0)} / {(w.tickets || 0)}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--fg-muted)' }}>{s.durationMs ? `${Math.round(s.durationMs / 100) / 10}s` : '—'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {errs > 0
                        ? <span style={{ color: 'var(--status-red)' }}>{errs}</span>
                        : <span style={{ color: 'var(--fg-muted)' }}>0</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
