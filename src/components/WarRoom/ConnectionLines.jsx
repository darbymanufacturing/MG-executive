import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-map-gl/mapbox';

/**
 * ConnectionLines — draws animated SVG lines between all active city pairs.
 * Rendered as a position:absolute SVG overlay on top of the Mapbox canvas.
 * Uses map.project() to convert lat/lng → screen pixel coordinates.
 */
export default function ConnectionLines({ cities }) {
  const { current: map } = useMap();
  const [lines, setLines]     = useState([]);
  const rafRef                = useRef(null);

  function computeLines() {
    if (!map) return;
    const pairs = [];
    for (let i = 0; i < cities.length; i++) {
      for (let j = i + 1; j < cities.length; j++) {
        const a = map.project([cities[i].lng, cities[i].lat]);
        const b = map.project([cities[j].lng, cities[j].lat]);
        pairs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: `${i}-${j}` });
      }
    }
    setLines(pairs);
  }

  useEffect(() => {
    if (!map || cities.length < 2) return;
    // Recompute once map is idle and whenever the window resizes
    map.once('idle', computeLines);
    window.addEventListener('resize', computeLines);
    return () => window.removeEventListener('resize', computeLines);
  }, [map, cities]);

  if (!lines.length) return null;

  const canvas = map?.getCanvas();
  const w = canvas?.width  || window.innerWidth;
  const h = canvas?.height || window.innerHeight;

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
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <style>{`
          @keyframes linePulse {
            0%   { stroke-opacity: 0.06; }
            50%  { stroke-opacity: 0.45; }
            100% { stroke-opacity: 0.06; }
          }
          .war-line {
            stroke: #C97D49;
            stroke-width: 1.5;
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
