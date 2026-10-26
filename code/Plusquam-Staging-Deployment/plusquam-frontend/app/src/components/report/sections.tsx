import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import type { Assessment, DimensionKey } from '../../data/mockAssessment';
import { useTranslation } from '../../i18n/useTranslation';
import type { TranslationKey } from '../../i18n/translations';
import {
  EvidenceBar, VerdictPill, FitLevelPill, RefChip, LegalChip, CitedText,
} from './atoms';

type SectionProps = {
  assessment: Assessment;
  onCite?: (paperId: number) => void;
};

// Passform criterion names arrive as a fixed German enum from the pipeline;
// map them to translatable labels so the EN view isn't German. Unknown names
// fall back to the raw value.
const PASSFORM_CRIT: Record<string, TranslationKey> = {
  'Neuartigkeit':                    'report.passform.crit.novelty',
  'Technisches Risiko':              'report.passform.crit.technical_risk',
  'Systematik':                      'report.passform.crit.systematic',
  'Planmäßigkeit':                   'report.passform.crit.methodical',
  'Wissenschaftliche Ungewissheit':  'report.passform.crit.uncertainty',
};

/* ─── 1. Einordnung FZulG Fit ──────────────────────────────── */

export function EinordnungSection({ assessment }: SectionProps) {
  const { t } = useTranslation();
  const { einordnung, fitScore } = assessment;
  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <VerdictPill verdict={einordnung.verdict} />
          <div className="text-right">
            <div className="text-xs text-ink-muted uppercase tracking-wider font-semibold">
              {t('report.fit.score')}
            </div>
            <div className="text-3xl font-bold text-primary leading-none mt-1">
              {fitScore}<span className="text-base text-ink-muted font-medium"> / 100</span>
            </div>
          </div>
        </div>
        <p className="text-sm text-ink-soft leading-relaxed">{einordnung.justification}</p>
      </div>

      <div className="glass-card rounded-2xl p-6">
        <div className="text-[11px] font-bold tracking-wider text-ink-muted uppercase mb-3">
          {t('report.einordnung.applicable_paragraphs')}
        </div>
        <div className="flex flex-wrap gap-2">
          {einordnung.paragraphs.map(p => <LegalChip key={p} text={p} />)}
        </div>
      </div>
    </div>
  );
}

/* ─── 2. Passform-Matrix ───────────────────────────────────── */

