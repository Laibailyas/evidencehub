import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, FileText, Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';
import type { TranslationKey } from '../i18n/translations';
import { API_ENABLED, api } from '../lib/api';

// Per-step duration in ms — used only in MOCK mode (no API configured).
const STEP_DURATIONS_MS = [800, 1100, 1500, 2000, 1500, 1500, 800];

type StoredProject = {
  id: string;
  title: string;
  description: string;
  domains: string[];
  reference: string;
  submittedAt: string;
};

export default function Processing() {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();

  const project = useMemo<StoredProject | null>(() => {
    try {
      const raw = sessionStorage.getItem(`plusquam_project_${id}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [id]);

  const [currentStep, setCurrentStep] = useState(0); // 0..7 (7 = done)
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await api.startAssessment(id);
      setError(null);
      setCurrentStep(0);
      setNonce(n => n + 1); // restart polling + timer
    } catch {
      setError(t('processing.retry_failed'));
    } finally {
      setRetrying(false);
    }
  }

  // MOCK mode: fake-advance the steps on a timer.
  useEffect(() => {
    if (API_ENABLED) return;
    if (currentStep >= 7) return;
    const ms = STEP_DURATIONS_MS[currentStep] ?? 1000;
    const timer = setTimeout(() => setCurrentStep(s => s + 1), ms);
    return () => clearTimeout(timer);
  }, [currentStep]);

  // API mode: poll real per-step status from DynamoDB.
  useEffect(() => {
    if (!API_ENABLED) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const items = await api.getStatus(id);
        if (!active) return;

        const byStep: Record<number, string> = {};
        for (const it of items) {
          const m = /STEP#(\d+)/.exec(it.sk);
          if (m) byStep[parseInt(m[1], 10)] = it.status;
        }

        if (items.some(it => it.status === 'error')) {
          setError(t('processing.failed'));
          return; // stop polling
        }

        const doneCount = Object.values(byStep).filter(s => s === 'done').length;
        setCurrentStep(doneCount);

        if (doneCount >= 7) return; // shared redirect effect takes over
        timer = setTimeout(poll, 2500);
      } catch {
        if (!active) return;
        timer = setTimeout(poll, 3000); // transient network error — keep trying
      }
    };

    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [id, nonce]);

  // Elapsed timer
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => setElapsedMs(Date.now() - start), 100);
    return () => clearInterval(interval);
  }, [nonce]);

  // Auto-redirect to report after a short hold once complete
  useEffect(() => {
    if (currentStep < 7 || error) return;
    const t = setTimeout(() => navigate(`/report/${id}`), 1200);
    return () => clearTimeout(t);
  }, [currentStep, id, navigate, error]);

  const elapsed = formatElapsed(elapsedMs);

  const steps: { titleKey: TranslationKey; descKey: TranslationKey }[] = [
    { titleKey: 'processing.step.1.title', descKey: 'processing.step.1.desc' },
    { titleKey: 'processing.step.2.title', descKey: 'processing.step.2.desc' },
    { titleKey: 'processing.step.3.title', descKey: 'processing.step.3.desc' },
    { titleKey: 'processing.step.4.title', descKey: 'processing.step.4.desc' },
    { titleKey: 'processing.step.5.title', descKey: 'processing.step.5.desc' },
    { titleKey: 'processing.step.6.title', descKey: 'processing.step.6.desc' },
    { titleKey: 'processing.step.7.title', descKey: 'processing.step.7.desc' },
  ];

  const domainLabel = (d: string) =>
    t(`domain.${d}` as TranslationKey) || d;

  return (
    <div className="px-5 sm:px-8 py-10 max-w-[760px] mx-auto animate-fade-up">
      <h1 className="text-2xl font-bold title-premium text-center mb-2">
        {t('processing.heading')}
      </h1>
      <p className="text-sm text-ink-muted text-center mb-8">
        {t('processing.subheading')}
      </p>

      {error && (
        <div className="bg-bad-bg text-bad-text rounded-xl px-4 py-3 mb-6 flex items-start gap-2 text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>{error}</span>
            {API_ENABLED && (
              <div className="mt-2">
                <button
                  onClick={retry}
                  disabled={retrying}
                  className="btn-gradient inline-flex items-center gap-1.5 disabled:opacity-60 disabled:pointer-events-none text-xs px-3 py-1.5"
                >
                  {retrying && <Loader2 size={12} className="animate-spin" />}
                  {t('processing.retry')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Project header card */}
      {project && (
        <div className="glass-card rounded-2xl px-5 py-4 mb-8 flex items-center gap-3 card-lift animate-scale-in">
          <div className="w-10 h-10 rounded-lg glass-card flex items-center justify-center text-primary">
            <FileText size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ink truncate">{project.title}</div>
            <div className="text-xs text-ink-muted mt-0.5">
              {project.domains.map(domainLabel).join(' · ')}
              {' · '}
              {t('processing.submitted_now')}
            </div>
          </div>
        </div>
      )}

      {/* Step list */}
      <ol className="relative pl-5">
        {/* Vertical track — base + animated gradient fill reflecting progress */}
        <div className="absolute left-[18px] top-2 bottom-2 w-px bg-ink/10" aria-hidden />
        <div
          className="absolute left-[18px] top-2 w-px transition-all duration-700 ease-premium"
          style={{
            height: `calc((100% - 16px) * ${currentStep / steps.length})`,
            background: 'linear-gradient(180deg, rgb(var(--c-signature-a)), rgb(var(--c-signature-b)))',
          }}
          aria-hidden
        />

        {steps.map((step, i) => {
          const state =
            i < currentStep ? 'done' :
            i === currentStep ? 'active' : 'pending';
          return (
            <li key={i} className="relative flex items-start gap-4 py-3 stagger-item" style={{ '--i': i } as React.CSSProperties}>
              <span className={[
                'shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold relative z-10 ring-4 ring-surface-subtle transition-all duration-300 ease-premium',
                state === 'done'   && 'bg-ok-bg text-ok-text animate-scale-in',
                state === 'active' && 'bg-primary-50 text-primary shadow-glow animate-glow-pulse',
                state === 'pending'&& 'bg-surface ring-surface-subtle text-ink-subtle ring-1 ring-ink/10',
              ].filter(Boolean).join(' ')}>
                {state === 'done'   && <Check size={14} strokeWidth={3} />}
                {state === 'active' && <Loader2 size={14} className="animate-spin" />}
                {state === 'pending'&& (i + 1)}
              </span>

              <div className="flex-1 min-w-0 pt-0.5">
                <div className={[
                  'text-sm font-semibold',
                  state === 'done'    && 'text-ink',
                  state === 'active'  && 'text-primary',
                  state === 'pending' && 'text-ink-muted',
                ].filter(Boolean).join(' ')}>
                  {t(step.titleKey)}
                  {state === 'active' && (
                    <span className="ml-2 text-xs font-medium text-primary/70">
                      {t('processing.in_progress')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                  {t(step.descKey)}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Elapsed + report button */}
      <div className="mt-8 text-center">
        <div className="text-xs text-ink-muted mb-4">
          {t('processing.elapsed')}: <span className="tabular-nums">{elapsed}</span>
        </div>
        <button
          onClick={() => navigate(`/report/${id}`)}
          disabled={currentStep < 7}
          className="btn-gradient disabled:opacity-50 disabled:pointer-events-none px-6 py-3"
        >
          {t('processing.report')}
        </button>
      </div>

      {/* Hidden accessibility hint */}
      <span className="sr-only" aria-live="polite">
        {lang === 'de' ? `Schritt ${Math.min(currentStep + 1, 7)} von 7` : `Step ${Math.min(currentStep + 1, 7)} of 7`}
      </span>
    </div>
  );
}

function formatElapsed(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}
