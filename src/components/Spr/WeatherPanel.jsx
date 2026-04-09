import { useState } from 'react';
import { Cloud, RefreshCw, Check, CloudRain, Sun } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { useSpr } from '../../context/SprContext.jsx';
import { fetchHistoricalWeather, weatherCodeLabel } from '../../utils/openMeteo.js';
import styles from './WeatherPanel.module.css';

export default function WeatherPanel({ city }) {
  const { sprConfig, weather, importWeather, clearWeather } = useSpr();

  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [preview,   setPreview]   = useState(null);
  const [fetching,  setFetching]  = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [status,    setStatus]    = useState(null);

  const center = city ? sprConfig.cityCenters?.[city] : null;
  const existingWeather = weather.filter((w) => !city || w.city === city)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const rainyCount = existingWeather.filter((w) => w.isRainy).length;
  const clearCount = existingWeather.length - rainyCount;

  async function handleFetch() {
    if (!center || !startDate || !endDate) return;
    setFetching(true);
    setStatus(null);
    try {
      const days = await fetchHistoricalWeather({
        lat: center.lat,
        lon: center.lon,
        startDate,
        endDate,
      });
      setPreview(days);
    } catch (err) {
      setStatus({ type: 'error', text: `Fetch failed: ${err.message}` });
    }
    setFetching(false);
  }

  async function handleSave() {
    if (!preview?.length || !city) return;
    setSaving(true);
    try {
      await importWeather(preview, city);
      setStatus({
        type: 'success',
        text: `✓ Saved ${preview.length} days of weather for ${city}.`,
      });
      setPreview(null);
      setStartDate('');
      setEndDate('');
    } catch (err) {
      setStatus({ type: 'error', text: `Save failed: ${err.message}` });
    }
    setSaving(false);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <Cloud size={16} className={styles.icon} />
        <span className={styles.panelTitle}>Weather Data — {city || 'Select a city'}</span>
      </div>
      <p className={styles.desc}>
        Fetch historical weather from Open-Meteo (free, no API key). Days with ≥1 mm rain are flagged
        and excluded from performance stats when the rain filter is on.
      </p>

      {!center && city && (
        <div className={styles.noCenter}>
          No city center set for <strong>{city}</strong>. Go to the Zones tab and set the city center coordinates first.
        </div>
      )}

      {center && (
        <div className={styles.fetchForm}>
          <div className={styles.formField}>
            <label className={styles.fieldLabel}>From</label>
            <input
              type="date"
              className={styles.input}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.fieldLabel}>To</label>
            <input
              type="date"
              className={styles.input}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFetch}
            disabled={!startDate || !endDate || fetching}
          >
            {fetching
              ? <><RefreshCw size={13} className={styles.spin} /> Fetching…</>
              : <><Cloud size={13} /> Fetch Weather</>}
          </Button>
        </div>
      )}

      {/* Preview fetched data */}
      {preview && (
        <>
          <div className={styles.previewWrap}>
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Condition</th>
                  <th className={styles.right}>Rain (mm)</th>
                  <th className={styles.right}>Temp (°C)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{weatherCodeLabel(d.weatherCode)}</td>
                    <td className={styles.right}>{d.totalRainMm}</td>
                    <td className={styles.right}>{d.temperature ?? '—'}</td>
                    <td>
                      {d.isRainy
                        ? <span className={styles.rainyBadge}><CloudRain size={11} /> Rainy</span>
                        : <span className={styles.clearBadge}><Sun size={11} /> Clear</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={() => setPreview(null)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !city}>
              {saving
                ? <><RefreshCw size={13} className={styles.spin} /> Saving…</>
                : <><Check size={13} /> Save {preview.length} Days</>}
            </Button>
          </div>
        </>
      )}

      {/* Existing weather summary */}
      {existingWeather.length > 0 && !preview && (
        <>
          <div className={styles.summary}>
            <span className={styles.summaryItem}><strong>{existingWeather.length}</strong> days stored</span>
            <span className={styles.summaryItem}><strong>{clearCount}</strong> clear</span>
            <span className={styles.summaryItem}><strong>{rainyCount}</strong> rainy</span>
            <span className={styles.summaryItem}>
              <strong>{existingWeather[existingWeather.length - 1]?.date}</strong> → <strong>{existingWeather[0]?.date}</strong>
            </span>
          </div>
          <div className={styles.previewWrap}>
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Condition</th>
                  <th className={styles.right}>Rain (mm)</th>
                  <th className={styles.right}>Temp (°C)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {existingWeather.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <td>{weatherCodeLabel(d.weatherCode)}</td>
                    <td className={styles.right}>{d.totalRainMm}</td>
                    <td className={styles.right}>{d.temperature ?? '—'}</td>
                    <td>
                      {d.isRainy
                        ? <span className={styles.rainyBadge}><CloudRain size={11} /> Rainy</span>
                        : <span className={styles.clearBadge}><Sun size={11} /> Clear</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="danger"
              size="sm"
              onClick={() => { if (confirm(`Clear all weather data for ${city}?`)) clearWeather(city); }}
            >
              Clear Weather Data
            </Button>
          </div>
        </>
      )}

      {status && (
        <div className={`${styles.statusMsg} ${status.type === 'error' ? styles.statusError : styles.statusSuccess}`}>
          {status.text}
        </div>
      )}
    </div>
  );
}
