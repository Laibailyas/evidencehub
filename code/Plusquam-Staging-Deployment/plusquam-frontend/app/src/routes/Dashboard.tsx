import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search, MoreHorizontal, ArrowUp, ArrowDown, ChevronsUpDown,
  ExternalLink, Star, Trash2, Check, ChevronDown,
} from 'lucide-react';
import StatCard from '../components/StatCard';
import { StatusMenu } from '../components/StatusMenu';
import { useTranslation } from '../i18n/useTranslation';
import type { TranslationKey } from '../i18n/translations';
import { useStarredProjects, toggleStarredProject, removeProjectEverywhere } from '../lib/starred';
import {
  useStatuses, getStatus, setStatus, seedStatuses,
  USER_STATUSES, BSFZ_STATUSES, type ProjectStatus,
} from '../lib/status';
import {
  mockProjects,
  computeStats,
  TOTAL_PROJECT_COUNT,
  type Project,
} from '../data/mockProjects';
import { API_ENABLED, api, type ProjectRecord } from '../lib/api';
import { getSessionUser } from '../lib/session';

const BSFZ_SET = new Set(['bsfz_submitted', 'bsfz_approved', 'bsfz_rejected']);

/** Earliest moment a project entered any BSFZ stage = its submission time.
 *  Falls back to reviewStatusAt for legacy records written before statusHistory. */
function submissionTimestamp(r: ProjectRecord): string | null {
  const bsfz = (r.statusHistory ?? [])
    .filter(h => BSFZ_SET.has(h.status) && h.at)
    .map(h => h.at)
    .sort();
  if (bsfz.length) return bsfz[0];
  if (r.reviewStatus && BSFZ_SET.has(r.reviewStatus) && r.reviewStatusAt) return r.reviewStatusAt;
  return null;
}

/** Average elapsed days from createdAt → submission across submitted projects. */
function avgDaysToSubmission(records: ProjectRecord[]): { days: number; count: number } | null {
  const durations: number[] = [];
  for (const r of records) {
    const sub = submissionTimestamp(r);
    if (!sub || !r.createdAt) continue;
    const ms = new Date(sub).getTime() - new Date(r.createdAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) durations.push(ms);
  }
  if (!durations.length) return null;
  const avgMs = durations.reduce((s, d) => s + d, 0) / durations.length;
  return { days: avgMs / 86_400_000, count: durations.length };
}

function fmtDays(d: number): string {
  return d >= 10 ? String(Math.round(d)) : String(Math.round(d * 10) / 10);
}

// Adapt a live API project record to the table's Project shape.
function toProject(r: ProjectRecord & { noveltyScore?: number | null }): Project {
  return {
    id:           r.id,
    name:         r.title,
    clientId:     r.reference || r.id.toUpperCase(),
    domain:       (r.domains?.[0] ?? 'AI/ML') as Project['domain'],
    submittedAt:  r.createdAt ?? new Date().toISOString(),
    noveltyScore: r.noveltyScore ?? null,
    status:       r.status === 'complete' ? 'complete' : r.status === 'error' ? 'error' : 'processing',
  };
}

function liveStats(ps: Project[]) {
  const done = ps.filter(p => p.status === 'complete' && p.noveltyScore != null);
  const avg = done.length
    ? Math.round(done.reduce((s, p) => s + (p.noveltyScore ?? 0), 0) / done.length)
    : 0;
  return {
    total: ps.length,
    addedThisMonth: ps.length,
    avg,
    high: done.filter(p => (p.noveltyScore ?? 0) >= 61).length,
    processing: ps.filter(p => p.status === 'processing').length,
  };
}

