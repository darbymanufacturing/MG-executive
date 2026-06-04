import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Layers, Plus, Trash2, Settings2, Building2 } from 'lucide-react';
import { useFleet } from '../../context/FleetContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import Modal from '../Shared/Modal.jsx';
import styles from './FleetSwitcher.module.css';

/* FF-3 — the header fleet switcher: pick a fleet or "All Fleets"; manage fleets. */
export default function FleetSwitcher() {
  const { fleets, activeFleet, isAllFleets, hasFleets, setActiveFleet, ALL_FLEETS } = useFleet();
  const [open, setOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // #584 — always show 'All Fleets' when isAllFleets; the prior hasFleets gate caused a flicker
  //        from 'Fleets' → 'All Fleets' while the Supabase fetch was still in flight.
  const label = isAllFleets ? 'All Fleets' : (activeFleet?.name ?? 'Fleets');

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        title="Switch fleet"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {isAllFleets ? <Building2 size={15} className={styles.triggerIcon} /> : <Layers size={15} className={styles.triggerIcon} />}
        <span className={styles.triggerLabel}>{label}</span>
        <ChevronDown size={14} className={styles.chev} />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <button
            className={`${styles.item} ${isAllFleets ? styles.itemActive : ''}`}
            onClick={() => { setActiveFleet(ALL_FLEETS); setOpen(false); }}
            role="menuitem"
          >
            <Building2 size={14} />
            <span className={styles.itemLabel}>All Fleets</span>
            {isAllFleets && <Check size={14} className={styles.itemCheck} />}
          </button>

          {fleets.length > 0 && <div className={styles.sep} />}
          {fleets.map((f) => {
            const on = activeFleet?._docId === f._docId;
            return (
              <button
                key={f._docId}
                className={`${styles.item} ${on ? styles.itemActive : ''}`}
                onClick={() => { setActiveFleet(f._docId); setOpen(false); }}
                role="menuitem"
              >
                <Layers size={14} />
                <span className={styles.itemLabel}>
                  {f.name}
                  {f.cities?.length ? <span className={styles.itemSub}>{f.cities.join(', ')}</span> : null}
                </span>
                {on && <Check size={14} className={styles.itemCheck} />}
              </button>
            );
          })}

          <div className={styles.sep} />
          <button className={styles.manage} onClick={() => { setManageOpen(true); setOpen(false); }} role="menuitem">
            <Settings2 size={14} /> Manage fleets…
          </button>
        </div>
      )}

      {manageOpen && <FleetManageModal onClose={() => setManageOpen(false)} />}
    </div>
  );
}

function FleetManageModal({ onClose }) {
  const { fleets, addFleet, deleteFleet } = useFleet();
  const { config, updateConfig } = useCosts();
  const { success, error } = useToast();
  const locations = config?.locations ?? [];

  const [name, setName] = useState('');
  const [selCities, setSelCities] = useState([]);
  const [busy, setBusy] = useState(false);

  const coveredCities = useMemo(
    () => new Set(fleets.flatMap((f) => (f.cities ?? []).map((c) => String(c).toLowerCase()))),
    [fleets],
  );

  function toggleCity(c) {
    setSelCities((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function handleAdd() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const newFleet = { name: name.trim(), cities: selCities };
      await addFleet(newFleet);
      // #561 — keep config.locations in sync when a fleet is created with cities
      if (selCities.length) {
        updateConfig({ locations: [...new Set([...(config?.locations ?? []), ...selCities])] });
      }
      success(`Fleet "${name.trim()}" created.`);
      setName('');
      setSelCities([]);
    } catch (e) { error(e.message || 'Could not create the fleet.'); } finally { setBusy(false); }
  }

  async function handleCreateFromCities() {
    // #566 — deduplicate the city list: trim + case-insensitive uniqueness before filtering
    const seenKeys = new Set();
    const dedupedLocations = locations.reduce((acc, c) => {
      const key = String(c).trim().toLowerCase();
      if (key && !seenKeys.has(key)) { seenKeys.add(key); acc.push(String(c).trim()); }
      return acc;
    }, []);
    const missing = dedupedLocations.filter((c) => !coveredCities.has(String(c).toLowerCase()));
    if (!missing.length) { success('Every city already has a fleet.'); return; }
    setBusy(true);
    try {
      for (const c of missing) await addFleet({ name: c, cities: [c] }); // eslint-disable-line no-await-in-loop
      success(`Created ${missing.length} fleet${missing.length > 1 ? 's' : ''} from your cities.`);
    } catch (e) { error(e.message || 'Could not create fleets.'); } finally { setBusy(false); }
  }

  async function handleDelete(f) {
    setBusy(true);
    try { await deleteFleet(f._docId); success('Fleet removed.'); }
    catch (e) { error(e.message || 'Could not remove the fleet.'); } finally { setBusy(false); }
  }

  // #537 — use Shared <Modal> to inherit scroll-lock, inert, focus-trap, and ESC
  return (
    <Modal isOpen onClose={onClose} title="Manage fleets" width={520}>
      <p className={styles.modalDesc}>
        A fleet is usually one city. Operational screens (Scooters, Maintenance, Revenue) can then be
        viewed per fleet or rolled up across all of them.
      </p>

      {fleets.length > 0 ? (
        <div className={styles.fleetList}>
          {fleets.map((f) => (
            <div key={f._docId} className={styles.fleetRow}>
              <div className={styles.fleetInfo}>
                <span className={styles.fleetName}>{f.name}</span>
                <span className={styles.fleetCities}>{f.cities?.length ? f.cities.join(', ') : 'no cities set'}</span>
              </div>
              <button className={styles.delBtn} onClick={() => handleDelete(f)} disabled={busy} aria-label={`Delete ${f.name}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyFleets}>No fleets yet — add one below, or generate from your cities.</div>
      )}

      {locations.length > 0 && (
        <button className={styles.fromCities} onClick={handleCreateFromCities} disabled={busy}>
          <Plus size={14} /> Create a fleet for each of my cities ({locations.join(', ')})
        </button>
      )}

      <div className={styles.addForm}>
        <div className={styles.addRow}>
          <input
            className={styles.input}
            placeholder="Fleet name (e.g. Corinth)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <button className={styles.addBtn} onClick={handleAdd} disabled={busy || !name.trim()}>
            <Plus size={14} /> Add
          </button>
        </div>
        {locations.length > 0 && (
          <div className={styles.cityPick}>
            <span className={styles.cityPickLabel}>Cities:</span>
            {locations.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.cityChip} ${selCities.includes(c) ? styles.cityChipOn : ''}`}
                onClick={() => toggleCity(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
