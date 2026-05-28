import { useState } from 'react';
import { MapPin, Plus, Trash2, Navigation, Pencil, X, Check } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { useSpr } from '../../context/SprContext.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import styles from './ZoneManager.module.css';

const EMPTY_FORM = { name: '', minLat: '', maxLat: '', minLon: '', maxLon: '' };

export default function ZoneManager({ city }) {
  const { sprConfig, addZone, updateZone, deleteZone, setCityCenter } = useSpr();
  const { config } = useCosts();

  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [editingId, setEditingId]   = useState(null);
  const [centerLat, setCenterLat]   = useState('');
  const [centerLon, setCenterLon]   = useState('');
  const [saving, setSaving]         = useState(false);
  const [coordError, setCoordError] = useState('');

  const locations = config.locations || [];
  const zones = (sprConfig.zones || []).filter((z) => !city || z.city === city);
  const center = city ? sprConfig.cityCenters?.[city] : null;

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setCoordError('');
  }

  function startEdit(zone) {
    setForm({
      name:   zone.name,
      minLat: String(zone.minLat),
      maxLat: String(zone.maxLat),
      minLon: String(zone.minLon),
      maxLon: String(zone.maxLon),
    });
    setEditingId(zone.id);
    setShowForm(true);
  }

  function parseCoord(val) {
    // Normalize European decimal commas (#246)
    const n = parseFloat(String(val).replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  function isFormValid() {
    const minLat = parseCoord(form.minLat);
    const maxLat = parseCoord(form.maxLat);
    const minLon = parseCoord(form.minLon);
    const maxLon = parseCoord(form.maxLon);
    return (
      form.name.trim() &&
      minLat !== null &&
      maxLat !== null &&
      minLon !== null &&
      maxLon !== null
    );
  }

  async function handleSave() {
    if (!isFormValid() || !city) return;
    const minLat = parseCoord(form.minLat);
    const maxLat = parseCoord(form.maxLat);
    const minLon = parseCoord(form.minLon);
    const maxLon = parseCoord(form.maxLon);
    // Validate coordinate ordering (#245)
    if (minLat >= maxLat) { setCoordError('Min lat must be less than Max lat'); return; }
    if (minLon >= maxLon) { setCoordError('Min lon must be less than Max lon'); return; }
    setCoordError('');
    setSaving(true);
    const zoneData = {
      name:   form.name.trim(),
      city,
      minLat,
      maxLat,
      minLon,
      maxLon,
    };
    try {
      if (editingId) {
        await updateZone(editingId, zoneData);
      } else {
        await addZone(zoneData);
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleSetCenter() {
    const lat = parseFloat(centerLat);
    const lon = parseFloat(centerLon);
    if (isNaN(lat) || isNaN(lon) || !city) return;
    await setCityCenter(city, lat, lon);
    setCenterLat('');
    setCenterLon('');
  }

  return (
    <div className={styles.section}>

      {/* Zone list */}
      {zones.length === 0 ? (
        <p className={styles.empty}>
          {city ? `No zones defined for ${city} yet.` : 'Select a city to manage its zones.'}
        </p>
      ) : (
        <ul className={styles.zoneList}>
          {zones.map((z) => (
            <li key={z.id} className={styles.zonePill}>
              <div className={styles.zoneInfo}>
                <span className={styles.zoneName}>
                  <MapPin size={12} style={{ marginRight: 4, verticalAlign: 'middle', color: 'var(--color-primary-light)' }} />
                  {z.name}
                </span>
                <span className={styles.zoneCoords}>
                  lat [{z.minLat}, {z.maxLat}] · lon [{z.minLon}, {z.maxLon}]
                </span>
              </div>
              <div className={styles.zoneActions}>
                <button className={styles.iconBtn} onClick={() => startEdit(z)} title="Edit">
                  <Pencil size={13} />
                </button>
                <button
                  className={`${styles.iconBtn} ${styles.deleteBtn}`}
                  onClick={() => deleteZone(z.id)}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add/Edit form */}
      {city && (showForm ? (
        <div className={styles.addForm}>
          <span className={styles.formTitle}>
            <MapPin size={14} />
            {editingId ? 'Edit Zone' : `Add Zone — ${city}`}
          </span>
          <div className={styles.formGrid}>
            <div className={`${styles.formField} ${styles.formFieldFull}`}>
              <label className={styles.fieldLabel}>Zone Name</label>
              <input
                className={styles.input}
                placeholder="e.g. Kentro Plateia"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>Min Lat</label>
              <input className={styles.input} placeholder="37.5720" type="number" step="0.0001"
                value={form.minLat} onChange={(e) => setForm((f) => ({ ...f, minLat: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>Max Lat</label>
              <input className={styles.input} placeholder="37.5760" type="number" step="0.0001"
                value={form.maxLat} onChange={(e) => setForm((f) => ({ ...f, maxLat: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>Min Lon</label>
              <input className={styles.input} placeholder="22.7960" type="number" step="0.0001"
                value={form.minLon} onChange={(e) => setForm((f) => ({ ...f, minLon: e.target.value }))} />
            </div>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>Max Lon</label>
              <input className={styles.input} placeholder="22.8020" type="number" step="0.0001"
                value={form.maxLon} onChange={(e) => setForm((f) => ({ ...f, maxLon: e.target.value }))} />
            </div>
          </div>
          {coordError && <p style={{ color: 'var(--status-red)', fontSize: 12, margin: '4px 0' }}>{coordError}</p>}
          <div className={styles.formActions}>
            <Button variant="secondary" size="sm" onClick={resetForm}>
              <X size={13} /> Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={!isFormValid() || saving}>
              <Check size={13} /> {saving ? 'Saving…' : editingId ? 'Update Zone' : 'Add Zone'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} /> Add Zone
        </Button>
      ))}

      {/* City center (for weather auto-fetch) */}
      {city && (
        <div className={styles.cityCenter}>
          <span className={styles.cityCenterTitle}>
            <Navigation size={14} />
            City Center Coordinates
          </span>
          <p className={styles.cityCenterDesc}>
            Used to auto-fetch weather from Open-Meteo. Set once per city.
          </p>
          {center && (
            <span className={styles.cityCenterCurrent}>
              Current: lat {center.lat}, lon {center.lon}
            </span>
          )}
          <div className={styles.cityCenterRow}>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>Latitude</label>
              <input className={styles.input} placeholder="37.5747" type="number" step="0.0001"
                value={centerLat} onChange={(e) => setCenterLat(e.target.value)} style={{ width: 120 }} />
            </div>
            <div className={styles.formField}>
              <label className={styles.fieldLabel}>Longitude</label>
              <input className={styles.input} placeholder="22.8000" type="number" step="0.0001"
                value={centerLon} onChange={(e) => setCenterLon(e.target.value)} style={{ width: 120 }} />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSetCenter}
              disabled={!centerLat || !centerLon}
            >
              <Check size={13} /> Set Center
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
