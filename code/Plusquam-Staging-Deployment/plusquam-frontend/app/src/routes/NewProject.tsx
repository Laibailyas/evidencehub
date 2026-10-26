import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Loader2, Upload, X } from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';
import type { TranslationKey } from '../i18n/translations';
import { projectSubmitErrorKey } from '../lib/apiErrors';
import { API_ENABLED, api, type UploadPayload } from '../lib/api';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // backend cap; base64 request stays below API limits

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(f);
  });
}

const DOMAINS = [
  { id: 'ai_ml',         key: 'domain.ai_ml' },
  { id: 'software',      key: 'domain.software' },
  { id: 'cybersecurity', key: 'domain.cybersecurity' },
  { id: 'iot',           key: 'domain.iot' },
  { id: 'robotics',      key: 'domain.robotics' },
  { id: 'renewable',     key: 'domain.renewable' },
  { id: 'emobility',     key: 'domain.emobility' },
  { id: 'chemistry',     key: 'domain.chemistry' },
  { id: 'materials',     key: 'domain.materials' },
  { id: 'medical',       key: 'domain.medical' },
  { id: 'environmental', key: 'domain.environmental' },
  { id: 'logistics',     key: 'domain.logistics' },
  { id: 'product',       key: 'domain.product' },
] as const;

