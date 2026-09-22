import { useEffect, useState } from 'react';
import { Send, CheckCircle, FileSpreadsheet } from 'lucide-react';
import Button from '../Shared/Button.jsx';
import { useCosts } from '../../context/CostContext.jsx';
import { authedFetch } from '../../utils/apiClient.js';
import { previousMonth } from '../../utils/accountantPack.js';
import { formatEUR } from '../../utils/formatters.js';
import styles from './AccountantPanel.module.css';

const LEGACY_KEY = 'omni_accountant_email';

/**
 * AccountantPanel — Settings → Integrations (Autopilot Phase 4, closes #700).
 *
 * #700: the accountant's address used to live in ONE browser's localStorage
 * while the server read an env var, and the "Forward to Accountant" button the
 * copy referred to did not exist. The address now lives in org config (so every
 * device and the server agree), and the month's expenses go out as one CSV with
 * receipt links. Preview first; nothing is emailed until Send is pressed.
 */
export default function AccountantPanel() {
  const { config, updateConfig } = useCosts();
  const stored = config?.accountantEmail || '';

  const [email, setEmail] = useState(stored);
  const [savedFlash, setSavedFlash] = useState(false);
  const [month, setMonth] = useState(previousMonth());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // Keep the input in step with config; migrate a legacy browser-only value once.
  useEffect(() => {
    if (stored) { setEmail(stored); return; }
    let legacy = '';
    try { legacy = localStorage.getItem(LEGACY_KEY) || ''; } catch { /* storage blocked */ }
    if (legacy) setEmail(legacy);
  }, [stored]);

  const dirty = email.trim() !== stored;

  const saveEmail = async () => {
    await updateConfig({ accountantEmail: email.trim() });
    try { localStorage.removeItem(LEGACY_KEY); } catch { /* storage blocked */ }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const call = async (send) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await authedFetch('/api/accountant-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, send }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setPreview(json);
      if (send) setMessage({ ok: true, text: `Sent ${json.count} items for ${month} to ${json.recipient}.` });
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  // Refresh the preview whenever the month changes.
  useEffect(() => { setPreview(null); }, [month]);

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <FileSpreadsheet size={16} aria-hidden="true" />
        <span>Accountant</span>
      </div>

      <label className={styles.label} htmlFor="acct-email">Accountant email</label>
      <div className={styles.row}>
        <input
          id="acct-email"
          type="email"
          className={styles.input}
          placeholder="accountant@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setSavedFlash(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && dirty) saveEmail(); }}
        />
        <Button variant="secondary" size="sm" onClick={saveEmail} disabled={!dirty || !email.trim()}>
          {savedFlash ? <><CheckCircle size={14} /> Saved</> : 'Save'}
        </Button>
      </div>

      <div className={styles.divider} />

      <label className={styles.label} htmlFor="acct-month">Monthly expense pack</label>
      <p className={styles.hint}>
        One CSV of the month&rsquo;s expenses — one-off costs plus recurring bills ticked paid — with links
        to the original receipts. You see the totals first; it&rsquo;s only emailed when you press Send.
      </p>
      <div className={styles.row}>
        <input
          id="acct-month"
          type="month"
          className={styles.input}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
        <Button variant="secondary" size="sm" onClick={() => call(false)} disabled={busy || !month}>
          Preview
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => call(true)}
          disabled={busy || !preview || !preview.count || !stored}
          title={!stored ? 'Save the accountant email first' : (!preview ? 'Preview first' : undefined)}
        >
          <Send size={14} /> Send to accountant
        </Button>
      </div>

      {preview && (
        <p className={styles.preview}>
          {preview.count
            ? `${preview.count} items · ${formatEUR(preview.total)} gross · ${formatEUR(preview.vat)} VAT · ${preview.withReceipt} with receipt`
            : `No expenses recorded for ${preview.month}.`}
          {preview.recipient ? ` → ${preview.recipient}` : ''}
        </p>
      )}
      {message && (
        <p className={message.ok ? styles.ok : styles.error}>{message.text}</p>
      )}
    </div>
  );
}
