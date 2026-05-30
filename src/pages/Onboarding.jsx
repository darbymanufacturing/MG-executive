import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, Building2, Sparkles, Check, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { useCosts } from '../context/CostContext.jsx';
import AsterismMark from '../components/Shared/AsterismMark.jsx';
import styles from './Onboarding.module.css';

const STEPS = ['Welcome', 'Your fleet', 'Sample data', 'Done'];

/**
 * Onboarding — 4-step wizard shown right after signup (Phase 2 / ROADMAP 2.5).
 * Org-scoped: updateConfig + loadSampleData write to the new owner's org via the
 * Phase-2 CostContext (orgWrite under the hood). Skippable at any point.
 */
export default function Onboarding() {
  const { config, updateConfig, loadSampleData } = useCosts();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState(config?.companyName || '');
  const [fleetSize, setFleetSize] = useState(config?.fleetSize ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const finish = () => navigate('/', { replace: true });

  const saveBasics = async () => {
    setError('');
    setBusy(true);
    try {
      await updateConfig({
        companyName: companyName.trim() || config?.companyName || 'My Company',
        fleetSize: Number(fleetSize) || 0,
      });
      setStep(2);
    } catch (err) {
      setError(err.message || 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSample = async () => {
    setError('');
    setBusy(true);
    try {
      await loadSampleData();
      setStep(3);
    } catch (err) {
      setError(err.message || 'Could not load sample data.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`omni-app ${styles.page}`}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <AsterismMark size={40} />
          <span className={styles.wordmark}>omni</span>
        </div>

        {/* Step indicator */}
        <div className={styles.steps}>
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`${styles.dot} ${i === step ? styles.dotActive : ''} ${i < step ? styles.dotDone : ''}`}
              title={label}
            />
          ))}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div className={styles.body}>
            <Rocket size={32} className={styles.stepIcon} />
            <h1 className={styles.title}>Welcome to Omni</h1>
            <p className={styles.text}>
              Let's get your fleet set up in a couple of quick steps. You can change
              anything later in Settings.
            </p>
            <button className={styles.primaryBtn} onClick={() => setStep(1)}>
              Get started <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* Step 1 — Fleet basics */}
        {step === 1 && (
          <div className={styles.body}>
            <Building2 size={32} className={styles.stepIcon} />
            <h1 className={styles.title}>Tell us about your fleet</h1>
            <div className={styles.field}>
              <label className={styles.label}>Company name</label>
              <input
                className={styles.input}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Mobility"
                autoFocus
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>How many scooters?</label>
              <input
                className={styles.input}
                type="number"
                min="0"
                value={fleetSize}
                onChange={(e) => setFleetSize(e.target.value)}
                placeholder="20"
              />
            </div>
            <div className={styles.btnRow}>
              <button className={styles.ghostBtn} onClick={() => setStep(0)} disabled={busy}>
                <ArrowLeft size={16} /> Back
              </button>
              <button className={styles.primaryBtn} onClick={saveBasics} disabled={busy}>
                {busy ? <><Loader2 size={16} className={styles.spinner} /> Saving…</> : <>Continue <ArrowRight size={16} /></>}
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Sample data */}
        {step === 2 && (
          <div className={styles.body}>
            <Sparkles size={32} className={styles.stepIcon} />
            <h1 className={styles.title}>Want to explore with sample data?</h1>
            <p className={styles.text}>
              We can load a realistic set of example costs so you can see how Omni works.
              You can clear it anytime from Settings.
            </p>
            <div className={styles.btnRow}>
              <button className={styles.ghostBtn} onClick={() => setStep(3)} disabled={busy}>
                Start empty
              </button>
              <button className={styles.primaryBtn} onClick={handleLoadSample} disabled={busy}>
                {busy ? <><Loader2 size={16} className={styles.spinner} /> Loading…</> : <>Load sample data <Sparkles size={16} /></>}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Done */}
        {step === 3 && (
          <div className={styles.body}>
            <div className={styles.checkCircle}><Check size={28} /></div>
            <h1 className={styles.title}>You're all set</h1>
            <p className={styles.text}>
              Your organization is ready. Head to the dashboard to start tracking your fleet.
            </p>
            <button className={styles.primaryBtn} onClick={finish}>
              Go to dashboard <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* Skip */}
        {step < 3 && (
          <button className={styles.skip} onClick={finish}>Skip for now</button>
        )}
      </div>
    </div>
  );
}
