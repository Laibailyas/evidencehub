import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutGrid, Plus, BookOpen, Shield, FileClock } from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';
import { getSessionUser, initials } from '../lib/session';
import { API_ENABLED, api } from '../lib/api';
import Logo from './Logo';

export default function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const user = getSessionUser();
  const displayName = user?.name || user?.email || 'plusquam';
  const roleLabel = user?.role === 'admin' ? t('nav.role.admin') : t('nav.role.user');
  const [historyItems, setHistoryItems] = useState<{ id: string; name: string; domain: string }[]>([]);

  useEffect(() => {
    if (!API_ENABLED) return;
    let active = true;
    api.listProjects()
      .then(projects => {
        if (!active) return;
        setHistoryItems(projects.map(project => ({
          id: project.id,
          name: project.title,
          domain: project.domains?.[0] || 'AI/ML',
        })));
      })
      .catch(error => {
        // A live deployment must never display demo project links as real data.
        console.warn('[plusquam] sidebar project history could not be loaded:', error);
        if (active) setHistoryItems([]);
      });
    return () => { active = false; };
  }, [location.key]);

  const navItem = ({ isActive }: { isActive: boolean }) =>
    [
      'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium',
      'transition-all duration-200 ease-premium',
      isActive
        ? 'bg-linear-to-r from-primary/15 to-transparent text-primary shadow-[inset_2px_0_0_0_rgb(var(--c-primary))] translate-x-0.5'
        : 'text-ink-soft hover:bg-surface-hover hover:text-ink hover:translate-x-0.5',
    ].join(' ');

  return (
    <>
      {/* Mobile backdrop */}
      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={onClose} />}

      <aside
        onClick={() => onClose?.()}
        className={[
          'w-[264px] shrink-0 glass-card flex flex-col',
          'fixed inset-y-0 left-0 z-40 transition-transform duration-200 rounded-none',
          'lg:static lg:z-auto lg:transition-none lg:rounded-2xl lg:ring-1 lg:ring-ink/5',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
      {/* Brand mark */}
      <div className="px-5 pt-5 flex items-center gap-2">
        <Logo height={26} />
      </div>

      {/* Big primary CTA */}
      <div className="px-5 pt-4 pb-5">
        <NavLink
          to="/new-project"
          className="btn-gradient flex items-center justify-center gap-2 w-full py-3"
        >
          <Plus size={16} strokeWidth={2.5} />
          <span>{t('nav.new_project')}</span>
        </NavLink>
      </div>

      {/* Sections */}
      <nav className="flex-1 px-3 pb-4 overflow-y-auto">
        <SectionLabel>{t('nav.workspace')}</SectionLabel>
        <NavLink to="/" end className={navItem}>
          <LayoutGrid size={16} />
          {t('nav.dashboard')}
        </NavLink>
        <NavLink to="/new-project" className={navItem}>
          <Plus size={16} />
          {t('nav.new_project')}
        </NavLink>

        <SectionLabel className="mt-6">{t('nav.history')}</SectionLabel>
        <div className="space-y-1.5">
          {historyItems.map(h => (
            <NavLink
              key={h.id}
              to={`/project/${encodeURIComponent(h.id)}`}
              className={({ isActive }) =>
                [
                  'group flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs',
                  'ring-1 transition-all duration-200 ease-premium',
                  isActive
                    ? 'bg-primary/10 ring-primary/20 text-primary'
                    : 'bg-surface-hover/40 ring-ink/5 text-ink-soft hover:bg-surface-hover hover:ring-ink/10 hover:text-ink',
                ].join(' ')
              }
            >
              <FileClock size={14} className="shrink-0 opacity-70" />
              <span className="min-w-0">
                <span className="block truncate font-medium leading-tight">{h.name}</span>
                <span className="block text-[10px] text-ink-subtle mt-0.5">{h.domain}</span>
              </span>
            </NavLink>
          ))}
          {API_ENABLED && historyItems.length === 0 && (
            <p className="px-3 py-2 text-xs text-ink-subtle">
              {t('nav.history.empty')}
            </p>
          )}
        </div>

        <SectionLabel className="mt-6">{t('nav.library')}</SectionLabel>
        <NavLink to="/library" className={navItem}>
          <BookOpen size={16} />
          {t('nav.bibliothek')}
        </NavLink>

        {user?.role === 'admin' && (
          <>
            <SectionLabel className="mt-6">{t('nav.admin')}</SectionLabel>
            <NavLink to="/admin" className={navItem}>
              <Shield size={16} />
              {t('admin.title')}
            </NavLink>
          </>
        )}
      </nav>

      {/* User profile */}
      <div className="border-t border-ink/5 p-4 flex items-center gap-3">
        <div className="relative w-9 h-9 rounded-full bg-linear-to-br from-primary to-[rgb(var(--c-signature-a))] text-white text-xs font-bold flex items-center justify-center shrink-0 shadow-glow ring-2 ring-surface">
          {initials(user?.name, user?.email)}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink truncate">{displayName}</div>
          <div className="text-xs text-ink-muted">{roleLabel}</div>
        </div>
      </div>
    </aside>
    </>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-3 mb-2 text-[11px] font-semibold tracking-wider text-ink-subtle uppercase ${className}`}>
      {children}
    </div>
  );
}
