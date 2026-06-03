import { useState, useRef, useEffect } from 'react';
import {
  Download, Upload, Trash2, Database, Bike, Target,
  DollarSign, TrendingUp, MapPin, Plus, X, Link2, PieChart, ClipboardList,
  Users, UserPlus, Loader2, CheckCircle, AlertCircle, Archive, Terminal, RefreshCw,
} from 'lucide-react';
import useHoppSync from '../hooks/useHoppSync.js';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { seedProjectsIfEmpty } from '../utils/seedProjects.js';
import { authedFetch } from '../utils/apiClient.js';
import { CATEGORIES } from '../utils/constants.js';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import Modal from '../components/Shared/Modal.jsx';
import BankConnect from '../components/Bank/BankConnect.jsx';
import BankTransactionReview from '../components/Bank/BankTransactionReview.jsx';
import ScooterTabsConfig from '../components/Settings/ScooterTabsConfig.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { useMaintenance } from '../context/MaintenanceContext.jsx';
import { useFleet } from '../context/FleetContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { exportToJSON, importFromJSON, exportDashboardToPDF } from '../utils/exportData.js';
import { projectedCostPerScooterSimple } from '../utils/calculations.js';
import { formatEUR } from '../utils/formatters.js';
import { useToast } from '../context/ToastContext.jsx';
import styles from './Settings.module.css';

// #221, #223: Proper component so useState is valid (field() helper can't call hooks directly)
function FieldInput({ configKey: _configKey, label, type, configValue, onCommit, extra, styles: s }) {
  const [localVal, setLocalVal] = useState(configValue);

  // Sync when config value changes externally (e.g. on initial load)
  useEffect(() => {
    setLocalVal(configValue);
  }, [configValue]);

  return (
    <div className={s.field}>
      <label className={s.label}>{label}</label>
      <input
        type={type}
        className={s.input}
        value={localVal}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={(e) => {
          if (type === 'number') {
            const parsed = parseFloat(e.target.value);
            // #223: guard against NaN — fall back to existing config value
            const v = Number.isFinite(parsed) ? parsed : configValue ?? null;
            setLocalVal(v ?? '');
            onCommit(v);
          } else {
            onCommit(e.target.value);
          }
        }}
        {...extra}
      />
    </div>
  );
}

// #221 — money inputs commit on BLUR (not per-keystroke) to stop Firestore write-spam.
// Separate component because the category-budget inputs render inside a .map() (hooks
// can't be called in a map callback). Preserves the € amount markup + null-on-empty.
function MoneyField({ label, value, onCommit, styles: s, placeholder, step = '0.01' }) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => { setLocal(value ?? ''); }, [value]);
  return (
    <div className={s.field}>
      <label className={s.label}>{label}</label>
      <div className={s.amountWrap}>
        <span className={s.eurSymbol}>€</span>
        <input
          type="number"
          className={`${s.input} ${s.amountInput}`}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={(e) => {
            const raw = e.target.value;
            if (raw === '') { setLocal(''); onCommit(null); return; }
            const parsed = parseFloat(raw);
            const v = Number.isFinite(parsed) ? parsed : null;
            setLocal(v ?? '');
            onCommit(v);
          }}
          placeholder={placeholder}
          min="0"
          step={step}
        />
      </div>
    </div>
  );
}

