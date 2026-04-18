import { createContext, useContext, useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

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
    await addDoc(collection(db, COL), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  };

  const updateProcedure = async (id, data) => {
    await updateDoc(doc(db, COL, id), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  };

  const deleteProcedure = async (id) => {
    await deleteDoc(doc(db, COL, id));
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
