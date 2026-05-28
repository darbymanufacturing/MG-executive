import styles from './Skeleton.module.css';

/**
 * Loading-state placeholder primitive.
 *
 * <Skeleton width="100%" height="40" />
 * <Skeleton variant="text" lines={3} />
 * <Skeleton variant="circle" size={48} />
 */
export default function Skeleton({
  width = '100%',
  height = '1em',
  variant = 'rect',
  size,
  lines = 1,
  radius,
  className = '',
  style,
  ...rest
}) {
  if (variant === 'text' && lines > 1) {
    return (
      <div className={`${styles.lines} ${className}`} {...rest}>
        {Array.from({ length: lines }).map((_, i) => (
          <span
            key={i}
            className={styles.skeleton}
            style={{
              width: i === lines - 1 ? '62%' : '100%',
              height,
              borderRadius: radius ?? 'var(--radius-sm)',
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === 'circle') {
    const dim = size ?? 40;
    return (
      <span
        className={`${styles.skeleton} ${className}`}
        style={{
          width: dim,
          height: dim,
          borderRadius: '50%',
          display: 'inline-block',
          ...style,
        }}
        {...rest}
      />
    );
  }

  return (
    <span
      className={`${styles.skeleton} ${className}`}
      style={{
        width,
        height,
        borderRadius: radius ?? 'var(--radius-sm)',
        display: 'inline-block',
        ...style,
      }}
      {...rest}
    />
  );
}
