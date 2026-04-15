import { useState } from 'react';
import { useTelemetry } from '../../context/TelemetryContext.jsx';
import StatusLogImporter  from './ingest/StatusLogImporter.jsx';
import RepairLogImporter  from './ingest/RepairLogImporter.jsx';
import DataLoadedSummary  from './ingest/DataLoadedSummary.jsx';
import FleetKpiStrip      from './fleet/FleetKpiStrip.jsx';
import FleetRiskTable     from './fleet/FleetRiskTable.jsx';
import OutlierCallouts    from './fleet/OutlierCallouts.jsx';
import ScooterPicker      from './scooter/ScooterPicker.jsx';
import ScooterHealthCard  from './scooter/ScooterHealthCard.jsx';
import ScooterLifetimeStats  from './scooter/ScooterLifetimeStats.jsx';
import ScooterEventTimeline  from './scooter/ScooterEventTimeline.jsx';
import AnomalyFlags       from './scooter/AnomalyFlags.jsx';
import WeeklyDigest       from './reports/WeeklyDigest.jsx';
import MonthlyOverview    from './reports/MonthlyOverview.jsx';
import styles from './PmeTabs.module.css';

const TABS = [
  { id: 'ingest',   label: 'Ingest',         icon: '📥' },
  { id: 'fleet',    label: 'Fleet Risk',      icon: '⚡' },
  { id: 'scooter',  label: 'Drilldown',       icon: '🛴' },
  { id: 'reports',  label: 'Reports',         icon: '📊' },
];

function EmptyState({ tab }) {
  return (
    <div className={styles.emptyState}>
      <span className={styles.emptyIcon}>📥</span>
      <p>No telemetry data loaded yet.</p>
      <p>Go to the <strong>Ingest</strong> tab and upload a Status Log CSV to unlock {tab}.</p>
    </div>
  );
}

export default function PmeTabs() {
  const { hasData } = useTelemetry();
  const [tab, setTab]       = useState('ingest');
  const [scooterId, setScooterId] = useState(null);

  function selectScooterAndNavigate(id) {
    setScooterId(id);
    setTab('scooter');
  }

  return (
    <div className={styles.pme}>
      {/* Tab bar */}
      <div className={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className={styles.tabIcon}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={styles.tabContent}>

        {tab === 'ingest' && (
          <div className={styles.ingestGrid}>
            <StatusLogImporter />
            <hr className={styles.divider} />
            <RepairLogImporter />
            <hr className={styles.divider} />
            <DataLoadedSummary />
          </div>
        )}

        {tab === 'fleet' && (
          !hasData ? <EmptyState tab="Fleet Risk" /> : (
            <div className={styles.fleetLayout}>
              <FleetKpiStrip />
              <FleetRiskTable onSelectScooter={selectScooterAndNavigate} />
              <OutlierCallouts onSelectScooter={selectScooterAndNavigate} />
            </div>
          )
        )}

        {tab === 'scooter' && (
          <div className={styles.drilldownLayout}>
            <ScooterPicker value={scooterId} onChange={setScooterId} />
            {scooterId ? (
              <div className={styles.drilldownGrid}>
                <div className={styles.drilldownLeft}>
                  <ScooterHealthCard scooterId={scooterId} />
                  <AnomalyFlags scooterId={scooterId} />
                  <ScooterLifetimeStats scooterId={scooterId} />
                </div>
                <div className={styles.drilldownRight}>
                  <ScooterEventTimeline scooterId={scooterId} />
                </div>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>🛴</span>
                <p>Select a scooter above to see its health report and event timeline.</p>
              </div>
            )}
          </div>
        )}

        {tab === 'reports' && (
          !hasData ? <EmptyState tab="Reports" /> : (
            <div className={styles.reportsLayout}>
              <WeeklyDigest />
              <hr className={styles.divider} />
              <MonthlyOverview />
            </div>
          )
        )}

      </div>
    </div>
  );
}
