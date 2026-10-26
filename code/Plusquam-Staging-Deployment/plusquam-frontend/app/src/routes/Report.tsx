import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Download, Star, Trash2, Search, Copy, Check,
  ExternalLink, Loader2, FileDown,
} from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';
import type { TranslationKey } from '../i18n/translations';
import { getAssessment, localizeAssessment, type Assessment, type Paper } from '../data/mockAssessment';
import type { Project } from '../data/mockProjects';
import { useStarredProjects, useStarredPapers, toggleStarredProject, toggleStarredPaper, removeProjectEverywhere } from '../lib/starred';
import { useStatuses, getStatus, setStatus, seedStatuses, type ProjectStatus } from '../lib/status';
import { API_ENABLED, api } from '../lib/api';
import { getSessionUser } from '../lib/session';
import {
  EinordnungSection, PassformSection, LiteraturSection,
  AnspruchstabelleSection, ForschungsluekenSection,
  NeuheitsgradSection, FazitSection,
} from '../components/report/sections';

type SectionId =
  | 'einordnung' | 'passform' | 'literatur'
  | 'anspruchstabelle' | 'forschungslucken'
  | 'neuheitsgrad' | 'fazit';

const SECTIONS: { id: SectionId; key: TranslationKey }[] = [
  { id: 'einordnung',       key: 'report.sections.einordnung' },
  { id: 'passform',         key: 'report.sections.passform' },
  { id: 'literatur',        key: 'report.sections.literatur' },
  { id: 'anspruchstabelle', key: 'report.sections.anspruchstabelle' },
  { id: 'forschungslucken', key: 'report.sections.forschungslucken' },
  { id: 'neuheitsgrad',     key: 'report.sections.neuheitsgrad' },
  { id: 'fazit',            key: 'report.sections.fazit' },
];