export function PassformSection({ assessment }: SectionProps) {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-subtle">
          <tr className="text-[11px] font-bold tracking-wider text-ink-muted uppercase">
            <th className="text-left px-5 py-3">{t('report.passform.col.criterion')}</th>
            <th className="text-left px-5 py-3 w-44">{t('report.passform.col.level')}</th>
            <th className="text-left px-5 py-3">{t('report.passform.col.evidence')}</th>
          </tr>
        </thead>
        <tbody>
          {assessment.passformMatrix.map((row, i) => (
            <tr key={i} className="border-t border-ink/5">
              <td className="px-5 py-4 font-semibold text-ink">{PASSFORM_CRIT[row.name] ? t(PASSFORM_CRIT[row.name]) : row.name}</td>
              <td className="px-5 py-4"><FitLevelPill level={row.level} /></td>
              <td className="px-5 py-4 text-ink-soft leading-relaxed">{row.evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── 3. Überblick Literatur ───────────────────────────────── */

export function LiteraturSection({ assessment, onCite }: SectionProps) {
  return (
    <article className="glass-card rounded-2xl p-7 prose-sm max-w-none">
      {assessment.literaturUberblick.split('\n\n').map((para, i) => (
        <p key={i} className={i === 0 ? 'text-sm text-ink-soft leading-relaxed' : 'text-sm text-ink-soft leading-relaxed mt-4'}>
          <CitedText text={para} onCite={onCite} />
        </p>
      ))}
    </article>
  );
}

/* ─── 4. Anspruchstabelle (the screenshot's main table) ────── */

export function AnspruchstabelleSection({ assessment, onCite }: SectionProps) {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-subtle">
          <tr className="text-[11px] font-bold tracking-wider text-ink-muted uppercase">
            <th className="text-left px-5 py-3 w-[34%]">{t('report.anspruchs.col.claim')}</th>
            <th className="text-left px-5 py-3 w-44">{t('report.anspruchs.col.evidence')}</th>
            <th className="text-left px-5 py-3">{t('report.anspruchs.col.reasoning')}</th>
          </tr>
        </thead>
        <tbody>
          {assessment.anspruchstabelle.map((row, i) => (
            <tr key={i} className="border-t border-ink/5 hover:bg-surface-subtle/50">
              <td className="px-5 py-4 align-top">
                <div className="font-semibold text-ink mb-2 leading-snug">{row.claim}</div>
                <div className="flex flex-wrap gap-1.5">
                  {row.legalRefs?.map(l => <LegalChip key={l} text={l} />)}
                  {row.paperRefs.map(n => <RefChip key={n} n={n} onClick={() => onCite?.(n)} />)}
                </div>
              </td>
              <td className="px-5 py-4 align-top"><EvidenceBar strength={row.evidence} /></td>
              <td className="px-5 py-4 align-top text-ink-soft leading-relaxed">{row.reasoning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── 5. Forschungslücken ──────────────────────────────────── */

export function ForschungsluekenSection({ assessment, onCite }: SectionProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {assessment.forschungsluecken.map((g, i) => (
        <div key={i} className="glass-card rounded-2xl p-6">
          <h3 className="font-semibold text-ink leading-snug mb-2">{g.question}</h3>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {g.paperRefs.map(n => <RefChip key={n} n={n} onClick={() => onCite?.(n)} />)}
          </div>
          <div className="border-t border-ink/5 pt-3">
            <div className="text-[11px] font-bold tracking-wider text-ink-muted uppercase mb-1">
              {t('report.forschungsluecken.fzulg_relevance')}
            </div>
            <p className="text-sm text-ink-soft leading-relaxed">{g.fzulgRelevance}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── 6. Neuheitsgrad (5-dimension score + radar) ──────────── */

const DIM_KEYS: Record<DimensionKey, TranslationKey> = {
  technical:      'report.neuheitsgrad.dim.technical',
  methodological: 'report.neuheitsgrad.dim.methodological',
  uncertainty:    'report.neuheitsgrad.dim.uncertainty',
  systematic:     'report.neuheitsgrad.dim.systematic',
  outcomes:       'report.neuheitsgrad.dim.outcomes',
};

export function NeuheitsgradSection({ assessment, onCite }: SectionProps) {
  const { t } = useTranslation();
  const { neuheitsgrad } = assessment;
  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-6 flex flex-col md:flex-row items-center gap-8 card-lift animate-scale-in">
        <RadarChart dimensions={neuheitsgrad.dimensions.map(d => ({
          label: t(DIM_KEYS[d.key]),
          value: d.score, // 0..20
        }))} />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold tracking-wider text-ink-muted uppercase mb-2">
            {t('report.neuheitsgrad.overall')}
          </div>
          <div className="text-5xl font-bold leading-none mb-2 text-signature">
            <ScoreCountUp value={neuheitsgrad.overall} /><span className="text-lg text-ink-muted font-medium"> / 100</span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {neuheitsgrad.dimensions.map((d, i) => (
          <div key={d.key} className="glass-card rounded-2xl p-5 card-lift stagger-item" style={{ '--i': i } as React.CSSProperties}>
            <div className="flex items-baseline justify-between gap-4 mb-2">
              <h3 className="font-semibold text-ink">{t(DIM_KEYS[d.key])}</h3>
              <span className="text-sm font-bold text-primary tabular-nums">
                {d.score} <span className="text-ink-muted font-medium">/ 20</span>
              </span>
            </div>
            <div className="h-1.5 bg-primary-50 rounded-pill overflow-hidden mb-3">
              <div className="h-full bg-primary rounded-pill transition-[width] duration-700 ease-premium"
                   style={{ width: `${(d.score / 20) * 100}%` }} />
            </div>
            <p className="text-sm text-ink-soft leading-relaxed">{d.rationale}</p>
            {d.paperRefs && d.paperRefs.length > 0 && (
              <div className="flex gap-1.5 mt-2">
                {d.paperRefs.map(n => <RefChip key={n} n={n} onClick={() => onCite?.(n)} />)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Count-up for the big overall novelty score. */
function ScoreCountUp({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setDisplay(value); return; }
    const duration = 1000;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
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

/* ─── Radar chart for the Neuheitsgrad section ─────────────── */

function RadarChart({ dimensions }: { dimensions: { label: string; value: number }[] }) {
  const size = 240;
  const cx = size / 2;
  const cy = size / 2;
  const r = 90;
  const n = dimensions.length;

  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Points on the polygon (value scaled to 0..r)
  const points = dimensions.map((d, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const dist = (d.value / 20) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle), label: d.label, angle };
  });

  // Ring gridlines
  const rings = [0.25, 0.5, 0.75, 1].map(s => {
    return Array.from({ length: n }).map((_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return `${cx + s * r * Math.cos(angle)},${cy + s * r * Math.sin(angle)}`;
    }).join(' ');
  });

  // Axis ends
  const axisEnds = Array.from({ length: n }).map((_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle };
  });

  return (
    <svg
      viewBox={`-80 -28 ${size + 160} ${size + 56}`}
      className="shrink-0 w-full max-w-[400px] h-auto mx-auto md:mx-0"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id="radar-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgb(var(--c-signature-a))" />
          <stop offset="100%" stopColor="rgb(var(--c-signature-b))" />
        </linearGradient>
      </defs>
      {rings.map((pts, i) => (
        <polygon key={i} points={pts} fill="none" stroke="rgb(var(--c-ring) / 0.14)" strokeWidth={1} />
      ))}
      {axisEnds.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgb(var(--c-ring) / 0.14)" strokeWidth={1} />
      ))}
      <polygon
        points={points.map(p => `${p.x},${p.y}`).join(' ')}
        fill="url(#radar-gradient)"
        fillOpacity={0.22}
        stroke="url(#radar-gradient)"
        strokeWidth={2}
        strokeLinejoin="round"
        style={{
          transformOrigin: `${cx}px ${cy}px`,
          transform: grown ? 'scale(1)' : 'scale(0)',
          opacity: grown ? 1 : 0,
          transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1), opacity 0.6s ease-out',
        }}
      />
      {points.map((p, i) => (
        <circle
          key={i} cx={p.x} cy={p.y} r={3} fill="rgb(var(--c-signature-a))"
          style={{
            opacity: grown ? 1 : 0,
            transition: `opacity 0.4s ease-out ${0.5 + i * 0.06}s`,
          }}
        />
      ))}
      {/* Axis labels — wrapped onto up to two lines so long German terms don't clip */}
      {axisEnds.map((p, i) => {
        const lx = cx + (r + 16) * Math.cos(p.angle);
        const ly = cy + (r + 16) * Math.sin(p.angle);
        const anchor = Math.abs(Math.cos(p.angle)) < 0.3 ? 'middle' : (Math.cos(p.angle) > 0 ? 'start' : 'end');
        const lines = wrapLabel(dimensions[i].label, 16);
        return (
          <text key={i} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle"
                fontSize={10} fontWeight={600} fill="rgb(var(--c-ink-muted))">
            {lines.map((ln, j) => (
              <tspan key={j} x={lx} dy={j === 0 ? -(lines.length - 1) * 5.5 : 11}>{ln}</tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}

/** Split a label into at most two balanced lines, breaking on spaces. */
function wrapLabel(label: string, max: number): string[] {
  if (label.length <= max) return [label];
  const words = label.split(' ');
  if (words.length === 1) return [label];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 2);
}

/* ─── 7. Fazit ─────────────────────────────────────────────── */

export function FazitSection({ assessment }: SectionProps) {
  const { t } = useTranslation();
  const { fazit } = assessment;

  // Interactive documentation checklist — persisted per project so ticks survive
  // reloads and navigation (kept in localStorage; auth tokens use sessionStorage).
  const storageKey = `plusquam_checklist_${assessment.projectId}`;
  const [checked, setChecked] = useState<Set<number>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setChecked(raw ? new Set(JSON.parse(raw) as number[]) : new Set());
    } catch {
      setChecked(new Set());
    }
  }, [storageKey]);

  function toggle(i: number) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      try { localStorage.setItem(storageKey, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-2xl p-6">
        <h2 className="text-lg font-bold text-ink mb-4">{t('report.fazit.heading')}</h2>
        <VerdictPill verdict={fazit.recommendation} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <FazitList title={t('report.fazit.strengths')} items={fazit.strengths}                tone="ok"   />
        <FazitList title={t('report.fazit.risks')}     items={fazit.risks}                    tone="warn" />
      </div>

      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-4">
          {t('report.fazit.documentation')}
        </h3>
        <ul className="space-y-2">
          {(fazit.documentationChecklist || []).map((item, i) => {
            const on = checked.has(i);
            return (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-pressed={on}
                  className="group flex items-start gap-3 text-sm text-left w-full"
                >
                  <span
                    className={`shrink-0 w-4 h-4 rounded border mt-0.5 flex items-center justify-center transition-colors ${
                      on ? 'bg-primary border-primary' : 'border-primary group-hover:bg-primary-50'
                    }`}
                  >
                    {on && <Check size={12} strokeWidth={3} className="text-white" />}
                  </span>
                  <span className={on ? 'text-ink-muted line-through' : 'text-ink-soft'}>{item}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function FazitList({ title, items, tone }: { title: string; items: string[]; tone: 'ok' | 'warn' }) {
  const dot = tone === 'ok' ? 'bg-ok-dot' : 'bg-warn-dot';
  return (
    <div className="glass-card rounded-2xl p-6">
      <h3 className="text-sm font-bold text-ink uppercase tracking-wider mb-4">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 text-sm text-ink-soft leading-relaxed">
            <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${dot} mt-1.5`} />
            <span className="min-w-0 wrap-break-word">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
