import { Link } from 'react-router-dom';
import { legalStyles as s } from './legalStyles.js';

/**
 * Terms of Service (#12). Public, unauthenticated page at /terms.
 *
 * ⚠️ TEMPLATE: a good-faith starting point. NOT legal advice — have counsel review and
 * adapt it (jurisdiction, liability caps, billing terms) before a commercial launch or
 * an App Store / Play Store submission.
 */
const EFFECTIVE = '10 June 2026';

export default function TermsOfService() {
  return (
    <div style={s.page}>
      <div style={s.card}>
        <Link to="/login" style={s.back}>← Back</Link>
        <h1 style={s.h1}>Terms of Service</h1>
        <p style={s.meta}>Effective {EFFECTIVE} · Omni, operated by Micromobility Greece</p>

        <div style={s.draftNote}>
          Draft template — pending review by legal counsel. Do not treat as final legal text.
        </div>

        <h2 style={s.h2}>1. Agreement</h2>
        <p style={s.p}>
          These Terms govern your access to and use of Omni (the “Service”), operated by
          Micromobility Greece (“we”, “us”). By creating an account or using the Service you
          agree to these Terms. If you do not agree, do not use the Service.
        </p>

        <h2 style={s.h2}>2. The Service</h2>
        <p style={s.p}>
          Omni is a fleet-operations and finance platform for micromobility operators. We may
          add, change, or remove features over time. We aim for high availability but do not
          guarantee the Service will be uninterrupted or error-free.
        </p>

        <h2 style={s.h2}>3. Accounts</h2>
        <ul style={s.ul}>
          <li>You are responsible for your account credentials and for activity under your account.</li>
          <li>You must provide accurate information and keep it up to date.</li>
          <li>Account owners and admins control access for their organisation’s members.</li>
          <li>Notify us promptly of any unauthorised use of your account.</li>
        </ul>

        <h2 style={s.h2}>4. Acceptable use</h2>
        <p style={s.p}>You agree not to:</p>
        <ul style={s.ul}>
          <li>access another organisation’s data, or attempt to bypass access controls;</li>
          <li>upload unlawful content or content you do not have the right to upload;</li>
          <li>interfere with, overload, or reverse-engineer the Service; or</li>
          <li>use the Service to violate any applicable law.</li>
        </ul>

        <h2 style={s.h2}>5. Your data</h2>
        <p style={s.p}>
          You retain ownership of the data you submit. You grant us the limited rights needed
          to host and process it to provide the Service. Our handling of personal data is
          described in the <Link to="/privacy" style={s.a}>Privacy Policy</Link>.
        </p>

        <h2 style={s.h2}>6. Subscriptions &amp; fees</h2>
        <p style={s.p}>
          Where the Service is offered on a paid basis, fees, billing cycles, and any trial
          terms will be presented before you subscribe. Unless stated otherwise, fees are
          non-refundable except as required by law.
        </p>

        <h2 style={s.h2}>7. Intellectual property</h2>
        <p style={s.p}>
          The Service, including its software, design, and branding, is owned by us and our
          licensors and is protected by applicable laws. These Terms grant you no rights in it
          except the right to use it as permitted here.
        </p>

        <h2 style={s.h2}>8. Disclaimers &amp; limitation of liability</h2>
        <p style={s.p}>
          The Service is provided “as is” without warranties of any kind to the extent
          permitted by law. Analytics and financial figures are provided for operational
          guidance and are not professional financial advice. To the maximum extent permitted
          by law, our aggregate liability arising from the Service is limited to the amounts
          you paid for it in the twelve months before the event giving rise to the claim.
        </p>

        <h2 style={s.h2}>9. Termination</h2>
        <p style={s.p}>
          You may stop using the Service at any time. We may suspend or terminate access if
          you breach these Terms or where required by law. On termination, your data will be
          handled as described in the Privacy Policy.
        </p>

        <h2 style={s.h2}>10. Governing law</h2>
        <p style={s.p}>
          These Terms are governed by the laws of Greece, and the courts of Greece have
          jurisdiction, without prejudice to any mandatory consumer-protection rights you may
          have.
        </p>

        <h2 style={s.h2}>11. Changes &amp; contact</h2>
        <p style={s.p}>
          We may update these Terms; we will revise the “Effective” date and, for material
          changes, provide notice. Questions:{' '}
          <a href="mailto:legal@micromobility.gr" style={s.a}>legal@micromobility.gr</a>.
        </p>

        <p style={s.footer}>
          See also our <Link to="/privacy" style={s.a}>Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
