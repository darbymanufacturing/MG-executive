import { useState, useMemo, useRef, useEffect } from 'react';
import { Plus, Search, Pencil, Trash2, ListChecks, FileUp, FileDown, FileText, MapPin, Receipt, Check, X } from 'lucide-react';
import CostIntroOverlay from '../components/Costs/CostIntroOverlay.jsx';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import CostFormModal from '../components/Costs/CostFormModal.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import CategoryBadge from '../components/Costs/CategoryBadge.jsx';
import EmptyState from '../components/Shared/EmptyState.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { FREQUENCIES, CATEGORIES, CATEGORY_KEYS } from '../utils/constants.js';
import { formatEUR, formatDate } from '../utils/formatters.js';
import { normalizeToMonthly, getCostStatus, filterCostsByLocation } from '../utils/calculations.js';
import LocationSelector from '../components/Shared/LocationSelector.jsx';
import { exportCostsCSV, downloadCostTemplate } from '../utils/exportData.js';
import { parseCostsCSV } from '../utils/costCsvParser.js';
import styles from './CostManager.module.css';

const FILTER_TABS = [
  { key: 'all', label: 'All' },
  { key: 'one-off', label: 'One-Off' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'variable', label: 'Variable' },
  { key: 'investment', label: 'Investments' },
  { key: 'loan', label: 'Loans' },
  { key: 'credit-card', label: 'Credit Cards' },
];

const STATUS_LABELS = { active: 'Active', past: 'Ended', future: 'Upcoming' };

