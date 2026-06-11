import { Link } from 'react-router-dom';
import { legalStyles as s } from './legalStyles.js';

/**
 * Privacy Policy (#12). Public, unauthenticated page at /privacy.
 *
 * ⚠️ TEMPLATE: this is a good-faith starting point covering the data Omni actually
 * processes and the sub-processors it uses, written to be GDPR-aware (the company is
 * EU/Greece-based). It is NOT legal advice — have counsel review and adapt it before
 * relying on it for an App Store / Play Store submission or a commercial launch.
 */
const EFFECTIVE = '10 June 2026';

export default function PrivacyPolicy() {
  return (
    <div style={s.page}>
      <div style={s.card}>
        <Link to="/login" style={s.back}>← Back</Link>
        <h1 style={s.h1}>Privacy Policy</h1>
        <p style={s.meta}>Effective {EFFECTIVE} · Omni, operated by Micromobility Greece</p>

        <div style={s.draftNote}>
          Draft template — pending review by legal counsel. Do not treat as final legal text.
        </div>

        <h2 style={s.h2}>1. Who we are</h2>
        <p style={s.p}>
          Omni is a fleet-operations platform operated by Micromobility Greece (“we”, “us”,
          the “data controller”). For privacy questions or to exercise your rights, contact
          us at <a href="mailto:privacy@micromobility.gr" style={s.a}>privacy@micromobility.gr</a>.
        </p>

        <h2 style={s.h2}>2. What we collect</h2>
        <ul style={s.ul}>
          <li><strong>Account data</strong> — name, email, role, and the organisation you belong to, used to authenticate you and scope your access.</li>
          <li><strong>Fleet operational data</strong> — scooters, maintenance tickets, costs, revenue, projects and related records you enter or import.</li>
          <li><strong>Vehicle telemetry &amp; trips</strong> — ride, status and location data synced from the vehicle platform to compute fleet analytics.</li>
          <li><strong>Uploaded content</strong> — repair photos and documents you upload.</li>
          <li><strong>Technical data</strong> — log and error-diagnostics data (e.g. crash reports) used to keep the service reliable.</li>
        </ul>

        <h2 style={s.h2}>3. Why we process it (legal bases)</h2>
        <p style={s.p}>
          We process personal data to provide the service you have signed up for
          (performance of a contract), to keep it secure and operational (our legitimate
          interests), and to meet legal obligations (e.g. accounting). Where required, we
          rely on your consent and you may withdraw it at any time.
        </p>

        <h2 style={s.h2}>4. Who we share it with (sub-processors)</h2>
        <p style={s.p}>We do not sell your data. We share it only with service providers that process it on our behalf:</p>
        <ul style={s.ul}>
          <li><strong>Supabase</strong> — primary application database and storage.</li>
          <li><strong>Google Firebase</strong> — authentication.</li>
          <li><strong>Vercel</strong> — application hosting.</li>
          <li><strong>Cloudinary</strong> — image (repair-photo) storage and delivery.</li>
          <li><strong>Mapbox</strong> — map rendering.</li>
          <li><strong>Resend</strong> — transactional email.</li>
          <li><strong>Anthropic</strong> — AI features (e.g. the daily brief). Operational summaries may be processed to generate insights; we do not use your data to train third-party models.</li>
          <li><strong>Sentry</strong> — error monitoring.</li>
        </ul>

        <h2 style={s.h2}>5. International transfers</h2>
        <p style={s.p}>
          Some sub-processors operate outside the EEA. Where that is the case, transfers are
          governed by appropriate safeguards such as the EU Standard Contractual Clauses.
        </p>

        <h2 style={s.h2}>6. Retention</h2>
        <p style={s.p}>
          We keep personal data for as long as your organisation’s account is active and as
          required to provide the service, then delete or anonymise it within a reasonable
          period, subject to legal retention obligations.
        </p>

        <h2 style={s.h2}>7. Your rights</h2>
        <p style={s.p}>
          Under the GDPR you have the right to access, rectify, erase, restrict, and port
          your personal data, and to object to certain processing. To exercise these rights,
          email <a href="mailto:privacy@micromobility.gr" style={s.a}>privacy@micromobility.gr</a>.
          You also have the right to lodge a complaint with the Hellenic Data Protection
          Authority (HDPA).
        </p>

        <h2 style={s.h2}>8. Security</h2>
        <p style={s.p}>
          Access is restricted per organisation and enforced at the database layer
          (row-level security). Data is encrypted in transit. No system is perfectly secure,
          but we take reasonable measures to protect your data.
        </p>

        <h2 style={s.h2}>9. Changes</h2>
        <p style={s.p}>
          We may update this policy; we will revise the “Effective” date above and, for
          material changes, notify you in-app or by email.
        </p>

        <p style={s.footer}>
          See also our <Link to="/terms" style={s.a}>Terms of Service</Link>.
        </p>
      </div>
    </div>
  );
}
