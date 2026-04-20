/**
 * ScooterIdLink — universal deep-link primitive.
 * Renders `#scooterId` as a clickable NavLink to /scooters/:id.
 * Import this everywhere a scooterId is displayed to enable app-wide deep-linking.
 *
 * Usage: <ScooterIdLink scooterId="12345" />
 */

import { Link } from 'react-router-dom';
import styles from './ScooterIdLink.module.css';

export default function ScooterIdLink({ scooterId, className = '' }) {
  if (!scooterId) return <span className={className}>—</span>;
  return (
    <Link
      to={`/scooters/${scooterId}`}
      className={`${styles.link} ${className}`}
      onClick={(e) => e.stopPropagation()} // prevent row-click from double-firing
    >
      #{scooterId}
    </Link>
  );
}
