/**
 * tabRegistry.js
 * Maps tab ID → { component, label, icon }
 *
 * Adding a new tab: add one entry here + one component in ./tabs/.
 * The ScooterConfigContext drives which tabs are shown and their order.
 */

import { lazy } from 'react';
import { Info, MapPin, Activity, Wrench, TrendingUp, BarChart2 } from 'lucide-react';

// Lazy-load tab components to keep initial bundle small
const DetailsTab  = lazy(() => import('./tabs/DetailsTab.jsx'));
const TripsTab    = lazy(() => import('./tabs/TripsTab.jsx'));
const EventsTab   = lazy(() => import('./tabs/EventsTab.jsx'));
const RepairsTab  = lazy(() => import('./tabs/RepairsTab.jsx'));
const FinanceTab  = lazy(() => import('./tabs/FinanceTab.jsx'));
const AnalyticsTab = lazy(() => import('./tabs/AnalyticsTab.jsx'));

export const TAB_REGISTRY = {
  details:   { component: DetailsTab,   label: 'Details',   icon: Info },
  trips:     { component: TripsTab,     label: 'Trips',     icon: MapPin },
  events:    { component: EventsTab,    label: 'Events',    icon: Activity },
  repairs:   { component: RepairsTab,   label: 'Repairs',   icon: Wrench },
  finance:   { component: FinanceTab,   label: 'Finance',   icon: TrendingUp },
  analytics: { component: AnalyticsTab, label: 'Analytics', icon: BarChart2 },
};
