import { useState, useEffect } from 'react';

// Same-tab broadcast channel: the native 'storage' event only fires in OTHER
// tabs, so two useLocalStorage instances in the SAME tab (e.g. the Settings
// toggle and the App-level gate that reads it) wouldn't otherwise stay in sync.
const SYNC_EVENT = 'omni-localstorage';

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
        // Notify every other useLocalStorage instance in this tab so a write
        // reflects immediately wherever the same key is read (no reload needed).
        window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { key } }));
        return valueToStore; // success — update state
      } catch (e) {
        console.warn('localStorage quota exceeded', e);
        return prev; // failure — don't update state
      }
    });
  };

  // Stay in sync when the same key is written elsewhere — another tab (native
  // 'storage' event) or another in-tab instance (our CustomEvent above).
  useEffect(() => {
    const reread = () => {
      try {
        const item = window.localStorage.getItem(key);
        setStoredValue(item ? JSON.parse(item) : initialValue);
      } catch {
        // ignore malformed JSON / access errors — keep the current value
      }
    };
    const onCustom = (e) => { if (!e.detail || e.detail.key === key) reread(); };
    const onStorage = (e) => { if (e.key === key) reread(); };
    window.addEventListener(SYNC_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
    // `key` is the stable identity; re-subscribing on every new `initialValue`
    // object identity would thrash listeners, so it is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [storedValue, setValue];
}
