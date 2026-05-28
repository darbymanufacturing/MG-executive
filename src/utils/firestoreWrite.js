/**
 * Safe wrapper around Firestore writes. Surfaces failures as toasts and returns
 * a structured result so callers can decide what to do.
 *
 *   // Default: caller checks result.ok
 *   const result = await safeWrite(() => addDoc(collection(db, 'costs'), data));
 *   if (!result.ok) return;
 *   useThing(result.data);
 *
 *   // rethrow:true — caller's existing throw-handling stays; the toast is
 *   // additive. Use this when refactoring an existing function that already
 *   // propagates errors and you don't want to change its public contract.
 *   const newCost = {...};
 *   await safeWrite(() => addDoc(...), { rethrow: true, errorMessage: 'Failed to save cost' });
 *   return newCost;
 *
 * Options:
 *   optimisticRollback — () => void called if the write fails (revert local state)
 *   errorMessage       — override the toast text for this specific call
 *   silent             — true → don't toast even on failure (caller will handle)
 *   rethrow            — true → re-throw the original error after toasting
 *
 * Contexts can't easily call useToast() at module level, so this module exposes a
 * setToastErrorHandler() singleton that ToastProvider populates on mount.
 */

let _toastError = null;

export function setToastErrorHandler(fn) {
  _toastError = fn;
}

export async function safeWrite(operation, options = {}) {
  const {
    optimisticRollback,
    errorMessage,
    silent = false,
    rethrow = false,
  } = options;

  try {
    const data = await operation();
    return { ok: true, data };
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.error('[safeWrite]', err);
    }
    if (optimisticRollback) {
      try { optimisticRollback(); }
      catch (rollbackErr) { console.error('[safeWrite] rollback failed', rollbackErr); }
    }
    if (!silent) {
      const friendly = errorMessage || friendlyFirestoreError(err);
      if (_toastError) _toastError(friendly);
    }
    if (rethrow) throw err;
    return { ok: false, error: err };
  }
}

/** Map common Firestore error codes to user-facing copy. */
export function friendlyFirestoreError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'unavailable':
    case 'deadline-exceeded':
      return 'Network is unstable — your change will sync when you reconnect.';
    case 'failed-precondition':
      return 'This change conflicts with another update. Refresh and try again.';
    case 'permission-denied':
      return "You don't have permission to make this change.";
    case 'resource-exhausted':
      return 'The service is temporarily rate-limited. Please try again in a moment.';
    case 'not-found':
      return 'That record no longer exists.';
    case 'already-exists':
      return 'A record with that identifier already exists.';
    case 'cancelled':
      return 'The operation was cancelled.';
    case 'unauthenticated':
      return 'Your session has expired. Please sign in again.';
    default:
      return err?.message || 'Something went wrong. Please try again.';
  }
}
