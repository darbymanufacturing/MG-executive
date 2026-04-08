import { CATEGORIES } from '../../utils/constants.js';
import styles from './CategoryBadge.module.css';

export default function CategoryBadge({ category }) {
  const cat = CATEGORIES[category];
  if (!cat) return null;
  return (
    <span
      className={styles.badge}
      style={{ background: cat.color, color: cat.textColor }}
    >
      {cat.label}
    </span>
  );
}
