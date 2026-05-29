import { useState } from 'react';

export function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  // BUG #156 — use functional update to avoid stale-closure race on concurrent calls.
  // BUG #157 — don't update state when localStorage.setItem throws (e.g. quota exceeded).
  const setValue = (value) => {
    setStoredValue(prev => {
      const valueToStore = typeof value === 'function' ? value(prev) : value;
      try {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
        return valueToStore; // success — update state
      } catch (e) {
        console.warn('localStorage quota exceeded', e);
        return prev; // failure — don't update state
      }
    });
  };

  return [storedValue, setValue];
}
