import { Component } from 'react';
import { isSentryEnabled } from '../../lib/sentry.js';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import styles from './ErrorBoundary.module.css';

/**
 * React error boundary. Catches render-phase errors below it and shows a
 * recoverable fallback UI instead of unmounting the whole tree.
 *
 * Props:
 *   children      — wrapped subtree
 *   title         — optional heading override
 *   message       — optional body copy override
 *   fallback      — optional ReactNode or (error, reset) => ReactNode
 *   onError       — optional (error, errorInfo) => void; extra hook (Sentry capture is already wired in componentDidCatch)
 *   onReset       — optional () => void; called when user clicks "Try again"
 *   resetKeys     — optional array; if any value changes, the boundary auto-resets
 */
export class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidUpdate(prevProps) {
    if (!this.state.hasError) return;
    const prev = prevProps.resetKeys || [];
    const curr = this.props.resetKeys || [];
    if (prev.length !== curr.length || prev.some((v, i) => v !== curr[i])) {
      this.setState({ hasError: false, error: null });
    }
  }

  componentDidCatch(error, errorInfo) {
    if (typeof console !== 'undefined') {
      console.error('[ErrorBoundary]', error, errorInfo);
    }
    // Report to Sentry only when the SDK was actually initialised (DSN present,
    // prod build). The dynamic import is free at runtime when Sentry is enabled
    // because the chunk is already loaded by initSentry(). When DSN is unset,
    // isSentryEnabled() is false and the import() is never called, so Rollup
    // can emit Sentry as a lazy chunk that never lands in the initial bundle.
    if (isSentryEnabled()) {
      import('@sentry/react').then(Sentry => {
        Sentry.captureException(error, {
          contexts: { react: { componentStack: errorInfo?.componentStack } },
        });
      });
    }
    if (this.props.onError) {
      try { this.props.onError(error, errorInfo); } catch { /* swallow */ }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      try { this.props.onReset(); } catch { /* swallow */ }
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback(this.state.error, this.handleReset)
        : this.props.fallback;
    }

    return (
      <div className={styles.container} role="alert">
        <div className={styles.card}>
          <div className={styles.iconWrap}>
            <AlertTriangle size={28} />
          </div>
          <h2 className={styles.title}>
            {this.props.title || 'Something went wrong'}
          </h2>
          <p className={styles.message}>
            {this.props.message ||
              'An unexpected error stopped this section from rendering. The rest of the app is still working — try again, or refresh the page.'}
          </p>
          {this.state.error?.message && (
            <details className={styles.details}>
              <summary>Error details</summary>
              <code>{this.state.error.message}</code>
            </details>
          )}
          <button type="button" className={styles.button} onClick={this.handleReset}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
