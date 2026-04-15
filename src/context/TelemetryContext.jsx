/**
 * TelemetryContext.jsx
 * Manages the `telemetryEvents` Firestore collection.
 *
 * Design: "store raw, derive on demand" (per xslide_analytics_module.md).
 * Events are never pre-aggregated — analyses are computed in-memory by pmeAnalyses.js.
 *
 * Fingerprint-based dedup: each event's docId = `${scooterId}_${timestamp}_${afterState}`
 * so re-uploading the same CSV writes 0 new docs silently.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  collection, onSnapshot, writeBatch, doc, serverTimestamp, getCountFromServer,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { classifyEventType } from '../utils/classifyEventType.js';

const EVENTS_COL = 'telemetryEvents';
const BATCH_SIZE = 450; // safely below Firestore 500-op limit

const TelemetryContext = createContext(null);

export function TelemetryProvider({ children }) {
  const [events, setEvents]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [count, setCount]     = useState(0);  // total doc count (without loading all)

  // Real-time listener — loads all events into memory.
  // For large datasets (40k+ events) consider paginating; for 400-day / 40-scooter
  // history (~50k rows) this is fine on modern hardware.
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, EVENTS_COL),
      (snap) => {
        // Re-classify on load so data ingested under older classifier rules
        // picks up the latest logic (e.g. overturn-vs-trip_end ordering fix)
        // without requiring users to re-upload.
        setEvents(snap.docs.map((d) => {
          const data = d.data();
          return {
            _docId: d.id,
            ...data,
            eventType: classifyEventType(data.beforeState, data.afterState, data.reason),
          };
        }));
        setCount(snap.size);
        setLoading(false);
      },
      (err) => {
        console.error('TelemetryContext snapshot error:', err);
        setLoading(false);
      },
    );
    return unsub;
  }, []);

  /**
   * Idempotent batch import of parsed telemetry events.
   * Uses `batch.set()` (upsert) so duplicate fingerprints just overwrite with identical data.
   *
   * @param {object[]} parsedEvents  - output of parseStatusLogCsv().events
   * @param {function} onProgress    - optional (pct: 0-100) => void callback
   * @returns {{ written: number, duplicates: number }}
   */
  const importEvents = useCallback(async (parsedEvents, onProgress) => {
    if (!parsedEvents.length) return { written: 0, duplicates: 0 };

    // Get current doc IDs to detect duplicates client-side
    const existingIds = new Set(events.map((e) => e._docId));
    const newRows   = parsedEvents.filter((e) => !existingIds.has(e._docId));
    const duplicates = parsedEvents.length - newRows.length;

    let written = 0;
    const total = newRows.length;

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const chunk = newRows.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach((ev) => {
        const { _docId, ...data } = ev;
        const ref = doc(db, EVENTS_COL, _docId);
        batch.set(ref, { ...data, createdAt: serverTimestamp() });
      });
      await batch.commit();
      written += chunk.length;
      if (onProgress) onProgress(Math.round((written / total) * 100));
    }

    return { written, duplicates };
  }, [events]);

  /**
   * Clear all telemetry events (destructive — use only in dev/reset scenarios).
   */
  const clearAllEvents = useCallback(async () => {
    const batch = writeBatch(db);
    events.forEach((ev) => {
      batch.delete(doc(db, EVENTS_COL, ev._docId));
    });
    await batch.commit();
  }, [events]);

  return (
    <TelemetryContext.Provider value={{
      events,
      loading,
      count,
      importEvents,
      clearAllEvents,
      hasData: events.length > 0,
    }}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used inside <TelemetryProvider>');
  return ctx;
}
