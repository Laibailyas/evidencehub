type Props = { className?: string; height?: number };

/**
 * plusquam logo — official brand artwork (ink wordmark + pixel-plus mark).
 * Renders both variants and toggles via the `dark` class so it always matches
 * the active theme: ink wordmark on light, light wordmark on dark.
 */
export default function Logo({ className, height = 28 }: Props) {
  const base = className ?? '';
  return (
    <>
      <img
        src="/plusquam-ink.png"
        alt="plusquam"
        className={`${base} block dark:hidden`}
        style={{ height, width: 'auto' }}
      />
      <img
        src="/plusquam-light.png"
        alt="plusquam"
        className={`${base} hidden dark:block`}
        style={{ height, width: 'auto' }}
      />
    </>
  );
}
