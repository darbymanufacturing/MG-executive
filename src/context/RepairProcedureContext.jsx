import { createContext, useContext, useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { safeWrite } from '../utils/firestoreWrite.js';

const RepairProcedureContext = createContext(null);

const COL = 'repairProcedures';

export function RepairProcedureProvider({ children }) {
  const [procedures, setProcedures] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, COL), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setProcedures(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  const addProcedure = async (data) => {
    await safeWrite(
      () => addDoc(collection(db, COL), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
      { rethrow: true, errorMessage: 'Failed to save repair procedure' },
    );
  };

  const updateProcedure = async (id, data) => {
    await safeWrite(
      () => updateDoc(doc(db, COL, id), { ...data, updatedAt: serverTimestamp() }),
      { rethrow: true, errorMessage: 'Failed to update repair procedure' },
    );
  };

  const deleteProcedure = async (id) => {
    await safeWrite(
      () => deleteDoc(doc(db, COL, id)),
      { rethrow: true, errorMessage: 'Failed to delete repair procedure' },
    );
  };

  return (
    <RepairProcedureContext.Provider value={{ procedures, loading, addProcedure, updateProcedure, deleteProcedure }}>
      {children}
    </RepairProcedureContext.Provider>
  );
}

export function useRepairProcedures() {
  return useContext(RepairProcedureContext);
}
