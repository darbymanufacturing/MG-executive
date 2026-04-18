import { createContext, useContext, useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const RepairSessionContext = createContext(null);

export function RepairSessionProvider({ children }) {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'repairSessions'),
      orderBy('completedAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  return (
    <RepairSessionContext.Provider value={{ sessions, loading }}>
      {children}
    </RepairSessionContext.Provider>
  );
}

export function useRepairSessions() {
  return useContext(RepairSessionContext);
}