export default function Settings() {
  const { costs, config, updateConfig, addLocation, removeLocation, loadSampleData, clearAllData, importData } = useCosts();
  const { scooters } = useMaintenance();
  const { scopeByFleet, isAllFleets } = useFleet();
  const { createTechnicianAccount, signOut, userProfile } = useAuth();
  const { success: toastSuccess, error: toastError } = useToast();
  const [clearConfirm, setClearConfirm] = useState(false);

  // ── Live fleet size: prefer scooter count scoped to the active fleet ────────
  // Falls back to config.fleetSize when no scooters are loaded yet.
  const liveFleetSize = (scooters && scooters.length > 0)
    ? (isAllFleets ? scooters.length : (scopeByFleet(scooters).length || null))
    : null;
  const effectiveFleetSize = liveFleetSize ?? config.fleetSize;

  const [projFleet, setProjFleet] = useState(config.fleetSize);

  // #553 / #558 — sync projFleet when the effective fleet size loads (starts as
  // the constants.js default of 10 until Firestore/Supabase + scooter data arrive).
  // Uses the live scooter count (fleet-scoped) when available, otherwise config.fleetSize.
  // If the user already dragged the slider above the current fleet we leave it alone;
  // if it is *below* the effective fleet size we snap it up so the default scenario is
  // always growth (or neutral), never a shrink.
  useEffect(() => {
    if (effectiveFleetSize && projFleet < effectiveFleetSize) {
      setProjFleet(effectiveFleetSize);
    }
  }, [effectiveFleetSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const [newLocation, setNewLocation] = useState('');
  const fileRef = useRef();

  // Team management state
  const [technicians, setTechnicians] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('crew'); // crew | staff | admin
  const [inviteLoading, setInviteLoading] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(null); // uid to remove
  // Accountant email config — #88: no hardcoded email fallback
  const [accountantEmail, setAccountantEmail] = useState(() => localStorage.getItem('omni_accountant_email') || '');
  const [accountantSaved, setAccountantSaved] = useState(false);

  // Load crew accounts in real time (crew + technician roles)
  // #401: scope to caller's org to prevent cross-tenant user list leaks
  useEffect(() => {
    if (!userProfile?.orgId) return;
    const q = query(
      collection(db, 'users'),
      where('role', 'in', ['technician', 'crew', 'staff', 'contractor']),
      where('orgId', '==', userProfile.orgId),
    );
    // #210: add onError callback so listener failures surface rather than silently dying
    const unsub = onSnapshot(
      q,
      (snap) => {
        setTechnicians(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
      },
      (err) => {
        console.error('Team listener error:', err);
      },
    );
    return unsub;
  }, [userProfile?.orgId]);

  const handleSaveAccountant = () => {
    localStorage.setItem('omni_accountant_email', accountantEmail.trim());
    setAccountantSaved(true);
    setTimeout(() => setAccountantSaved(false), 2000);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !invitePassword.trim()) return;
    setInviteLoading(true);
    try {
      await createTechnicianAccount(inviteEmail.trim(), invitePassword, inviteName.trim(), inviteRole);
      const ROLE_LABELS = { crew: 'Crew', contractor: 'Contractor', staff: 'Staff', admin: 'Admin' };
      const roleLabel = ROLE_LABELS[inviteRole] ?? 'Crew';
      // #361 — use toast instead of inline status state
      toastSuccess(`${roleLabel} account created for ${inviteEmail.trim()}.`);
      setInviteEmail('');
      setInvitePassword('');
      setInviteName('');
      setInviteRole('crew');
    } catch (err) {
      toastError(err.message);
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRemoveTechnician = async (uid) => {
    // #185 — only admins and owners may remove team members (client-side pre-check;
    // the server re-validates in api/delete-user.js)
    if (!['admin', 'owner'].includes(userProfile?.role)) {
      toastError('Only admins and owners can remove team members.');
      return;
    }
    // #401 — cross-org delete guard (client-side pre-check; server re-validates)
    const target = technicians.find((t) => t.uid === uid);
    if (target?.orgId && target.orgId !== userProfile?.orgId) {
      toastError('Cannot remove a user from another organisation.');
      return;
    }
    // #bug-18 — delete both Firestore doc + Firebase Auth account via server-side Admin SDK
    const res = await authedFetch('/api/delete-user', {
      method: 'POST',
      body: JSON.stringify({ uid }),
    });
    const data = await res.json();
    if (!res.ok) {
      toastError(data.error || 'Failed to remove user');
      return;
    }
    setRemoveConfirm(null);
  };

  // ── Account deletion (B5 / ROADMAP 2.6) ──────────────────────────────────
  // Server decides the outcome from the caller's own role (api/delete-account.js);
  // we just preview, collect a typed confirmation, POST, then sign out.
  const [acctPreview, setAcctPreview] = useState(null);   // server 'preview' result
  const [acctOpen, setAcctOpen] = useState(false);        // danger-zone dialog open
  const [acctConfirmText, setAcctConfirmText] = useState('');
  const [acctSuccessor, setAcctSuccessor] = useState('');
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctError, setAcctError] = useState(null);

  const isOwner = userProfile?.role === 'owner';

  // #452 — if a non-owner somehow has inviteRole='admin' in state (e.g. role
  // was downgraded after the dropdown was opened), reset to 'crew' so the form
  // can't submit an admin invite that the backend will now reject anyway.
  // #500 — this effect MUST stay below the `isOwner` declaration above: its
  // dependency array reads `isOwner`, so placing it earlier hit the Temporal
  // Dead Zone and crashed /settings with "Cannot access 'isOwner'/'we' before initialization".
  useEffect(() => {
    if (!isOwner && inviteRole === 'admin') setInviteRole('crew');
  }, [isOwner, inviteRole]);

  const openAccountDialog = async () => {
    setAcctError(null);
    setAcctConfirmText('');
    setAcctSuccessor('');
    setAcctBusy(true);
    setAcctOpen(true);
    try {
      const res = await authedFetch('/api/delete-account', {
        method: 'POST',
        body: JSON.stringify({ action: 'preview' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load account details.');
      setAcctPreview(data);
    } catch (err) {
      setAcctError(err.message);
    } finally {
      setAcctBusy(false);
    }
  };

  const submitAccountDeletion = async () => {
    setAcctError(null);
    setAcctBusy(true);
    try {
      // Choose the action from the previewed outcome.
      let body;
      if (!acctPreview?.isOwner) {
        body = { action: 'leave' };
      } else if (acctSuccessor) {
        body = { action: 'transfer', successorUid: acctSuccessor };
      } else {
        body = { action: 'delete-org', confirm: acctConfirmText.trim() };
      }
      const res = await authedFetch('/api/delete-account', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Account deletion failed.');
      // For 'leave' and 'transfer' the account is gone → sign out. For 'delete-org'
      // the org is only SCHEDULED (30-day grace) → the owner stays signed in so they
      // can still cancel; just close the dialog and show nothing destructive yet.
      if (body.action === 'delete-org') {
        setAcctOpen(false);
        setAcctPreview(null);
        alert(data.message); // simple confirmation; org now has a deleteAt
      } else {
        await signOut();
      }
    } catch (err) {
      setAcctError(err.message);
    } finally {
      setAcctBusy(false);
    }
  };

  const locations = config.locations ?? [];

  const handleAddLocation = async () => {
    const trimmed = newLocation.trim();
    if (!trimmed) return;
    await addLocation(trimmed);
    setNewLocation('');
  };

  const handleRemoveLocation = async (loc) => {
    await removeLocation(loc);
  };

  // field() returns a FieldInput element — a proper component so useState is valid (#221, #223)
  const field = (key, label, type = 'text', extra = {}) => (
    <FieldInput
      key={key}
      configKey={key}
      label={label}
      type={type}
      configValue={config[key] ?? ''}
      onCommit={(v) => updateConfig({ [key]: v })}
      extra={extra}
      styles={styles}
    />
  );

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importFromJSON(file);
      // #222: await importData so failures are caught; previously fire-and-forget
      await importData(data, 'replace');
      // #361 — use toast instead of inline importMsg state
      toastSuccess(`Imported ${data.costs.length} cost items successfully.`);
    } catch (err) {
      toastError(err.message);
    }
    e.target.value = '';
  };

  const projectedCPS = projectedCostPerScooterSimple(costs, effectiveFleetSize, projFleet);

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
            <MoneyField
              label="Budget Target per Scooter / Month (EUR)"
              value={config.targetCostPerScooter}
              onCommit={(v) => updateConfig({ targetCostPerScooter: v })}
              styles={styles}
              placeholder="e.g. 120"
              step="0.01"
            />
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
              <MoneyField
                key={key}
                label={`${cat.fullLabel} / month (€)`}
                value={config.categoryBudgets?.[key]}
                onCommit={(v) => updateConfig({
                  categoryBudgets: { ...(config.categoryBudgets || {}), [key]: v },
                })}
                styles={styles}
                placeholder="No budget set"
                step="1"
              />
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

            {/* Monthly SIM cost — #507: use MoneyField so write fires on blur, not per keystroke */}
            <div>
              <MoneyField
                label="Monthly SIM Cost (€)"
                value={config.financial?.monthlySimCost ?? 150}
                onCommit={(v) => updateConfig({
                  financial: { ...(config.financial || {}), monthlySimCost: v ?? 0 },
                })}
                styles={styles}
                placeholder="150"
                step="1"
              />
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
              <span>Current: <strong>{effectiveFleetSize} scooters</strong>{liveFleetSize != null ? ' (live)' : ''}</span>
              <span className={styles.projNew}>Projected: <strong>{projFleet} scooters</strong></span>
            </div>
            <input
              type="range"
              className={styles.slider}
              min={1}
              max={Math.max(effectiveFleetSize * 3, 100)}
              value={projFleet}
              onChange={(e) => setProjFleet(Number(e.target.value))}
            />
            <div className={styles.projResults}>
              <div className={styles.projItem}>
                <span className={styles.projLabel}>Current cost/scooter/month</span>
                <span className={styles.projValue}>{formatEUR(projectedCostPerScooterSimple(costs, effectiveFleetSize, effectiveFleetSize))}</span>
              </div>
              <div className={styles.projArrow}>→</div>
              <div className={styles.projItem}>
                <span className={styles.projLabel}>Projected cost/scooter/month</span>
                <span className={`${styles.projValue} ${projectedCPS < projectedCostPerScooterSimple(costs, effectiveFleetSize, effectiveFleetSize) ? styles.projBetter : styles.projWorse}`}>
                  {formatEUR(projectedCPS)}
                </span>
              </div>
              {projFleet !== effectiveFleetSize && (
                <div className={styles.projSaving}>
                  {projectedCPS < projectedCostPerScooterSimple(costs, effectiveFleetSize, effectiveFleetSize)
                    ? `Save ${formatEUR(projectedCostPerScooterSimple(costs, effectiveFleetSize, effectiveFleetSize) - projectedCPS)}/scooter by growing to ${projFleet} units`
                    : `Cost increases by ${formatEUR(projectedCPS - projectedCostPerScooterSimple(costs, effectiveFleetSize, effectiveFleetSize))}/scooter at ${projFleet} units`}
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
                  {/* Phase 2.5 F5 — external contractor: crew-tier, scoped to assigned scooters */}
                  <option value="contractor">Contractor — external; assigned scooters only</option>
                  <option value="staff">Staff — full ops, no financial details</option>
                  {/* #452 — only owners may mint admins; hide option from non-owners */}
                  {isOwner && <option value="admin">Admin — full access</option>}
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
          {/* ScooterConfigProvider is now at the admin root (App.jsx — Bug #356).
              ScooterTabsConfig consumes it from there; no local wrapper needed. */}
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
            {!accountantEmail.trim() && (
              <p style={{ marginTop: 6, fontSize: 12, color: 'var(--status-amber)' }}>
                Set accountant email before forwarding invoices.
              </p>
            )}
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
            </div>

            <div className={styles.dataCard}>
              <div className={styles.dataCardHeader}>
                <ClipboardList size={16} />
                <span>Seed Projects</span>
              </div>
              <p className={styles.dataCardDesc}>Load the 7 launch projects into the Projects module (skips if projects already exist).</p>
              <Button variant="secondary" size="sm" onClick={async () => {
                const seeded = await seedProjectsIfEmpty(userProfile?.orgId);
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
              rel="noopener noreferrer"
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

        {/* ─── Danger Zone: delete account / organization (B5 / ROADMAP 2.6) ─── */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <Trash2 size={18} className={styles.sectionIcon} style={{ color: 'var(--color-danger)' }} />
            <h2 className={styles.sectionTitle} style={{ color: 'var(--color-danger)' }}>Danger Zone</h2>
          </div>
          <p className={styles.sectionDesc}>
            {isOwner
              ? 'Delete your organization (30-day grace period) or transfer ownership to an admin.'
              : 'Permanently remove your own account from this organization.'}
          </p>
          <Button variant="danger" onClick={openAccountDialog}>
            {isOwner ? 'Delete organization…' : 'Delete my account…'}
          </Button>
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

      <ConfirmDialog
        isOpen={!!removeConfirm}
        onClose={() => setRemoveConfirm(null)}
        onConfirm={() => handleRemoveTechnician(removeConfirm)}
        title="Remove Technician"
        message="This will permanently remove the technician's access and delete their login account."
        confirmLabel="Remove Access"
      />

      {/* ─── Account / org deletion dialog (B5) — preview-driven ─── */}
      <Modal
        isOpen={acctOpen}
        onClose={() => { if (!acctBusy) { setAcctOpen(false); setAcctPreview(null); } }}
        title={acctPreview?.isOwner ? 'Delete organization' : 'Delete my account'}
        width={460}
      >
        {acctBusy && !acctPreview ? (
          <p style={{ color: 'var(--fg-muted)' }}>Loading account details…</p>
        ) : acctError && !acctPreview ? (
          <p style={{ color: 'var(--color-danger)' }}>{acctError}</p>
        ) : acctPreview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!acctPreview.isOwner ? (
              <p>
                This permanently removes <strong>your account</strong> from{' '}
                <strong>{acctPreview.orgName}</strong> and signs you out. This cannot be undone.
              </p>
            ) : acctPreview.otherAdmins.length > 0 ? (
              <>
                <p>
                  You own <strong>{acctPreview.orgName}</strong> ({acctPreview.memberCount} member
                  {acctPreview.memberCount === 1 ? '' : 's'}). Choose one:
                </p>
                <label style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  Transfer ownership to an admin, then leave:
                  <select
                    value={acctSuccessor}
                    onChange={(e) => setAcctSuccessor(e.target.value)}
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: '8px' }}
                  >
                    <option value="">— select successor (optional) —</option>
                    {acctPreview.otherAdmins.map((a) => (
                      <option key={a.uid} value={a.uid}>{a.displayName || a.email}</option>
                    ))}
                  </select>
                </label>
                {!acctSuccessor && (
                  <p style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
                    Or leave the dropdown empty to <strong>delete the whole organization</strong>{' '}
                    (30-day grace period). To confirm deletion, type the org name below.
                  </p>
                )}
              </>
            ) : (
              <p>
                Deleting <strong>{acctPreview.orgName}</strong> schedules permanent removal of all its
                data in <strong>{acctPreview.graceDays} days</strong>. You can cancel any time before then.
                Type the org name to confirm.
              </p>
            )}

            {acctPreview.isOwner && !acctSuccessor && (
              <input
                type="text"
                placeholder={acctPreview.orgName}
                value={acctConfirmText}
                onChange={(e) => setAcctConfirmText(e.target.value)}
                style={{ width: '100%', padding: '8px' }}
              />
            )}

            {acctError && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-sm)' }}>{acctError}</p>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => { setAcctOpen(false); setAcctPreview(null); }} disabled={acctBusy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={submitAccountDeletion}
                disabled={acctBusy || (acctPreview.isOwner && !acctSuccessor && acctConfirmText.trim() !== acctPreview.orgName)}
              >
                {acctBusy ? 'Please wait…'
                  : !acctPreview.isOwner ? 'Delete my account'
                  : acctSuccessor ? 'Transfer & leave'
                  : 'Schedule deletion'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
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
  // Bug #372: Red only when ALL 3 most-recent syncs failed (not on a single failure).
  // A single transient failure resolves to amber (allOk=false but not allFailed),
  // matching the spec: red = "consistently broken", amber = "degraded".
  const allFailed = recentSyncs.length > 0 && recentSyncs.slice(0, 3).every((s) => !s.ok);
  const statusColor = !lastTs
    ? 'var(--fg-muted)'
    : allFailed ? 'var(--status-red)'
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
