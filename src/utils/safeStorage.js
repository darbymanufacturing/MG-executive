// BUG #158 — safe localStorage wrapper that never throws (Safari Private Mode,
// quota exceeded, serialisation errors all handled gracefully).
export const safeStorage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v != null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* fire-and-forget; removal failure is non-fatal */ }
  },
  getRaw(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  setRaw(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  }
};
