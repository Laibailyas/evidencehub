import { type ReactNode, useEffect, useRef, useState } from 'react';

type Props = {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  accent?: 'default' | 'primary' | 'ok' | 'warn';
  index?: number;
  size?: 'default' | 'lg';
  className?: string;
};

const accentMap = {
  default: 'text-ink',
  primary: 'text-primary-text',
  ok:      'text-ok-text',
  warn:    'text-warn-text',
} as const;

export default function StatCard({ label, value, caption, accent = 'default', index = 0, size = 'default', className = '' }: Props) {
  const big = size === 'lg';
  return (
    <div
      className={`group relative glass-card rounded-2xl ${big ? 'p-7 h-full flex flex-col justify-between' : 'p-5'} card-lift stagger-item overflow-hidden hover:ring-primary/25 ${className}`}
      style={{ '--i': index } as React.CSSProperties}
    >
      {/* Ambient glow that appears on hover, kept subtle */}
      <div className="pointer-events-none absolute -right-8 -top-8 w-32 h-32 rounded-full bg-linear-to-br from-primary/20 to-[rgb(var(--c-signature-b))]/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className={`relative font-semibold tracking-wider text-ink-muted uppercase ${big ? 'text-xs mb-4' : 'text-[11px] mb-3'}`}>
        {label}
      </div>
      <div className={`relative font-bold leading-none tabular-nums ${big ? 'text-6xl' : 'text-4xl'} ${accentMap[accent]}`}>
        {typeof value === 'number' ? <CountUp value={value} /> : value}
      </div>
      {caption && (
        <div className={`relative text-ink-muted ${big ? 'text-sm mt-4' : 'text-xs mt-3'}`}>{caption}</div>
      )}
    </div>
  );
}

/** Lightweight count-up for numeric stat values; respects reduced-motion. */
function CountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setDisplay(value); return; }

    const duration = 800;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // ease-out-cubic

    let raf: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(ease(t) * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{display}</>;
}
