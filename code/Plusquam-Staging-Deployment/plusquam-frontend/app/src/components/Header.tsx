import { useEffect, useRef, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Bell, Plus, Moon, Sun, LogOut, Menu } from 'lucide-react';
import Logo from './Logo';
import { useTranslation } from '../i18n/useTranslation';
import type { TranslationKey } from '../i18n/translations';
import { useTheme } from '../lib/useTheme';
import { API_ENABLED, api, SIGNIN_URL, type NotificationItem } from '../lib/api';
import { clearToken } from '../lib/session';

function logout() {
  clearToken();
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  window.location.href = isLocal ? '/' : SIGNIN_URL;
}

export default function Header({ onMenu }: { onMenu?: () => void }) {
  const { t, lang, setLang } = useTranslation();
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 4);
    main.addEventListener('scroll', onScroll);
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={[
        'h-16 shrink-0 flex items-center justify-between px-4 sm:px-6 transition-all duration-300 z-20 lg:rounded-t-2xl',
        scrolled ? 'glass-header border-b border-ink/5 shadow-xs' : 'bg-transparent border-b border-transparent',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        {onMenu && (
          <button
            type="button"
            onClick={onMenu}
            aria-label="Menu"
            className="lg:hidden w-10 h-10 rounded-full hover:bg-surface-hover text-ink-soft flex items-center justify-center transition-all duration-200 ease-premium hover:scale-110 active:scale-95"
          >
            <Menu size={18} />
          </button>
        )}
        <NavLink to="/" className="lg:hidden text-ink transition-transform duration-300 ease-premium hover:scale-[1.03] active:scale-95">
          <Logo height={26} />
        </NavLink>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Language switcher (hidden on the smallest screens) */}
        <div className="hidden sm:flex items-center gap-1 p-1 border border-ink/10 rounded-pill text-xs font-semibold tracking-wider">
          {(['de', 'en'] as const).map(l => (
            <button
              key={l}
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={[
                'px-3 py-1 rounded-pill transition-colors',
                lang === l ? 'bg-ink/5 text-ink' : 'text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {t(l === 'de' ? 'common.lang.de' : 'common.lang.en')}
            </button>
          ))}
        </div>

        {/* Dark / light mode toggle */}
        <button
          type="button"
          onClick={toggle}
          aria-label={theme === 'dark' ? t('common.theme.light') : t('common.theme.dark')}
          title={theme === 'dark' ? t('common.theme.light') : t('common.theme.dark')}
          className="w-10 h-10 rounded-full hover:bg-surface-hover text-ink-soft flex items-center justify-center transition-all duration-200 ease-premium hover:scale-110 active:scale-95"
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Notifications — signals admin-driven status changes */}
        <NotificationBell />

        {/* Logout */}
        <button
          type="button"
          onClick={logout}
          aria-label={t('common.logout')}
          title={t('common.logout')}
          className="w-10 h-10 rounded-full hover:bg-surface-hover text-ink-soft flex items-center justify-center transition-all duration-200 ease-premium hover:scale-110 active:scale-95"
        >
          <LogOut size={18} />
        </button>

        {/* New project CTA (hidden on mobile — also in the sidebar) */}
        <NavLink
          to="/new-project"
          className="btn-gradient hidden sm:flex items-center gap-2 text-sm px-4 py-2.5"
        >
          <Plus size={16} strokeWidth={2.5} />
          <span>{t('common.new_project').replace('+ ', '')}</span>
        </NavLink>
      </div>
    </header>
  );
}

/* ─── Notification bell (admin status changes) ─────────────── */

function NotificationBell() {
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    if (!API_ENABLED) return;
    try {
      const r = await api.getNotifications();
      setItems(r.items);
      setUnread(r.unread);
    } catch { /* unauthenticated / mock — ignore */ }
  }

  useEffect(() => {
    if (!API_ENABLED) return;
    load();
    const id = setInterval(load, 60_000); // poll for admin changes
    return () => clearInterval(id);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      setItems(prev => prev.map(i => ({ ...i, read: true })));
      try { await api.markNotificationsRead(); } catch { /* ignore */ }
    }
  }

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        type="button"
        onClick={toggle}
        aria-label={t('notif.title')}
        className="relative w-10 h-10 rounded-full hover:bg-surface-hover text-ink-soft flex items-center justify-center transition-all duration-200 ease-premium hover:scale-110 active:scale-95"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-bad-text text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-30 w-80 bg-surface rounded-xl ring-1 ring-ink/10 shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-ink/5 text-sm font-bold text-ink">
            {t('notif.title')}
          </div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-ink-muted">{t('notif.empty')}</div>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map(n => (
                <li key={n.id} className="border-b border-ink/5 last:border-0">
                  <Link
                    to={`/project/${n.projectId}`}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 hover:bg-surface-hover"
                  >
                    <div className="text-sm font-semibold text-ink leading-snug">{n.projectTitle || n.projectId}</div>
                    <div className="text-xs text-ink-soft mt-0.5">
                      {t('notif.status_to')}{' '}
                      <span className="font-semibold text-primary">
                        {t(`status.${n.status}` as TranslationKey)}
                      </span>
                    </div>
                    <div className="text-[11px] text-ink-muted mt-0.5">
                      {t('notif.by')} {n.by} · {(n.at || '').slice(0, 10)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