export default function NewProject() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [reference, setReference] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const charCount = description.length;

  // Live input-quality heuristics (lightweight; the real assessment runs server-side)
  const quality = useMemo(() => {
    // Title clarity: rewarded for length 5–14 words and presence of technical terms
    const titleWords = title.trim().split(/\s+/).filter(Boolean).length;
    const hasTech    = /\b(AI|ML|neural|quantum|adaptive|control|hybrid|reinforcement|MPPT|photovoltaic|bifacial)\b/i.test(title);
    const titleScore = Math.round(Math.min(100,
      (titleWords >= 5 && titleWords <= 14 ? 70 : Math.max(20, 70 - Math.abs(titleWords - 9) * 6)) +
      (hasTech ? 25 : 0)
    ));

    // Description length: target 3000 characters
    const lenScore = Math.round(Math.min(100, (charCount / 3000) * 100));

    // Technical specificity: count technical signals
    const signals = [
      /\b(algorithm|method|methodolog|architecture|model|framework)\b/i,
      /\b(measure|metric|benchmark|evaluat|experiment|test)\b/i,
      /\b(uncertain|generalis|generalize|robust|novel|hypothes)\b/i,
      /\b(materials?|composit|substrat|catalyst|electrolyt|coating)\b/i,
      /\d/,
    ];
    const hits = signals.reduce((n, re) => n + (re.test(description) ? 1 : 0), 0);
    const techScore = Math.round((hits / signals.length) * 100);

    return { titleScore, lenScore, techScore };
  }, [title, description, charCount]);

  const canSubmit = title.trim().length >= 5 && description.trim().length >= 50 && domains.length > 0;

  function toggleDomain(id: string) {
    setDomains(d => (d.includes(id) ? d.filter(x => x !== id) : [...d, id]));
  }

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submit() {
    if (!canSubmit || submitting) return;
    setSubmitError(null);

    if (API_ENABLED) {
      setSubmitting(true);
      try {
        let upload: UploadPayload | undefined;
        if (file) {
          if (file.size > MAX_UPLOAD_BYTES) {
            setSubmitError(t('form.upload.too_large'));
            setSubmitting(false);
            return;
          }
          upload = {
            filename: file.name,
            contentType: file.type || '',
            dataBase64: await fileToBase64(file),
          };
        }
        const project = await api.createProject({ title, description, domains, reference, upload });
        sessionStorage.setItem(`plusquam_project_${project.id}`, JSON.stringify({
          id: project.id, title, description, domains, reference,
          submittedAt: new Date().toISOString(),
        }));
        await api.startAssessment(project.id);
        navigate(`/processing/${project.id}`);
        return;
      } catch (err) {
        console.error('[plusquam] create/assess failed:', err);
        setSubmitError(t(projectSubmitErrorKey(err)));
        setSubmitting(false);
        return;
      }
    }

    // MOCK fallback: stash form data, Processing animates, Report reads the same id.
    const id = 'p' + Date.now().toString(36);
    sessionStorage.setItem(`plusquam_project_${id}`, JSON.stringify({
      id, title, description, domains, reference,
      submittedAt: new Date().toISOString(),
    }));
    navigate(`/processing/${id}`);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] min-h-full">
      {/* ─── Main column ────────────────────────────────────────────── */}
      <div className="px-5 sm:px-8 lg:px-12 py-8 max-w-[760px] animate-fade-up">
        <h1 className="text-2xl font-bold title-premium mb-1">{t('form.heading')}</h1>
        <p className="text-sm text-ink-muted mb-8">{t('form.subheading')}</p>

        {/* Title */}
        <Field label={<>{t('form.title.label')} <span className="text-bad-text">*</span></>}>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full px-4 py-3 bg-surface-subtle border border-ink/10 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm transition-all duration-200"
          />
        </Field>

        {/* Description */}
        <Field
          label={t('form.description.label')}
          hint={t('form.description.hint')}
          rightHint={
            <span className={charCount < 3000 ? 'text-warn-text' : 'text-ok-text'}>
              {t('form.description.counter').replace('{count}', String(charCount))}
            </span>
          }
        >
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={6}
            className="w-full px-4 py-3 bg-surface border border-ink/10 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm font-normal resize-y transition-all duration-200"
          />
        </Field>

        {/* Domain chips */}
        <Field label={t('form.domain.label')}>
          <div className="flex flex-wrap gap-2">
            {DOMAINS.map(d => {
              const active = domains.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggleDomain(d.id)}
                  aria-pressed={active}
                  className={[
                    'px-3.5 py-1.5 rounded-pill text-xs font-semibold border',
                    'transition-all duration-200 ease-premium hover:scale-105 active:scale-95',
                    active
                      ? 'bg-primary-50 text-primary border-primary-200 shadow-glow scale-105'
                      : 'bg-surface text-ink-soft border-ink/10 hover:border-ink/20',
                  ].join(' ')}
                >
                  {t(d.key as TranslationKey)}
                </button>
              );
            })}
          </div>
        </Field>

        {/* Reference */}
        <Field label={t('form.reference.label')}>
          <input
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder={t('form.reference.placeholder')}
            className="w-full max-w-xs px-4 py-3 bg-surface border border-ink/10 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm"
          />
        </Field>

        {/* Optional document upload (.docx/.pdf) — parsed in the backend phase */}
        <Field label={t('form.upload.label')} hint={t('form.upload.hint')}>
          {file ? (
            <div className="flex items-center gap-3 px-4 py-3 bg-surface border border-ink/10 rounded-xl text-sm max-w-md">
              <Upload size={16} className="text-primary shrink-0" />
              <span className="flex-1 truncate text-ink">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} className="text-ink-subtle hover:text-bad-text" aria-label="remove">
                <X size={16} />
              </button>
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 px-4 py-3 bg-surface border border-dashed border-ink/20 rounded-xl text-sm text-ink-soft cursor-pointer hover:border-primary/40 hover:text-ink transition-colors">
              <Upload size={16} />
              {t('form.upload.cta')}
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={e => {
                  const selected = e.target.files?.[0] ?? null;
                  const ext = selected?.name.toLowerCase().split('.').pop();
                  if (selected && (selected.size > MAX_UPLOAD_BYTES || !['pdf', 'docx'].includes(ext ?? ''))) {
                    setFile(null);
                    setSubmitError(selected.size > MAX_UPLOAD_BYTES ? t('form.upload.too_large') : t('form.upload.invalid'));
                  } else {
                    setSubmitError(null);
                    setFile(selected);
                  }
                }}
              />
            </label>
          )}
        </Field>
      </div>

      {/* ─── Right column ───────────────────────────────────────────── */}
      <aside className="glass-card rounded-none! border-l border-ink/5 px-6 py-8 space-y-8 animate-fade-up" style={{ animationDelay: '120ms' }}>
        {/* Input Quality */}
        <section>
          <h3 className="text-sm font-bold text-ink mb-1">{t('form.quality.title')}</h3>
          <p className="text-xs text-ink-muted mb-4">{t('form.quality.subtitle')}</p>

          <QualityBar label={t('form.quality.title_clarity')}        value={quality.titleScore} />
          <QualityBar label={t('form.quality.description_length')}    value={quality.lenScore} />
          <QualityBar label={t('form.quality.technical_specificity')} value={quality.techScore} />

          <div className="mt-5 rounded-xl bg-primary/10 px-4 py-3 text-xs leading-relaxed card-lift">
            <span className="font-bold text-primary">{t('form.quality.tip_label')} </span>
            <span className="text-ink-soft">{t('form.quality.tip')}</span>
          </div>
        </section>

        {/* Next steps */}
        <section>
          <h3 className="text-sm font-bold text-ink mb-3">{t('form.next.title')}</h3>
          <NextStep n="01" text={t('form.next.1')} i={0} />
          <NextStep n="02" text={t('form.next.2')} i={1} />
          <NextStep n="03" text={t('form.next.3')} i={2} />
        </section>

        {/* Submit */}
        <section className="pt-2">
          {submitError && (
            <p role="alert" className="text-xs text-bad-text mb-2">{submitError}</p>
          )}
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className="btn-gradient w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none px-6 py-3"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            {t('form.submit')}
          </button>
          <p className="flex items-center justify-center gap-2 text-xs text-ink-muted mt-3">
            <Lock size={12} className="text-primary" />
            {t('form.eu_notice')}
          </p>
        </section>
      </aside>
    </div>
  );
}

/* ─── small atoms ───────────────────────────────────────────── */

function Field({
  label, hint, rightHint, children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  rightHint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-ink mb-2">{label}</label>
      {children}
      {(hint || rightHint) && (
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs text-ink-muted">{hint}</p>
          {rightHint && <p className="text-xs text-ink-muted">{rightHint}</p>}
        </div>
      )}
    </div>
  );
}

function QualityBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-ink-soft font-medium">{label}</span>
        <span className="text-primary font-bold tabular-nums">{value}%</span>
      </div>
      <div className="h-1.5 bg-primary-50 rounded-pill overflow-hidden">
        <div
          className="h-full bg-primary rounded-pill transition-[width] duration-700 ease-premium"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function NextStep({ n, text, i = 0 }: { n: string; text: string; i?: number }) {
  return (
    <div
      className="flex gap-3 px-4 py-3 rounded-xl glass-card mb-2 card-lift stagger-item"
      style={{ '--i': i } as React.CSSProperties}
    >
      <span className="text-xs font-bold text-primary tabular-nums shrink-0">{n}</span>
      <span className="text-xs text-ink-soft leading-relaxed">{text}</span>
    </div>
  );
}
