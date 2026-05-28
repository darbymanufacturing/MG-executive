import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { setToastErrorHandler } from '../utils/firestoreWrite.js';
import Toast from '../components/Shared/Toast.jsx';
import styles from '../components/Shared/Toast.module.css';

const ToastContext = createContext(null);

const DEFAULT_DURATIONS = {
  success: 4000,
  info:    4000,
  warning: 5000,
  error:   6000,
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((variant, message, opts = {}) => {
    if (!message) return null;
    const id = ++idRef.current;
    const duration = opts.duration ?? DEFAULT_DURATIONS[variant] ?? 4000;
    setToasts((prev) => [...prev, { id, variant, message, action: opts.action }]);
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  const success = useCallback((msg, opts) => toast('success', msg, opts), [toast]);
  const error   = useCallback((msg, opts) => toast('error',   msg, opts), [toast]);
  const info    = useCallback((msg, opts) => toast('info',    msg, opts), [toast]);
  const warning = useCallback((msg, opts) => toast('warning', msg, opts), [toast]);

  // Bridge: route safeWrite failures through the toast system globally.
  // Contexts can't easily call useToast(), so safeWrite uses a module-level
  // singleton handler that ToastProvider populates on mount.
  useEffect(() => {
    setToastErrorHandler(error);
    return () => setToastErrorHandler(null);
  }, [error]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning, dismiss }}>
      {children}
      <div className={styles.stack} aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <Toast
            key={t.id}
            variant={t.variant}
            message={t.message}
            action={t.action}
            onDismiss={() => dismiss(t.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
