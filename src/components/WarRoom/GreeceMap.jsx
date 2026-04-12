import Map, { Marker } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { getCityCoords } from '../../utils/cityCoords.js';
import CityNode from './CityNode.jsx';
import ConnectionLines from './ConnectionLines.jsx';
import styles from './GreeceMap.module.css';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

const INITIAL_VIEW = {
  longitude: 23.2,
  latitude:  38.3,
  zoom:      7.2,
};

/**
 * GreeceMap — full-size Mapbox dark-v11 map centred on Greece.
 * Renders city markers + animated connection lines for active locations.
 *
 * @param {Array} cityData — [{ city, revenue, trips, activeScooters, revenuePerScooter }]
 */
export default function GreeceMap({ cityData = [] }) {
  // Resolve each city to lat/lng, drop any without known coordinates
  const activeCities = cityData
    .map((d, i) => {
      const coords = getCityCoords(d.city);
      if (!coords) {
        console.warn(`War Room: no coordinates found for city "${d.city}" — skipping marker`);
        return null;
      }
      return { ...d, ...coords, index: i };
    })
    .filter(Boolean);

  if (!TOKEN) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12, color: '#C97D49',
      }}>
        <span style={{ fontSize: 36 }}>🗺️</span>
        <p style={{ fontSize: 14, opacity: 0.7, textAlign: 'center', maxWidth: 320 }}>
          Mapbox token not configured.<br />
          Add <code style={{ background: 'rgba(160,82,29,0.15)', padding: '2px 6px', borderRadius: 4 }}>
            VITE_MAPBOX_TOKEN=pk.xxx
          </code> to your <code>.env</code> file and restart the dev server.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.mapWrap}>
      <Map
        mapboxAccessToken={TOKEN}
        initialViewState={INITIAL_VIEW}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        id="warRoomMap"
        attributionControl={true}
        scrollZoom={true}
        dragPan={true}
        doubleClickZoom={true}
        touchZoomRotate={true}
      >
        {/* Animated connection lines between all active city pairs */}
        {activeCities.length >= 2 && (
          <ConnectionLines cities={activeCities} />
        )}

        {/* City markers */}
        {activeCities.map((city) => (
          <Marker
            key={city.city}
            longitude={city.lng}
            latitude={city.lat}
            anchor="bottom"
          >
            <CityNode data={city} index={city.index} />
          </Marker>
        ))}
      </Map>
    </div>
  );
}
