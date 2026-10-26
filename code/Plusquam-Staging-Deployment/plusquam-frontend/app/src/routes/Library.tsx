import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, ExternalLink, BookOpen } from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';
import {
  useStarredProjects, useStarredPapers,
  toggleStarredProject, toggleStarredPaper,
} from '../lib/starred';

type Tab = 'projects' | 'papers';

export default function Library() {
  const { t, lang } = useTranslation();
  const projects = useStarredProjects();
  const papers = useStarredPapers();
  const [tab, setTab] = useState<Tab>('projects');

  return (
    <div className="px-5 sm:px-8 py-8 max-w-[920px] mx-auto animate-fade-up">
      <h1 className="text-2xl font-bold title-premium mb-6">{t('library.title')}</h1>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface-card rounded-pill w-fit mb-6">
        <TabButton active={tab === 'projects'} onClick={() => setTab('projects')}
          icon={<Star size={14} />} label={`${t('library.tab.projects')} (${projects.length})`} />
        <TabButton active={tab === 'papers'} onClick={() => setTab('papers')}
          icon={<BookOpen size={14} />} label={`${t('library.tab.papers')} (${papers.length})`} />
      </div>

      {tab === 'projects' ? (
        projects.length === 0 ? (
          <Empty icon={<Star size={28} />} text={t('library.empty.projects')} />
        ) : (
          <div className="space-y-2">
            {projects.map((p, i) => (
              <div key={p.id} className="flex items-center gap-4 glass-card rounded-xl px-4 py-3 card-lift stagger-item" style={{ '--i': i } as React.CSSProperties}>
                <Link to={`/project/${p.id}`} className="flex-1 min-w-0">
                  <div className="font-semibold text-ink truncate">{p.name}</div>
                  <div className="text-xs text-ink-muted mt-0.5">
                    {p.clientId} · {formatDate(p.submittedAt, lang)}
                    {p.noveltyScore != null && <> · {p.noveltyScore}/100</>}
                  </div>
                </Link>
                <button
                  onClick={() => toggleStarredProject(p)}
                  aria-label="unstar"
                  className="shrink-0 p-1.5 rounded-lg text-primary hover:bg-surface-hover"
                >
                  <Star size={16} className="fill-current" />
                </button>
              </div>
            ))}
          </div>
        )
      ) : (
        papers.length === 0 ? (
          <Empty icon={<BookOpen size={28} />} text={t('library.empty.papers')} />
        ) : (
          <div className="space-y-2">
            {papers.map((p, i) => (
              <div key={`${p.projectId}:${p.id}`} className="glass-card rounded-xl px-4 py-3 card-lift stagger-item" style={{ '--i': i } as React.CSSProperties}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-ink leading-snug">{p.title}</h3>
                    <div className="text-[11px] text-ink-muted mt-1">
                      {p.year} · {p.citations} {t('report.citations')} · {p.authors}
                    </div>
                    <div className="text-[11px] text-ink-subtle mt-1">
                      {t('library.from_project')}{' '}
                      <Link to={`/project/${p.projectId}`} className="text-primary hover:underline">{p.projectName}</Link>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {p.pdfUrl && (
                      <button
                        onClick={() => window.open(p.pdfUrl, '_blank', 'noopener,noreferrer')}
                        className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-hover px-2 py-1"
                      >
                        <ExternalLink size={12} /> {t('report.action.open')}
                      </button>
                    )}
                    <button
                      onClick={() => toggleStarredPaper(p, p.projectId, p.projectName)}
                      aria-label="unstar"
                      className="p-1.5 rounded-lg text-primary hover:bg-surface-hover"
                    >
                      <Star size={16} className="fill-current" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold transition-all duration-200 ease-premium',
        active ? 'bg-surface text-primary shadow-xs scale-105' : 'text-ink-muted hover:text-ink hover:scale-105',
      ].join(' ')}
    >
      {icon}{label}
    </button>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="py-20 flex flex-col items-center text-center text-ink-muted">
      <div className="text-ink-subtle mb-3">{icon}</div>
      <p className="text-sm max-w-sm">{text}</p>
    </div>
  );
}

function formatDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}
