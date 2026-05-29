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
import { Inbox, MousePointerClick } from 'lucide-react';
import Skeleton           from '../Shared/Skeleton.jsx';
import EmptyState         from '../Shared/EmptyState.jsx';
import styles from './PmeTabs.module.css';

const TABS = [
  { id: 'ingest',   label: 'Ingest',         icon: '📥' },
  { id: 'fleet',    label: 'Fleet Risk',      icon: '⚡' },
  { id: 'scooter',  label: 'Drilldown',       icon: '🛴' },
  { id: 'reports',  label: 'Reports',         icon: '📊' },
];

function PmeEmptyState({ tab }) {
  return (
    <EmptyState
      icon={Inbox}
      title="No telemetry data loaded yet"
      description={`Go to the Ingest tab and upload a Status Log CSV to unlock ${tab}.`}
    />
  );
}

function PmeLoading() {
  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <Skeleton variant="text" lines={6} height="40px" />
    </div>
  );
}

export default function PmeTabs() {
  const { hasData, loading } = useTelemetry();
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
          loading ? <PmeLoading /> :
          !hasData ? <PmeEmptyState tab="Fleet Risk" /> : (
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
              <EmptyState
                icon={MousePointerClick}
                title="Select a scooter"
                description="Pick a scooter above to see its health report and event timeline."
              />
            )}
          </div>
        )}

        {tab === 'reports' && (
          loading ? <PmeLoading /> :
          !hasData ? <PmeEmptyState tab="Reports" /> : (
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
