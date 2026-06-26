import { useState, useMemo } from 'react';
import { MapPin, Activity, Cloud, BarChart2, Clock, Trash2, Database } from 'lucide-react';
import Header from '../components/Layout/Header.jsx';
import Button from '../components/Shared/Button.jsx';
import ZoneManager from '../components/Spr/ZoneManager.jsx';
import EventImportPanel from '../components/Spr/EventImportPanel.jsx';
import WeatherPanel from '../components/Spr/WeatherPanel.jsx';
import SpotPerformanceTable from '../components/Spr/SpotPerformanceTable.jsx';
import ConfirmDialog from '../components/Shared/ConfirmDialog.jsx';
import { useSpr } from '../context/SprContext.jsx';
import { useCosts } from '../context/CostContext.jsx';
import { getEventDates, getScooterIds } from '../utils/sprCalculations.js';
import styles from './Spr.module.css';

const TABS = [
  { key: 'performance', label: 'Performance', icon: BarChart2 },
  { key: 'zones',       label: 'Zones',       icon: MapPin },
  { key: 'events',      label: 'Events',      icon: Activity },
  { key: 'weather',     label: 'Weather',     icon: Cloud },
];

export default function Spr() {
  const { events, weather, sprConfig, clearEvents, loadNafplioData } = useSpr();
  const { config } = useCosts();

  const [tab,           setTab]           = useState('performance');
  const [city,          setCity]          = useState('');
  const [clearConfirm,  setClearConfirm]  = useState(false);
  const [seedLoading,   setSeedLoading]   = useState(false);
  const [seedDone,      setSeedDone]      = useState(false);

  const locations = config.locations || [];

  // Stats
  const cityEvents  = useMemo(() => events.filter((e) => !city || e.city === city), [events, city]);
  const _cityWeather = useMemo(() => weather.filter((w) => !city || w.city === city), [weather, city]);
  const eventDates  = useMemo(() => getEventDates(cityEvents), [cityEvents]);
  const scooterIds  = useMemo(() => getScooterIds(cityEvents), [cityEvents]);
  const cityZones   = useMemo(() => (sprConfig.zones || []).filter((z) => !city || z.city === city), [sprConfig.zones, city]);

  return (
    <div className={styles.page}>
      <Header
        title="SPR"
        subtitle="Spot Performance &amp; Rebalancing"
        actions={
          <div className={styles.headerControls}>
            {locations.length > 0 && (
              <>
                <span className={styles.cityLabel}>City:</span>
                <select
                  className={styles.citySelect}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                >
                  <option value="">All cities</option>
                  {locations.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        }
      />

      <div className={styles.content}>

        {/* Seed data banner — shown only when no events loaded yet */}
        {events.length === 0 && (
          <div className={styles.seedBanner}>
            <Database size={16} />
            <span>No event data yet. Load the Nafplio sample dataset to get started.</span>
            <Button
              variant="primary"
              size="sm"
              disabled={seedLoading}
              onClick={async () => {
                setSeedLoading(true);
                try {
                  await loadNafplioData();
                  setSeedDone(true);
                } catch (e) {
                  console.error('Failed to load Nafplio data:', e);
                } finally {
                  setSeedLoading(false);
                }
              }}
            >
              {seedLoading ? 'Loading…' : seedDone ? 'Loaded ✓' : 'Load Nafplio Data'}
            </Button>
          </div>
        )}

        {/* Tab bar */}
        <div className={styles.tabs}>
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
              onClick={() => setTab(key)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* ── Performance tab ── */}
        {tab === 'performance' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <BarChart2 size={20} className={styles.sectionIcon} />
              <div>
                <h2 className={styles.sectionTitle}>Spot Performance</h2>
                <p className={styles.sectionSub}>
                  Morning stock · ride volume · return volume · zone flow per zone per day
                </p>
              </div>
            </div>
            <SpotPerformanceTable city={city} />
          </div>
        )}

        {/* ── Zones tab ── */}
        {tab === 'zones' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <MapPin size={20} className={styles.sectionIcon} />
              <div>
                <h2 className={styles.sectionTitle}>Zone Management</h2>
                <p className={styles.sectionSub}>
                  Define GPS bounding boxes for each zone inside a city. Also set the city center for weather auto-fetch.
                </p>
              </div>
            </div>

            {/* Quick stats */}
            {cityZones.length > 0 && (
              <div className={styles.statsRow}>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Zones defined</span>
                  <span className={styles.statValue}>{cityZones.length}</span>
                </div>
                {city && sprConfig.cityCenters?.[city] && (
                  <div className={styles.statCard}>
                    <span className={styles.statLabel}>City center</span>
                    <span className={styles.statValue} style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace' }}>
                      {sprConfig.cityCenters[city].lat}, {sprConfig.cityCenters[city].lon}
                    </span>
                  </div>
                )}
              </div>
            )}

            <ZoneManager city={city} />
          </div>
        )}

        {/* ── Events tab ── */}
        {tab === 'events' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <Activity size={20} className={styles.sectionIcon} />
              <div>
                <h2 className={styles.sectionTitle}>Event Log</h2>
                <p className={styles.sectionSub}>
                  Import Raw_Rebalance CSV exports. Events are de-duplicated by scooter ID + datetime on re-import.
                </p>
              </div>
            </div>

            {/* Stats */}
            {cityEvents.length > 0 && (
              <div className={styles.statsRow}>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Total Events</span>
                  <span className={styles.statValue}>{cityEvents.length.toLocaleString()}</span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Scooters</span>
                  <span className={styles.statValue}>{scooterIds.length}</span>
                </div>
                <div className={styles.statCard}>
                  <span className={styles.statLabel}>Days of data</span>
                  <span className={styles.statValue}>{eventDates.length}</span>
                </div>
                {eventDates.length > 0 && (
                  <div className={styles.statCard}>
                    <span className={styles.statLabel}>Date range</span>
                    <span className={styles.statValue} style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace' }}>
                      {eventDates[eventDates.length - 1]} → {eventDates[0]}
                    </span>
                  </div>
                )}
              </div>
            )}

            <EventImportPanel city={city} />

            {cityEvents.length > 0 && (
              <div className={styles.clearRow}>
                <Button variant="danger" size="sm" onClick={() => setClearConfirm(true)}>
                  <Trash2 size={13} /> Clear Events{city ? ` — ${city}` : ''}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Weather tab ── */}
        {tab === 'weather' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <Cloud size={20} className={styles.sectionIcon} />
              <div>
                <h2 className={styles.sectionTitle}>Weather</h2>
                <p className={styles.sectionSub}>
                  Auto-fetch from Open-Meteo. Rainy days are flagged and optionally excluded from performance stats.
                </p>
              </div>
            </div>
            <WeatherPanel city={city} />
          </div>
        )}

        {/* Coming soon */}
        <div className={styles.comingSoon}>
          <p className={styles.comingSoonTitle}>
            <Clock size={14} />
            Coming in next SPR builds
          </p>
          <ul className={styles.comingSoonList}>
            <li>Daily Rebalance Dashboard — single-day operator view with all pickups/drops</li>
            <li>Weekly weekday-average summary per zone</li>
            <li>Per-scooter daily state timeline</li>
            <li>Availability events breakdown (battery, maintenance, missing)</li>
            <li>Visual zone editor on an interactive map</li>
            <li>Compliance KPIs — violation rate, response time, density score, demand heatmap</li>
          </ul>
        </div>
      </div>

      <ConfirmDialog
        isOpen={clearConfirm}
        onClose={() => setClearConfirm(false)}
        onConfirm={() => { clearEvents(city || null); setClearConfirm(false); }}
        title="Clear Event Data"
        message={`Permanently delete all SPR events${city ? ` for ${city}` : ''}? This cannot be undone.`}
        confirmLabel="Clear Events"
      />
    </div>
  );
}