export default function Dashboard() {
  const { t, lang } = useTranslation();
  const [params] = useSearchParams();
  const isEmpty = params.get('empty') === '1';

  // Live records when API is configured; staging must never silently show demo data.
  const [liveRecords, setLiveRecords] = useState<ProjectRecord[] | null>(null);
  const [liveLoadState, setLiveLoadState] = useState<'loading' | 'loaded' | 'error'>(
    API_ENABLED ? 'loading' : 'loaded'
  );

  useEffect(() => {
    if (!API_ENABLED) return;
    let active = true;
    api.listProjects()
      .then(recs => {
        if (!active) return;
        setLiveRecords(recs);
        setLiveLoadState('loaded');
        seedStatuses(Object.fromEntries(
          recs.map(r => [r.id, (r.reviewStatus ?? 'none') as ProjectStatus])
        ));
      })
      .catch(err => {
        console.warn('[plusquam] project list fetch failed:', err);
        if (active) setLiveLoadState('error');
      });
    return () => { active = false; };
  }, []);

  const usingLive = API_ENABLED && liveLoadState === 'loaded' && liveRecords !== null;
  const liveProjects = useMemo(
    () => (liveRecords ? liveRecords.map(toProject) : []),
    [liveRecords]
  );
  const projects = isEmpty ? [] : API_ENABLED ? (usingLive ? liveProjects : []) : mockProjects;
  const totalCount = isEmpty ? 0 : API_ENABLED ? (usingLive ? liveProjects.length : 0) : TOTAL_PROJECT_COUNT;

  const stats = useMemo(
    () =>
      isEmpty
        ? { total: 0, addedThisMonth: 0, avg: 0, high: 0, processing: 0 }
        : API_ENABLED
          ? liveStats(projects)
          : computeStats(projects),
    [isEmpty, usingLive, projects]
  );

  const statusMap = useStatuses();
  const kpis = useMemo(() => {
    const vals = Object.values(statusMap);
    return {
      pqApprove:    vals.filter(v => v === 'pq_approve').length,
      bsfzApproved: vals.filter(v => v === 'bsfz_approved').length,
    };
  }, [statusMap]);

  const tts = useMemo(
    () => (usingLive && !isEmpty ? avgDaysToSubmission(liveRecords!) : null),
    [usingLive, isEmpty, liveRecords]
  );

  const user = getSessionUser();
  const greetName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || '';

  return (
    <div className="px-5 sm:px-8 py-6 max-w-[1400px] mx-auto">
      {/* Hero banner */}
      <div className="gradient-border mb-6 animate-fade-up">
        <div className="glass-card rounded-2xl! px-6 sm:px-8 py-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative overflow-hidden">
          <div className="pointer-events-none absolute -right-16 -top-16 w-64 h-64 rounded-full bg-linear-to-br from-primary/15 to-[rgb(var(--c-signature-b))]/10 blur-3xl" />
          <div className="relative">
            <div className="text-xs font-semibold tracking-wider text-ink-muted uppercase mb-1">{t('nav.workspace')}</div>
            <h1 className="text-2xl sm:text-3xl font-bold title-premium">
              {greetName ? `${t('common.welcome')}, ${greetName}` : t('table.title')}
            </h1>
          </div>
          <Link to="/new-project" className="btn-gradient relative flex items-center gap-2 px-5 py-3 text-sm shrink-0">
            {t('nav.new_project')}
          </Link>
        </div>
      </div>

      {/* Bento stats: one hero metric + supporting tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <div className="lg:col-span-2 lg:row-span-2">
          <StatCard
            index={0}
            size="lg"
            label={t('stats.avg_score')}
            value={
              <div className="flex items-baseline gap-4">
                <span className="text-signature"><CountUpPlain value={stats.avg} /></span>
                {!isEmpty && <ScoreDial value={stats.avg} large />}
              </div>
            }
            caption={isEmpty ? undefined : t('stats.of_100')}
            className="h-full"
          />
        </div>
        <StatCard
          index={1}
          label={t('stats.total_assessed')}
          value={stats.total}
          caption={isEmpty ? undefined : `+${stats.addedThisMonth} ${t('stats.this_month')}`}
        />
        <StatCard
          index={2}
          label={t('stats.processing')}
          value={stats.processing}
          accent="primary"
          caption={isEmpty ? undefined : t('stats.running_now')}
        />
        <StatCard
          index={3}
          label={t('stats.high_novelty')}
          value={stats.high}
          accent="ok"
          caption={isEmpty ? undefined : t('stats.score_range')}
        />
        <StatCard index={4} label={t('stats.pq_approve')} value={kpis.pqApprove} accent="ok" />
      </div>

      {/* KPI row (status-derived; time-based KPI populates once BSFZ dates exist) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <StatCard index={5} label={t('stats.bsfz_approved')} value={kpis.bsfzApproved} accent="ok" />
        <StatCard
          index={6}
          label={t('stats.time_to_submission')}
          value={tts ? fmtDays(tts.days) : '—'}
          caption={tts ? `${t('stats.avg_days')} · ${tts.count}` : t('stats.no_submissions')}
        />
      </div>

      {/* Projects card */}
      <section className="glass-card rounded-2xl overflow-hidden animate-fade-up" style={{ animationDelay: '260ms' }}>
        <div className="flex items-center justify-between gap-4 p-5 border-b border-ink/5">
          <h2 className="heading-accent text-lg font-bold title-premium">{t('table.title')}</h2>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                type="search"
                placeholder={t('table.search_placeholder')}
                className="pl-9 pr-4 py-2 text-sm bg-surface-subtle border border-ink/10 rounded-pill focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary w-64"
              />
            </div>
            <span className="text-xs text-ink-muted">
              {totalCount} {t('common.total')}
            </span>
          </div>
        </div>

        {API_ENABLED && liveLoadState === 'loading' ? (
          <div className="px-5 py-10 text-center text-sm text-ink-muted" role="status">
            {lang === 'de' ? 'Projekte werden geladen…' : 'Loading live projects…'}
          </div>
        ) : API_ENABLED && liveLoadState === 'error' ? (
          <div className="px-5 py-10 text-center text-sm text-bad-text" role="alert">
            {lang === 'de'
              ? 'Live-Projekte konnten nicht geladen werden. Bitte Seite aktualisieren.'
              : 'Could not load live projects. Please refresh the page.'}
          </div>
        ) : isEmpty || (usingLive && liveProjects.length === 0) ? (
          <EmptyState />
        ) : (
          <ProjectTable projects={projects} locale={lang} />
        )}
      </section>
    </div>
  );
}

