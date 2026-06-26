import { CATEGORIES } from '../../utils/constants.js';
import styles from './CategoryBadge.module.css';

export default function CategoryBadge({ category }) {
  if (!category) return null;
  // Fall back to a neutral badge showing the raw key so a category that isn't in
  // CATEGORIES (e.g. a future owner-defined one) still renders instead of vanishing.
  const cat = CATEGORIES[category] || { label: category, color: '#9CA3AF', textColor: '#FFFFFF' };
  return (
    <span
      className={styles.badge}
      style={{ background: cat.color, color: cat.textColor }}
    >
      {cat.label}
    </span>
  );
}