/* ─── Pending invoice captures from localStorage ─── */
function PendingInvoiceBanner({ onConfirm }) {
  const [pending, setPending] = useState([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem('omni_pending_costs');
        setPending(raw ? JSON.parse(raw) : []);
      } catch { setPending([]); }
    };
    load();
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, []);

  const save = (updated) => {
    setPending(updated);
    localStorage.setItem('omni_pending_costs', JSON.stringify(updated));
  };

  const confirm = (item, index) => {
    onConfirm({
      name: item.name,
      amount: item.amount,
      category: item.category || 'variable',
      frequency: 'once',
      startDate: item.startDate,
      notes: item.notes || '',
    });
    save(pending.filter((_, i) => i !== index));
  };

  const discard = (index) => {
    save(pending.filter((_, i) => i !== index));
  };

  if (!pending.length) return null;

  return (
    <div className={styles.pendingBanner}>
      <div className={styles.pendingBannerHeader} onClick={() => setExpanded(v => !v)}>
        <Receipt size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span className={styles.pendingBannerTitle}>
          {pending.length} invoice capture{pending.length !== 1 ? 's' : ''} pending review
        </span>
        <span className={styles.pendingBannerSub}>from Omni Capture</span>
        <span className={styles.pendingChevron}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className={styles.pendingList}>
          {pending.map((item, i) => (
            <div key={i} className={styles.pendingRow}>
              <div className={styles.pendingInfo}>
                <span className={styles.pendingName}>{item.name}</span>
                <span className={styles.pendingMeta}>
                  {item.amount ? `€${Number(item.amount).toLocaleString('el-GR', { minimumFractionDigits: 2 })}` : '—'}
                  {item.startDate ? ` · ${item.startDate}` : ''}
                  {item.notes ? ` · ${item.notes}` : ''}
                </span>
              </div>
              <div className={styles.pendingActions}>
                <button className="btn btn-ghost btn-xs" onClick={() => discard(i)} title="Discard">
                  <X size={13} />
                </button>
                <button className="btn btn-primary btn-xs" onClick={() => confirm(item, i)}>
                  <Check size={13} />Add to costs
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CostManager() {
  const { costs, config, loading: costsLoading, addCost, updateCost, deleteCost, bulkUpdateCosts, bulkDeleteCosts, importData } = useCosts();
  const locations = config.locations || [];
  const [showIntro, setShowIntro] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [csvMsg, setCsvMsg] = useState(null);
  const [csvLoading, setCsvLoading] = useState(false);
  const csvFileRef = useRef();
  // Multi-edit (bulk) selection — by cost `id`
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = filterCostsByLocation(costs, locationFilter);
    if (activeFilter !== 'all') list = list.filter((c) => c.category === activeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.notes || '').toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      let va, vb;
      if (sortBy === 'amount') { va = normalizeToMonthly(a); vb = normalizeToMonthly(b); }
      else if (sortBy === 'category') { va = a.category; vb = b.category; }
      else { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [costs, locationFilter, activeFilter, search, sortBy, sortDir]);

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setSortDir('asc'); }
  };

  // ── Multi-edit selection ─────────────────────────────────────────────────────
  const filteredIds = useMemo(() => filtered.map((c) => c.id), [filtered]);
  const selectedVisibleCount = filteredIds.reduce((n, id) => (selected.has(id) ? n + 1 : n), 0);
  const allVisibleSelected = filteredIds.length > 0 && selectedVisibleCount === filteredIds.length;

  const toggleRow = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => {
    const n = new Set(s);
    if (allVisibleSelected) filteredIds.forEach((id) => n.delete(id));
    else filteredIds.forEach((id) => n.add(id));
    return n;
  });
  const clearSelection = () => setSelected(new Set());
  const flash = (type, text) => { setCsvMsg({ type, text }); setTimeout(() => setCsvMsg(null), 6000); };

  const runBulk = async (fn, label) => {
    if (!selected.size) return;
    setBulkBusy(true);
    try {
      const n = await fn([...selected]);
      flash('success', `${label} ${n} cost item${n !== 1 ? 's' : ''}.`);
      clearSelection();
    } catch (err) {
      flash('error', `Bulk action failed: ${err.message}`);
    }
    setBulkBusy(false);
  };

  const applyBulkCategory = (category) => category && runBulk((ids) => bulkUpdateCosts(ids, { category }), 'Re-categorized');
  const applyBulkLocation = (location) => runBulk((ids) => bulkUpdateCosts(ids, { location: location || null }), 'Updated location for');
  const confirmBulkDelete = async () => { await runBulk(bulkDeleteCosts, 'Deleted'); setBulkDeleteOpen(false); };

  const openAdd = () => { setEditingCost(null); setModalOpen(true); };
  const openEdit = (cost) => { setEditingCost(cost); setModalOpen(true); };

  const handleSave = (data) => {
    if (editingCost) updateCost(editingCost.id, data);
    else addCost(data);
  };

  const handleCsvImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_SIZE) {
      setCsvMsg({ type: 'error', text: 'File too large. Maximum size is 50MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const parsed = parseCostsCSV(ev.target.result);
      if (parsed.errors.length > 0 && parsed.rows.length === 0) {
        setCsvMsg({ type: 'error', text: parsed.errors[0] });
        setTimeout(() => setCsvMsg(null), 6000);
        return;
      }
      setCsvLoading(true);
      try {
        await importData({ costs: parsed.rows }, 'merge');
        const skipped = parsed.errors.length;
        setCsvMsg({
          type: 'success',
          text: `Imported ${parsed.rows.length} cost item${parsed.rows.length !== 1 ? 's' : ''}${skipped ? ` · ${skipped} row${skipped !== 1 ? 's' : ''} skipped` : ''}. Note: re-importing the same file creates duplicates.`,
        });
      } catch (err) {
        setCsvMsg({ type: 'error', text: `Import failed: ${err.message}` });
      }
      setCsvLoading(false);
      setTimeout(() => setCsvMsg(null), 8000);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <span className={styles.sortNeutral}>↕</span>;
    return <span className={styles.sortActive}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className={styles.page}>
      {showIntro && <CostIntroOverlay onDone={() => setShowIntro(false)} />}
      <Header
        title="Cost Manager"
        subtitle="Add, edit and remove all fleet cost items"
        actions={
          <div className={styles.headerActions}>
            <input type="file" accept=".csv" ref={csvFileRef} style={{ display: 'none' }} onChange={handleCsvImport} />
            <Button variant="outline" size="sm" onClick={() => csvFileRef.current?.click()} disabled={csvLoading}>
              <FileUp size={14} /> Import CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportCostsCSV(costs)} disabled={costs.length === 0}>
              <FileDown size={14} /> Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={downloadCostTemplate}>
              <FileText size={14} /> Template
            </Button>
            <Button variant="primary" onClick={openAdd}>
              <Plus size={16} /> Add Cost
            </Button>
          </div>
        }
      />

      <div className={styles.content}>
        {/* Pending invoice captures */}
        <PendingInvoiceBanner onConfirm={addCost} />

        {/* CSV feedback banner */}
        {csvMsg && (
          <div className={`${styles.csvMsg} ${csvMsg.type === 'error' ? styles.csvError : styles.csvSuccess}`}>
            {csvMsg.text}
          </div>
        )}

        {/* Filter + Search bar */}
        <div className={styles.toolbar}>
          <div className={styles.tabs}>
            {FILTER_TABS.map((t) => (
              <button
                key={t.key}
                className={`${styles.tab} ${activeFilter === t.key ? styles.tabActive : ''}`}
                onClick={() => setActiveFilter(t.key)}
              >
                {t.label}
                <span className={styles.tabCount}>
                  {costsLoading && costs.length === 0
                    ? '—'
                    : t.key === 'all'
                      ? costs.length
                      : costs.filter((c) => c.category === t.key).length}
                </span>
              </button>
            ))}
          </div>
          <LocationSelector locations={locations} value={locationFilter} onChange={setLocationFilter} />
          <div className={styles.searchWrap}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.search}
              placeholder="Search costs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Bulk action bar (multi-edit) */}
        {selected.size > 0 && (
          <div className={styles.bulkBar}>
            <span className={styles.bulkCount}>{selected.size} selected</span>
            <select
              className={styles.bulkSelect}
              value=""
              disabled={bulkBusy}
              onChange={(e) => applyBulkCategory(e.target.value)}
              aria-label="Set category for selected costs"
            >
              <option value="">Set category…</option>
              {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORIES[k].label}</option>)}
            </select>
            {locations.length > 0 && (
              <select
                className={styles.bulkSelect}
                value=""
                disabled={bulkBusy}
                onChange={(e) => applyBulkLocation(e.target.value === '__none__' ? '' : e.target.value)}
                aria-label="Set location for selected costs"
              >
                <option value="">Set location…</option>
                <option value="__none__">Fleet-wide</option>
                {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            )}
            <button className={styles.bulkDelete} disabled={bulkBusy} onClick={() => setBulkDeleteOpen(true)}>
              <Trash2 size={14} /> Delete
            </button>
            <button className={styles.bulkClear} disabled={bulkBusy} onClick={clearSelection}>
              <X size={14} /> Clear
            </button>
          </div>
        )}

        {/* Table */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={costs.length === 0 ? 'No costs yet' : 'No results'}
            description={
              costs.length === 0
                ? 'Add your first cost item or import a CSV to start tracking.'
                : 'Try adjusting your search or filter.'
            }
            action={
              costs.length === 0 && (
                <Button variant="primary" onClick={openAdd}>
                  <Plus size={16} /> Add First Cost
                </Button>
              )
            }
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={`${styles.th} ${styles.checkCol}`}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && selectedVisibleCount > 0; }}
                      onChange={toggleAll}
                      aria-label="Select all costs"
                    />
                  </th>
                  <th className={styles.th} onClick={() => toggleSort('name')}>
                    Name <SortIcon field="name" />
                  </th>
                  <th className={styles.th} onClick={() => toggleSort('category')}>
                    Category <SortIcon field="category" />
                  </th>
                  <th className={styles.th}>Frequency</th>
                  <th className={`${styles.th} ${styles.right}`} onClick={() => toggleSort('amount')}>
                    Amount <SortIcon field="amount" />
                  </th>
                  <th className={`${styles.th} ${styles.right}`}>Monthly Equiv.</th>
                  <th className={styles.th}>Start</th>
                  <th className={styles.th}>Status</th>
                  {locations.length > 0 && <th className={styles.th}><MapPin size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Location</th>}
                  <th className={`${styles.th} ${styles.center}`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((cost) => {
                  const status = getCostStatus(cost);
                  return (
                    <tr key={cost.id} className={`${styles.row} ${selected.has(cost.id) ? styles.rowSelected : ''}`}>
                      <td className={`${styles.td} ${styles.checkCol}`}>
                        <input
                          type="checkbox"
                          checked={selected.has(cost.id)}
                          onChange={() => toggleRow(cost.id)}
                          aria-label={`Select ${cost.name}`}
                        />
                      </td>
                      <td className={styles.td}>
                        <div className={styles.costName}>{cost.name}</div>
                        {cost.notes && <div className={styles.costNotes}>{cost.notes}</div>}
                      </td>
                      <td className={styles.td}><CategoryBadge category={cost.category} /></td>
                      <td className={styles.td}>
                        <span className={styles.freq}>{FREQUENCIES[cost.frequency]?.label}</span>
                      </td>
                      <td className={`${styles.td} ${styles.right}`}>
                        <span className={styles.amount}>{formatEUR(cost.amount)}</span>
                      </td>
                      <td className={`${styles.td} ${styles.right}`}>
                        <span className={styles.monthly}>
                          {cost.frequency === 'one-time' ? '—' : formatEUR(normalizeToMonthly(cost))}
                        </span>
                      </td>
                      <td className={styles.td}>
                        <span className={styles.date}>{formatDate(cost.startDate)}</span>
                      </td>
                      <td className={styles.td}>
                        <span className={`${styles.statusBadge} ${styles[`status${status.charAt(0).toUpperCase() + status.slice(1)}`]}`}>
                          <span className={styles.statusDot} />
                          {STATUS_LABELS[status]}
                        </span>
                        {status === 'past' && cost.endDate && (
                          <div className={styles.date} style={{ marginTop: 3 }}>{formatDate(cost.endDate)}</div>
                        )}
                      </td>
                      {locations.length > 0 && (
                        <td className={styles.td}>
                          <span style={{ fontSize: 'var(--text-xs)', color: cost.location ? 'var(--color-primary-light)' : 'var(--color-text-muted)' }}>
                            {cost.location || 'Fleet-wide'}
                          </span>
                        </td>
                      )}
                      <td className={`${styles.td} ${styles.center}`}>
                        <div className={styles.actions}>
                          <button className={styles.actionBtn} onClick={() => openEdit(cost)} title="Edit">
                            <Pencil size={14} />
                          </button>
                          <button
                            className={`${styles.actionBtn} ${styles.deleteBtn}`}
                            onClick={() => setDeleteTarget(cost)}
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={styles.tableFooter}>
          {filtered.length > 0 && (
            <span className={styles.count}>{filtered.length} cost item{filtered.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      <CostFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        initialData={editingCost}
        locations={locations}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => { deleteCost(deleteTarget.id); setDeleteTarget(null); }}
        title="Delete Cost"
        message={`Remove "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
      />

      <ConfirmDialog
        isOpen={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={confirmBulkDelete}
        title="Delete selected costs"
        message={`Delete ${selected.size} selected cost item${selected.size !== 1 ? 's' : ''}? This action cannot be undone.`}
        confirmLabel="Delete"
      />
    </div>
  );
}
