import { useEffect, useCallback, useState, useMemo } from 'react';
import { useMap } from 'react-map-gl/mapbox';

/**
 * ConnectionLines — animated SVG lines between city pairs.
 * Listens to map 'move' events so lines stay locked to dots
 * during every pan, zoom, and rotation.
 */
export default function ConnectionLines({ cities }) {
  const { current: map } = useMap();
  const [lines, setLines] = useState([]);
  // BUG #181 — lazy initializer avoids reading window during SSR
  const [size,  setSize]  = useState(() =>
    typeof window !== 'undefined'
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 0, h: 0 }
  );

  // BUG #182 — stable string key so useEffect doesn't re-subscribe on every render
  // BUG #536 — city objects from GreeceMap carry a `.city` property (not `.id`/`.name`)
  const citiesKey = useMemo(
    () => cities?.map((c) => c.city).join(',') ?? '',
    [cities],
  );

  const computeLines = useCallback(() => {
    if (!map) return;
    const canvas = map.getCanvas();
    setSize({ w: canvas.width, h: canvas.height });

    const pairs = [];
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = map.project([cities[i].lng, cities[i].lat]);
        const b = map.project([cities[j].lng, cities[j].lat]);
        pairs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: `${i}-${j}` });
      }
    }
    setLines(pairs);
  }, [map, cities]);

  useEffect(() => {
    if (!map || cities.length < 2) return;

    // Initial render + re-render on every map movement
    map.on('move', computeLines);
    map.on('load', computeLines);
    computeLines(); // fire immediately if map already loaded

    const onResize = () => computeLines();
    window.addEventListener('resize', onResize);

    return () => {
      map.off('move', computeLines);
      map.off('load', computeLines);
      window.removeEventListener('resize', onResize);
    };
  // BUG #182 — depend on citiesKey (stable string) instead of cities (unstable reference)
  }, [map, citiesKey, computeLines]);

  if (!lines.length) return null;

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
        overflow: 'visible',
      }}
      viewBox={`0 0 ${size.w} ${size.h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <style>{`
          @keyframes linePulse {
            0%   { stroke-opacity: 0.12; }
            50%  { stroke-opacity: 0.65; }
            100% { stroke-opacity: 0.12; }
          }
          .war-line {
            stroke: #C97D49;
            stroke-width: 3.5;
            stroke-linecap: round;
            animation: linePulse 3.2s ease-in-out infinite;
          }
        `}</style>
      </defs>
      {lines.map(({ x1, y1, x2, y2, key }, i) => (
        <line
          key={key}
          className="war-line"
          x1={x1} y1={y1}
          x2={x2} y2={y2}
          style={{ animationDelay: `${(i * 0.55).toFixed(2)}s` }}
        />
      ))}
    </svg>
  );
}