/* ─── Project Table ─────────────────────────────────────────── */

type SortKey = 'name' | 'domain' | 'date' | 'score' | 'status';

const COLUMNS: { id: SortKey; key: TranslationKey }[] = [
  { id: 'name',   key: 'table.col.project' },
  { id: 'domain', key: 'table.col.domain' },
  { id: 'date',   key: 'table.col.submitted' },
  { id: 'score',  key: 'table.col.score' },
  { id: 'status', key: 'table.col.status' },
];

function ProjectTable({ projects, locale }: { projects: Project[]; locale: string }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const starredIds = new Set(useStarredProjects().map(p => p.id));

  const sorted = useMemo(() => {
    const arr = projects.filter(p => !hidden.has(p.id));
    const val = (p: Project): string | number => {
      switch (sort.key) {
        case 'name':   return p.name.toLowerCase();
        case 'domain': return p.domain;
        case 'date':   return p.submittedAt;
        case 'score':  return p.noveltyScore ?? -1;
        case 'status': return p.status;
      }
    };
    arr.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [projects, sort, hidden]);

  const toggleSort = (k: SortKey) =>
    setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));

  async function handleDelete(p: Project) {
    setMenuOpen(null);
    if (!window.confirm(t('report.delete.confirm'))) return;
    setHidden(h => new Set(h).add(p.id));          // optimistic hide
    removeProjectEverywhere(p.id);                 // drop from Starred/Bibliothek
    try { localStorage.removeItem(`plusquam_checklist_${p.id}`); } catch { /* ignore */ }
    if (!API_ENABLED) return;                       // mock mode: nothing to delete server-side
    try {
      await api.deleteProjectSmart(p.id);          // real delete (admin-aware)
    } catch (e) {
      console.warn('[plusquam] delete failed:', e);
      setHidden(h => { const n = new Set(h); n.delete(p.id); return n; });  // revert on failure
    }
  }

  return (
    <div className="overflow-x-auto" onClick={() => menuOpen && setMenuOpen(null)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
            {COLUMNS.map(c => (
              <th key={c.id} className="text-left px-5 py-3 font-semibold">
                <button
                  onClick={() => toggleSort(c.id)}
                  className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                >
                  {t(c.key)}
                  {sort.key === c.id
                    ? (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
                    : <ChevronsUpDown size={12} className="opacity-40" />}
                </button>
              </th>
            ))}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => (
            <tr
              key={p.id}
              className="border-t border-ink/5 hover:bg-surface-subtle transition-colors stagger-item"
              style={{ '--i': Math.min(i, 10) } as React.CSSProperties}
            >
              <td className="px-5 py-4">
                <Link to={p.status === 'complete' ? `/project/${p.id}` : `/processing/${p.id}`} className="block">
                  <div className="font-semibold text-ink">{p.name}</div>
                  <div className="text-xs text-ink-muted mt-0.5">{p.clientId}</div>
                </Link>
              </td>
              <td className="px-5 py-4"><DomainBadge domain={p.domain} /></td>
              <td className="px-5 py-4 text-ink-soft whitespace-nowrap">{formatDate(p.submittedAt, locale)}</td>
              <td className="px-5 py-4"><ScoreBadge score={p.noveltyScore} status={p.status} /></td>
              <td className="px-5 py-4">
                <StatusCell id={p.id} projectStatus={p.status} />
              </td>
              <td className="px-2 py-4 text-right pr-4" onClick={e => e.stopPropagation()}>
                <StatusMenu
                  open={menuOpen === p.id}
                  onClose={() => setMenuOpen(null)}
                  align="right"
                  width={176}
                  trigger={({ ref }) => (
                    <button
                      ref={ref}
                      onClick={() => setMenuOpen(o => (o === p.id ? null : p.id))}
                      className="text-ink-subtle hover:text-ink-soft p-1 rounded-full hover:bg-surface-hover"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                >
                  <Link to={`/project/${p.id}`} onClick={() => setMenuOpen(null)} className="flex items-center gap-2 px-3 py-2 text-sm text-ink-soft hover:bg-surface-hover">
                    <ExternalLink size={14} /> {t('common.open')}
                  </Link>
                  <button onClick={() => { toggleStarredProject(p); setMenuOpen(null); }} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-ink-soft hover:bg-surface-hover">
                    <Star size={14} className={starredIds.has(p.id) ? 'fill-current text-primary' : ''} /> {t('common.starred')}
                  </button>
                  <button onClick={() => handleDelete(p)} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-bad-text hover:bg-bad-bg/50">
                    <Trash2 size={14} /> {t('common.delete')}
                  </button>
                </StatusMenu>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Status cell: PQ states are user-settable; BSFZ states are admin-only (gated with the backend). */
function statusTone(s: ProjectStatus): string {
  switch (s) {
    case 'pq_approve':
    case 'bsfz_approved':  return 'bg-ok-bg text-ok-text';
    case 'pq_reject':
    case 'bsfz_rejected':  return 'bg-bad-bg text-bad-text';
    case 'bsfz_submitted': return 'bg-info-bg text-info-text';
    default:               return 'bg-surface-hover text-ink-soft';
  }
}

function StatusCell({ id, projectStatus }: { id: string; projectStatus: Project['status'] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useStatuses(); // re-render on change
  const value = getStatus(id);
  const isAdmin = getSessionUser()?.role === 'admin';

  if (projectStatus === 'processing') {
    return (
      <span className="inline-block bg-info-bg text-info-text px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase">
        {t('status.processing')}
      </span>
    );
  }

  if (projectStatus === 'error') {
    return (
      <span className="inline-block bg-bad-bg text-bad-text px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase">
        {t('status.error')}
      </span>
    );
  }

  return (
    <div onClick={e => e.stopPropagation()}>
      <StatusMenu
        open={open}
        onClose={() => setOpen(false)}
        width={176}
        trigger={({ ref }) => (
          <button
            ref={ref}
            onClick={() => setOpen(o => !o)}
            className={`inline-flex items-center gap-1 ${statusTone(value)} px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase`}
          >
            {t(`status.${value}` as TranslationKey)} <ChevronDown size={12} />
          </button>
        )}
      >
        {USER_STATUSES.map(o => (
          <StatusOption key={o} status={o} active={value === o}
            onClick={() => { setStatus(id, o); setOpen(false); }} />
        ))}
        {isAdmin && (
          <>
            <div className="my-1 border-t border-ink/5" />
            <div className="px-3 py-1 text-[9px] font-bold tracking-wider text-ink-subtle uppercase">BSFZ · Admin</div>
            {BSFZ_STATUSES.map(o => (
              <StatusOption key={o} status={o} active={value === o}
                onClick={() => { setStatus(id, o); setOpen(false); }} />
            ))}
          </>
        )}
      </StatusMenu>
    </div>
  );
}

function StatusOption({ status, active, onClick }: { status: ProjectStatus; active: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onClick} className="flex items-center justify-between w-full px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-hover">
      {t(`status.${status}` as TranslationKey)} {active && <Check size={12} className="text-primary" />}
    </button>
  );
}

/* ─── Badges & atoms ───────────────────────────────────────── */

function DomainBadge({ domain }: { domain: Project['domain'] }) {
  const { t } = useTranslation();
  const raw = 'domain.' + domain;
  const label = t(raw as TranslationKey);
  return (
    <span className="inline-block bg-primary-50 text-primary px-2.5 py-1 rounded-md text-xs font-semibold">
      {label === raw ? domain : label}
    </span>
  );
}

function ScoreBadge({ score, status }: { score: number | null; status: Project['status'] }) {
  const { t } = useTranslation();

  if (status === 'processing' || score === null) {
    return (
      <span className="inline-flex items-center gap-1.5 bg-info-bg text-info-text px-2.5 py-1 rounded-pill text-xs font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-info-dot animate-pulse" />
        {t('table.processing')}
      </span>
    );
  }

  const tone =
    score >= 61 ? { bg: 'bg-ok-bg',   text: 'text-ok-text',   dot: 'bg-ok-dot',   label: '' }
    : score >= 40 ? { bg: 'bg-warn-bg', text: 'text-warn-text', dot: 'bg-warn-dot', label: ' · ' + t('table.borderline') }
    : { bg: 'bg-bad-bg',  text: 'text-bad-text',  dot: 'bg-bad-dot',  label: ' · ' + t('table.low') };

  return (
    <span className={`inline-flex items-center gap-1.5 ${tone.bg} ${tone.text} px-2.5 py-1 rounded-pill text-xs font-semibold`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
      {score} / 100{tone.label}
    </span>
  );
}

/* ─── Empty state (page 3 of the screenshots) ───────────────── */

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="py-20 px-6 flex flex-col items-center text-center">
      <h3 className="text-xl font-bold title-premium mb-2">{t('empty.title')}</h3>
      <p className="text-sm text-ink-muted max-w-md mb-6">
        {t('empty.description')}
      </p>
      <Link
        to="/new-project"
        className="btn-gradient text-sm px-5 py-3"
      >
        {t('empty.cta')}
      </Link>
    </div>
  );
}

/* ─── Tiny dial in the avg-score card ───────────────────────── */

function ScoreDial({ value, large = false }: { value: number; large?: boolean }) {
  const size = large ? 64 : 38;
  const r = large ? 27 : 15;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const offset = c * (1 - (drawn ? value : 0) / 100);
  const gradientId = 'score-dial-gradient';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgb(var(--c-signature-a))" />
          <stop offset="100%" stopColor="rgb(var(--c-signature-b))" />
        </linearGradient>
      </defs>
      <circle cx={cx} cy={cx} r={r} fill="none" style={{ stroke: 'rgb(var(--c-primary-200))' }} strokeWidth={large ? 5 : 3} />
      <circle
        cx={cx} cy={cx} r={r} fill="none" stroke={`url(#${gradientId})`} strokeWidth={large ? 5 : 3}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.16,1,0.3,1)' }}
      />
    </svg>
  );
}

/** Plain count-up for the large avg-score number (not routed through StatCard's own CountUp). */
function CountUpPlain({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setDisplay(value); return; }
    const duration = 900;
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

/* ─── helpers ───────────────────────────────────────────────── */

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
