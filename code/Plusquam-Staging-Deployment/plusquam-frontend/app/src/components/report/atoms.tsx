import type { EvidenceStrength, Verdict, FitLevel } from '../../data/mockAssessment';
import { useTranslation } from '../../i18n/useTranslation';
import type { TranslationKey } from '../../i18n/translations';

/** 10-segment bar visualising claim evidence strength. */
export function EvidenceBar({ strength }: { strength: EvidenceStrength }) {
  const { t } = useTranslation();
  const filled = strength === 'strong' ? 8 : strength === 'moderate' ? 5 : 3;
  const tone =
    strength === 'strong' ? 'bg-primary'
    : strength === 'moderate' ? 'bg-warn-dot'
    : 'bg-bad-dot';
  const label =
    strength === 'strong' ? t('report.evidence.strong')
    : strength === 'moderate' ? t('report.evidence.moderate')
    : t('report.evidence.low');

  return (
    <div>
      <div className="flex gap-0.5 mb-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className={`h-5 w-1.5 rounded-xs ${i < filled ? tone : 'bg-ink/10'}`}
          />
        ))}
      </div>
      <div className="text-[11px] text-ink-muted">{label}</div>
    </div>
  );
}

/** Verdict pill — used in Einordnung and Fazit. */
export function VerdictPill({ verdict }: { verdict: Verdict }) {
  const { t } = useTranslation();
  const map: Record<Verdict, { bg: string; text: string; dot: string; key: TranslationKey }> = {
    qualifies:      { bg: 'bg-ok-bg',   text: 'text-ok-text',   dot: 'bg-ok-dot',   key: 'report.einordnung.verdict.qualifies' },
    borderline:     { bg: 'bg-warn-bg', text: 'text-warn-text', dot: 'bg-warn-dot', key: 'report.einordnung.verdict.borderline' },
    not_qualifies:  { bg: 'bg-bad-bg',  text: 'text-bad-text',  dot: 'bg-bad-dot',  key: 'report.einordnung.verdict.not_qualifies' },
  };
  const v = map[verdict];
  return (
    <span className={`inline-flex items-center gap-2 ${v.bg} ${v.text} px-3.5 py-1.5 rounded-pill text-xs font-bold uppercase tracking-wider`}>
      <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
      {t(v.key)}
    </span>
  );
}

/** Fit-level pill — used in Passform-Matrix. */
export function FitLevelPill({ level }: { level: FitLevel }) {
  const { t } = useTranslation();
  const tones: Record<FitLevel, string> = {
    strong:        'bg-ok-bg text-ok-text',
    fulfilled:     'bg-primary-50 text-primary',
    weak:          'bg-warn-bg text-warn-text',
    not_fulfilled: 'bg-bad-bg text-bad-text',
  };
  const keys: Record<FitLevel, TranslationKey> = {
    strong:        'report.passform.level.strong',
    fulfilled:     'report.passform.level.fulfilled',
    weak:          'report.passform.level.weak',
    not_fulfilled: 'report.passform.level.not_fulfilled',
  };
  return (
    <span className={`inline-block ${tones[level]} px-2.5 py-1 rounded-md text-xs font-semibold`}>
      {t(keys[level])}
    </span>
  );
}

/** Small numeric chip referencing a paper. */
export function RefChip({ n, onClick }: { n: number; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center w-6 h-5 rounded-sm bg-primary-50 text-primary text-[11px] font-bold hover:bg-primary-100 transition-colors"
    >
      {n}
    </button>
  );
}

/** Small chip for a legal paragraph (e.g. §2 FZulG). */
export function LegalChip({ text }: { text: string }) {
  return (
    <span className="inline-block bg-info-bg text-info-text px-2 py-0.5 rounded-sm text-[11px] font-semibold">
      {text}
    </span>
  );
}

/** Renders text with [1] / [2] inline citations turned into chips. */
export function CitedText({ text, onCite }: { text: string; onCite?: (n: number) => void }) {
  const parts = text.split(/(\[\d+\](?:\[\d+\])*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\](\[\d+\])*$/);
        if (!m) return <span key={i}>{p}</span>;
        const nums = p.match(/\d+/g)?.map(Number) ?? [];
        return (
          <span key={i} className="inline-flex items-center gap-0.5 align-baseline ml-0.5">
            {nums.map(n => <RefChip key={n} n={n} onClick={() => onCite?.(n)} />)}
          </span>
        );
      })}
    </>
  );
}