export default function Report() {
  const { t, lang } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();

  const [raw, setRaw] = useState<Assessment | null>(null);
  const [assessmentLoadError, setAssessmentLoadError] = useState(false);
  // Localized view: prose switches with the language toggle (chrome already does).
  const assessment = useMemo(
    () => (raw ? localizeAssessment(raw, lang) : null),
    [raw, lang]
  );
  const [active, setActive] = useState<SectionId>('anspruchstabelle');
  const [highlightedPaper, setHighlightedPaper] = useState<number | null>(null);

  // Decision uses the shared status store; comment stays local until saved.
  const [comment, setComment] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function downloadPdf() {
    if (downloading) return;
    setDownloadError(null);
    if (!API_ENABLED) {
      // Pure local demo: there is no server to render a formatted PDF.
      setDownloadError(t('report.pdf.demo_only'));
      return;
    }    setDownloading(true);
    try {
      const blob = await api.getReportPdf(id, lang);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plusquam-${id}-${lang}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.warn('[plusquam] pdf download failed:', e);
      setDownloadError(t('report.pdf.failed'));
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('report.delete.confirm'))) return;
    // Remove local traces regardless of backend outcome.
    removeProjectEverywhere(id);
    try { localStorage.removeItem(`plusquam_checklist_${id}`); } catch { /* ignore */ }
    if (!API_ENABLED) { navigate('/'); return; }
    try {
      await api.deleteProjectSmart(id);
      navigate('/');
    } catch (e) {
      console.warn('[plusquam] delete failed:', e);
      setDownloadError(t('report.delete.failed'));
    }
  }

  useStatuses(); // re-render on status change
  const decision = getStatus(id);

  // Seed this project's review status + comment from the server.
  useEffect(() => {
    if (!API_ENABLED) return;
    let active = true;
    const loadProject = async () => {
      try {
        // Admins should use the admin-scoped endpoint directly. Calling the
        // owner-scoped endpoint first is expected to return 404 for another
        // user's project and creates a misleading error in the browser console.
        const p = getSessionUser()?.role === 'admin'
          ? (await api.admin.listAllProjects()).find(project => project.id === id)
          : await api.getProject(id);
        if (!active || !p) return;
        if (p.title) setProjectTitle(p.title);
        if (p.reviewStatus) seedStatuses({ [id]: p.reviewStatus as ProjectStatus });
        if (typeof p.reviewComment === 'string') setComment(p.reviewComment);
      } catch {
        // Keep the page usable if optional project metadata is unavailable.
      }
    };
    void loadProject();
    return () => { active = false; };
  }, [id]);

  async function saveReview() {
    setSaved(false);
    if (API_ENABLED) {
      setSaving(true);
      try {
        await api.saveProjectReview(id, { reviewStatus: getStatus(id), reviewComment: comment });
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      } catch (e) {
        console.warn('[plusquam] review save failed:', e);
      } finally {
        setSaving(false);
      }
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  // Paper filters (default: last 10 years, sorted by relevance)
  const [filterType, setFilterType] = useState<'all' | Paper['type']>('all');
  const [yearsBack, setYearsBack] = useState<number>(10); // 0 = all years
  const [sortBy, setSortBy] = useState<'relevance' | 'citations' | 'year'>('relevance');

  const visiblePapers = useMemo(() => {
    const arr = assessment?.papers ? [...assessment.papers] : [];
    const minYear = yearsBack ? new Date().getFullYear() - yearsBack : 0;
    const filtered = arr.filter(p =>
      (filterType === 'all' || p.type === filterType) && (!yearsBack || p.year >= minYear)
    );
    filtered.sort((a, b) =>
      sortBy === 'citations' ? b.citations - a.citations
      : sortBy === 'year'    ? b.year - a.year
      :                        b.relevance - a.relevance
    );
    return filtered;
  }, [assessment, filterType, yearsBack, sortBy]);

  const starredProjects = useStarredProjects();
  const starredPapersList = useStarredPapers();
  const projectStarred = starredProjects.some(p => p.id === id);
  const starredPaperIds = new Set(starredPapersList.filter(p => p.projectId === id).map(p => p.id));

  // Project context (from the New Project hand-off) for starring + Library display.
  const stored = (() => {
    try { return JSON.parse(sessionStorage.getItem(`plusquam_project_${id}`) || 'null'); }
    catch { return null; }
  })();
  const projectName: string = projectTitle || stored?.title || `Project ${id}`;

  useEffect(() => {
    let cancelled = false;
    setRaw(null);
    setAssessmentLoadError(false);
    getAssessment(id)
      .then(a => { if (!cancelled) setRaw(a); })
      .catch(err => {
        console.warn('[plusquam] live assessment could not be loaded:', err);
        if (!cancelled) setAssessmentLoadError(true);
      });
    return () => { cancelled = true; };
  }, [id]);

  function onCite(paperId: number) {
    setHighlightedPaper(paperId);
    document.getElementById(`paper-${paperId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function copySection() {
    const el = document.getElementById('report-section-body');
    const text = el?.innerText ?? '';
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function toggleProjectStar() {
    const project: Project = {
      id,
      name: projectName,
      clientId: stored?.reference || id.toUpperCase(),
      domain: (stored?.domains?.[0] ?? 'AI/ML') as Project['domain'],
      submittedAt: stored?.submittedAt || new Date().toISOString(),
      noveltyScore: assessment?.neuheitsgrad?.overall ?? null,
      status: 'complete',
    };
    toggleStarredProject(project);
  }

  if (!assessment) {
    if (assessmentLoadError) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16">
          <p className="text-sm text-bad-text mb-4" role="alert">
            {lang === 'de'
              ? 'Das Live-Ergebnis konnte nicht geladen werden. Es werden keine Demodaten angezeigt.'
              : 'The live assessment could not be loaded. Demo results are not shown.'}
          </p>
          <button onClick={() => navigate('/')} className="btn-gradient px-4 py-2 text-sm">
            {lang === 'de' ? 'Zum Dashboard' : 'Back to dashboard'}
          </button>
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center text-ink-muted animate-fade-in">
        <Loader2 className="animate-spin mr-2" size={18} />
        {t('report.results')}…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[230px_1fr] min-h-full">
      {/* ─── Section nav + actions ────────────────────────────────── */}
      <nav className="border-r border-ink/5 bg-surface px-3 py-6 flex flex-col">
        <div className="text-[11px] font-bold tracking-wider text-ink-subtle uppercase px-3 mb-2">
          {t('report.sections_label')}
        </div>
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={[
              'block w-full text-left px-3 py-2 rounded-lg text-sm font-medium border-l-2',
              'transition-all duration-200 ease-premium',
              active === s.id
                ? 'bg-primary-50 text-primary border-primary translate-x-0.5'
                : 'text-ink-soft border-transparent hover:bg-surface-hover hover:text-ink hover:translate-x-0.5',
            ].join(' ')}
          >
            {t(s.key)}
          </button>
        ))}

        <div className="mt-6 px-3 text-[11px] font-bold tracking-wider text-ink-subtle uppercase mb-2">
          {t('report.actions')}
        </div>
        <ActionButton icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copySection}>
          {copied ? t('report.action.copied') : t('report.action.copy')}
        </ActionButton>
        <ActionButton
          icon={downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          onClick={downloadPdf}
        >
          {t('report.action.download')}
        </ActionButton>
        <ActionButton
          icon={downloading ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
          onClick={downloadPdf}
        >
          {t('report.action.download_all')}
        </ActionButton>
        <ActionButton
          icon={<Star size={14} className={projectStarred ? 'fill-current' : ''} />}
          onClick={toggleProjectStar}
          active={projectStarred}
        >
          {t('report.action.star')}
        </ActionButton>
        <ActionButton icon={<Trash2 size={14} />} danger onClick={handleDelete}>
          {t('report.action.delete')}
        </ActionButton>
        {downloadError && (
          <p className="px-3 mt-1 text-xs text-warn-text leading-snug">{downloadError}</p>
        )}

        {/* Status decision + comment + save */}
        <div className="mt-6 px-3 text-[11px] font-bold tracking-wider text-ink-subtle uppercase mb-2">
          {t('report.status.decision')}
        </div>
        <div className="px-2 space-y-2">
          <div className="flex gap-1">
            {(['pq_approve', 'pq_reject'] as const).map(d => (
              <button
                key={d}
                onClick={() => setStatus(id, decision === d ? 'none' : d)}
                className={[
                  'flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                  decision === d
                    ? d === 'pq_approve'
                      ? 'bg-ok-bg text-ok-text border-ok-text/30'
                      : 'bg-bad-bg text-bad-text border-bad-text/30'
                    : 'bg-surface text-ink-muted border-ink/10 hover:border-ink/20',
                ].join(' ')}
              >
                {t(`status.${d}` as TranslationKey)}
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={t('report.comment.placeholder')}
            rows={2}
            className="w-full px-2.5 py-2 text-xs bg-surface-subtle border border-ink/10 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/20 resize-y"
          />
          <button
            onClick={saveReview}
            disabled={saving}
            className="btn-gradient w-full disabled:opacity-60 disabled:pointer-events-none text-xs px-3 py-1.5 rounded-lg"
          >
            {saving ? '…' : saved ? t('report.action.saved') : t('report.action.save')}
          </button>
        </div>
      </nav>

      {/* ─── Active section + References, always stacked ───────────── */}
      <div className="min-w-0 flex flex-col">
        <main className="px-6 lg:px-8 py-6 min-w-0">
          <header className="mb-5">
            <h1 className="text-xl font-bold title-premium mb-1">{t(SECTIONS.find(s => s.id === active)!.key)}</h1>
          </header>

          <div id="report-section-body" key={active} className="animate-fade-up">
            {active === 'einordnung'       && <EinordnungSection       assessment={assessment} onCite={onCite} />}
            {active === 'passform'         && <PassformSection         assessment={assessment} onCite={onCite} />}
            {active === 'literatur'        && <LiteraturSection        assessment={assessment} onCite={onCite} />}
            {active === 'anspruchstabelle' && <AnspruchstabelleSection assessment={assessment} onCite={onCite} />}
            {active === 'forschungslucken' && <ForschungsluekenSection assessment={assessment} onCite={onCite} />}
            {active === 'neuheitsgrad'     && <NeuheitsgradSection     assessment={assessment} onCite={onCite} />}
            {active === 'fazit'            && <FazitSection            assessment={assessment} onCite={onCite} />}
          </div>
        </main>

        {/* ─── References panel — always below the section content ── */}
        <aside className="border-t border-ink/5 bg-surface flex flex-col">
          <header className="px-5 py-4 border-b border-ink/5 flex items-center gap-3">
            <h2 className="text-sm font-bold text-ink">{t('report.references')}</h2>
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="search"
                placeholder={t('table.search_placeholder')}
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-surface-subtle border border-ink/10 rounded-pill focus:outline-hidden focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </header>

          {/* Paper filters */}
          <div className="px-3 py-2 border-b border-ink/5 flex flex-wrap gap-2">
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value as typeof filterType)}
              aria-label={t('report.filter.type')}
              className="text-[11px] bg-surface-subtle border border-ink/10 rounded-lg px-2 py-1 text-ink-soft focus:outline-hidden"
            >
              <option value="all">{t('report.filter.type')}: {t('report.filter.all')}</option>
              <option value="systematic_review">{t('report.papertype.systematic_review')}</option>
              <option value="review">{t('report.papertype.review')}</option>
              <option value="highly_cited">{t('report.papertype.highly_cited')}</option>
              <option value="experimental">{t('report.papertype.experimental')}</option>
            </select>
            <select
              value={yearsBack}
              onChange={e => setYearsBack(Number(e.target.value))}
              aria-label={t('report.filter.years')}
              className="text-[11px] bg-surface-subtle border border-ink/10 rounded-lg px-2 py-1 text-ink-soft focus:outline-hidden"
            >
              <option value={10}>{t('report.filter.years_10')}</option>
              <option value={0}>{t('report.filter.years_all')}</option>
            </select>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              aria-label={t('report.filter.sort')}
              className="text-[11px] bg-surface-subtle border border-ink/10 rounded-lg px-2 py-1 text-ink-soft focus:outline-hidden"
            >
              <option value="relevance">{t('report.filter.sort')}: {t('report.sort.relevance')}</option>
              <option value="citations">{t('report.filter.sort')}: {t('report.sort.citations')}</option>
              <option value="year">{t('report.filter.sort')}: {t('report.sort.year')}</option>
            </select>
          </div>

          <div className="px-5 py-3 border-b border-ink/5 flex items-center justify-between text-xs">
            <span className="font-bold tracking-wider text-ink-muted uppercase">{t('report.results')}</span>
            <span className="text-ink-muted">{visiblePapers.length}</span>
          </div>

          <ol className="px-3 py-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
            {visiblePapers.map(paper => (
              <PaperCard
                key={paper.id}
                paper={paper}
                highlighted={highlightedPaper === paper.id}
                starred={starredPaperIds.has(paper.id)}
                onStar={() => toggleStarredPaper(paper, id, projectName)}
              />
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

/* ─── atoms ────────────────────────────────────────────────── */

function ActionButton({
  icon, children, onClick, danger, active,
}: { icon: React.ReactNode; children: React.ReactNode; onClick?: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm font-medium mb-1',
        'transition-all duration-200 ease-premium hover:translate-x-0.5',
        danger
          ? 'text-bad-text hover:bg-bad-bg/50'
          : active
            ? 'text-primary bg-primary-50'
            : 'text-ink-soft hover:bg-surface-hover hover:text-ink',
      ].join(' ')}
    >
      {icon}
      {children}
    </button>
  );
}

function PaperCard({
  paper, highlighted, starred, onStar,
}: { paper: Paper; highlighted: boolean; starred: boolean; onStar: () => void }) {
  const { t } = useTranslation();
  const open = () => paper.pdfUrl && window.open(paper.pdfUrl, '_blank', 'noopener,noreferrer');
  return (
    <li
      id={`paper-${paper.id}`}
      className={[
        'rounded-xl p-4 ring-1 transition-colors',
        highlighted
          ? 'bg-primary-50 ring-primary-200'
          : 'bg-surface-subtle ring-ink/5',
      ].join(' ')}
    >
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-xs font-bold text-ink-subtle">{paper.id}</span>
        <h3 className="text-sm font-semibold text-ink leading-snug flex-1">{paper.title}</h3>
        <button
          onClick={onStar}
          aria-label={t('report.action.star')}
          className={['shrink-0 p-1 rounded-sm transition-colors', starred ? 'text-primary' : 'text-ink-subtle hover:text-ink'].join(' ')}
        >
          <Star size={14} className={starred ? 'fill-current' : ''} />
        </button>
      </div>
      <div className="text-[11px] text-ink-muted mb-3">
        {paper.year} · {paper.citations} {t('report.citations')} · {paper.authors}
      </div>
      <div className="text-xs text-ink-soft leading-relaxed mb-3">
        <span className="text-[10px] font-bold text-ink-muted uppercase tracking-wider">{t('report.key_takeaway')} · </span>
        {paper.keyTakeaway}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <PaperTypeBadge type={paper.type} />
        <RelevanceBadge value={paper.relevance} />
        {paper.pdfUrl && (
          <button
            onClick={open}
            className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-hover"
          >
            <ExternalLink size={11} /> {t('report.action.open')}
          </button>
        )}
      </div>
    </li>
  );
}

function PaperTypeBadge({ type }: { type: Paper['type'] }) {
  const { t } = useTranslation();
  const key = type === 'systematic_review' ? 'report.papertype.systematic_review'
            : type === 'review'             ? 'report.papertype.review'
            : type === 'highly_cited'       ? 'report.papertype.highly_cited'
            :                                  'report.papertype.experimental';
  return (
    <span className="bg-ok-bg text-ok-text px-2 py-0.5 rounded-sm text-[10px] font-bold tracking-wider uppercase">
      {t(key as TranslationKey)}
    </span>
  );
}

function RelevanceBadge({ value }: { value: number }) {
  const { t } = useTranslation();
  return (
    <span className="bg-warn-bg text-warn-text px-2 py-0.5 rounded-sm text-[10px] font-bold">
      {(value ?? 0).toFixed(2)} {t('report.relevance')}
    </span>
  );
}
