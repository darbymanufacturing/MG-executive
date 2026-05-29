import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const RepairSessionContext = createContext(null);

export function RepairSessionProvider({ children }) {
  const [sessions,      setSessions]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [snapshotError, setSnapshotError] = useState(null);

  useEffect(() => {
    const q = query(
      collection(db, 'repairSessions'),
      orderBy('completedAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        console.error('[RepairSessionContext] snapshot error:', err);
        setSnapshotError(err.message);
      },
    );
    return unsub;
  }, []);

  const value = useMemo(() => ({ sessions, loading, snapshotError }), [sessions, loading, snapshotError]);

  return (
    <RepairSessionContext.Provider value={value}>
      {children}
    </RepairSessionContext.Provider>
  );
}

export function useRepairSessions() {
  return useContext(RepairSessionContext);
}
