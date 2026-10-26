import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, KeyRound, UserPlus, ChevronDown, Check, RotateCcw, Save } from 'lucide-react';
import { useTranslation } from '../i18n/useTranslation';
import type { TranslationKey } from '../i18n/translations';
import {
  api, type AdminUser, type AdminProject,
  PROMPT_KEYS, type PromptKey, type PromptSet,
} from '../lib/api';
import { getSessionUser } from '../lib/session';
import { USER_STATUSES, BSFZ_STATUSES, type ProjectStatus } from '../lib/status';
import { StatusMenu } from '../components/StatusMenu';

type Tab = 'users' | 'projects' | 'prompts';

export default function Admin() {
  const { t } = useTranslation();
  const me = getSessionUser();

  if (me?.role !== 'admin') {
    return (
      <div className="px-8 py-16 text-center text-ink-muted animate-fade-up">
        <p>{t('admin.forbidden')}</p>
        <Link to="/" className="text-primary hover:underline text-sm mt-2 inline-block">← Dashboard</Link>
      </div>
    );
  }

  return <AdminInner />;
}

function AdminInner() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('users');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'users', label: t('admin.tab.users') },
    { id: 'projects', label: t('admin.tab.projects') },
    { id: 'prompts', label: t('admin.tab.prompts') },
  ];

  return (
    <div className="px-5 sm:px-8 py-8 max-w-[1200px] mx-auto animate-fade-up">
      <h1 className="text-2xl font-bold title-premium mb-6">{t('admin.title')}</h1>

      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start">
        {/* Vertical tab rail */}
        <nav className="glass-card rounded-2xl p-2 flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
          {tabs.map(tb => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={[
                'relative text-left px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-200 ease-premium shrink-0',
                tab === tb.id
                  ? 'bg-linear-to-r from-primary/15 to-transparent text-primary shadow-[inset_2px_0_0_0_rgb(var(--c-primary))]'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-hover',
              ].join(' ')}
            >
              {tb.label}
            </button>
          ))}
        </nav>

        <div key={tab} className="animate-fade-up min-w-0">
          {tab === 'users' ? <UsersPanel /> : tab === 'projects' ? <ProjectsPanel /> : <PromptsPanel />}
        </div>
      </div>
    </div>
  );
}

/* ─── Users ─────────────────────────────────────────────────── */

function UsersPanel() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'user' });
  const [busy, setBusy] = useState(false);

  const load = () => api.admin.listUsers().then(setUsers).catch(e => setErr(String(e)));
  useEffect(() => { load(); }, []);

  async function create() {
    if (!form.email || !form.password) return;
    setBusy(true); setErr(null);
    try {
      await api.admin.createUser(form);
      setForm({ email: '', password: '', name: '', role: 'user' });
      await load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function remove(email: string) {
    if (!confirm(t('admin.confirm.delete').replace('{email}', email))) return;
    try { await api.admin.deleteUser(email); await load(); }
    catch (e) { setErr(String(e)); }
  }

  async function reset(email: string) {
    const pw = prompt(t('admin.reset.prompt').replace('{email}', email));
    if (!pw) return;
    try { await api.admin.resetPassword(email, pw); alert(t('admin.reset.done')); }
    catch (e) { setErr(String(e)); }
  }

  return (
    <div className="space-y-6">
      {/* Create */}
      <div className="glass-card rounded-2xl p-5">
        <h2 className="text-sm font-bold text-ink mb-3 flex items-center gap-2"><UserPlus size={16} /> {t('admin.new_user')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          <input className={inputCls} placeholder={t('admin.col.email')} value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <input className={inputCls} placeholder={t('admin.col.name')} value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <input className={inputCls} type="password" placeholder={t('admin.password')} value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          <select className={inputCls} value={form.role}
            onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="user">{t('admin.role.user')}</option>
            <option value="admin">{t('admin.role.admin')}</option>
          </select>
          <button onClick={create} disabled={busy || !form.email || !form.password}
            className="btn-gradient disabled:opacity-50 disabled:pointer-events-none text-sm px-4 py-2 rounded-lg">
            {t('admin.action.create')}
          </button>
        </div>
      </div>

      {err && <p className="text-xs text-bad-text">{err}</p>}

      {/* List */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              <Th>{t('admin.col.email')}</Th><Th>{t('admin.col.name')}</Th>
              <Th>{t('admin.col.role')}</Th><Th>{t('admin.col.created')}</Th>
              <th className="px-5 py-3 text-right">{t('admin.col.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users?.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-ink-muted">{t('admin.empty.users')}</td></tr>
            )}
            {users?.map(u => (
              <tr key={u.userId} className="border-t border-ink/5">
                <td className="px-5 py-3 text-ink font-medium">{u.email}</td>
                <td className="px-5 py-3 text-ink-soft">{u.name || '—'}</td>
                <td className="px-5 py-3">
                  <span className={u.role === 'admin' ? 'bg-primary-50 text-primary px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase' : 'text-ink-muted text-xs'}>
                    {u.role}
                  </span>
                </td>
                <td className="px-5 py-3 text-ink-muted text-xs">{(u.createdAt || '').slice(0, 10)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => reset(u.email)} title={t('admin.action.reset')}
                      className="p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-surface-hover"><KeyRound size={15} /></button>
                    <button onClick={() => remove(u.email)} title={t('admin.action.delete')}
                      className="p-1.5 rounded-lg text-ink-subtle hover:text-bad-text hover:bg-bad-bg/50"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── All projects ──────────────────────────────────────────── */

function ProjectsPanel() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<AdminProject[] | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.admin.listAllProjects().then(setProjects).catch(e => setErr(String(e)));
    api.admin.listUsers().then(setUsers).catch(() => {});
  }, []);

  const ownerEmail = useMemo(() => {
    const m = new Map(users.map(u => [u.userId, u.email]));
    return (uid: string) => m.get(uid) ?? uid;
  }, [users]);

  function setStatus(id: string, reviewStatus: ProjectStatus) {
    setProjects(ps => ps?.map(p => (p.id === id ? { ...p, reviewStatus } : p)) ?? ps);
    api.admin.updateAnyProject(id, { reviewStatus }).catch(e => setErr(String(e)));
  }

  return (
    <div className="space-y-4">
      {err && <p className="text-xs text-bad-text">{err}</p>}
      <div className="glass-card rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
              <Th>{t('admin.col.project')}</Th><Th>{t('admin.col.owner')}</Th>
              <Th>{t('table.col.score')}</Th><Th>{t('admin.col.status')}</Th>
            </tr>
          </thead>
          <tbody>
            {projects?.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-ink-muted">{t('admin.empty.projects')}</td></tr>
            )}
            {projects?.map(p => (
              <tr key={p.id} className="border-t border-ink/5">
                <td className="px-5 py-3">
                  <Link to={`/project/${p.id}`} className="text-ink font-medium hover:text-primary">{p.title}</Link>
                </td>
                <td className="px-5 py-3 text-ink-soft text-xs">{ownerEmail(p.userId)}</td>
                <td className="px-5 py-3 text-ink-soft">{p.noveltyScore != null ? `${p.noveltyScore}/100` : '—'}</td>
                <td className="px-5 py-3">
                  <AdminStatusDropdown value={(p.reviewStatus ?? 'none') as ProjectStatus} onChange={s => setStatus(p.id, s)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminStatusDropdown({ value, onChange }: { value: ProjectStatus; onChange: (s: ProjectStatus) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const tone =
    value === 'pq_approve' || value === 'bsfz_approved' ? 'bg-ok-bg text-ok-text'
    : value === 'pq_reject' || value === 'bsfz_rejected' ? 'bg-bad-bg text-bad-text'
    : value === 'bsfz_submitted' ? 'bg-info-bg text-info-text'
    : 'bg-surface-hover text-ink-soft';
  return (
    <StatusMenu
      open={open}
      onClose={() => setOpen(false)}
      width={176}
      trigger={({ ref }) => (
        <button ref={ref} onClick={() => setOpen(o => !o)}
          className={`inline-flex items-center gap-1 ${tone} px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase`}>
          {t(`status.${value}` as TranslationKey)} <ChevronDown size={12} />
        </button>
      )}
    >
      {[...USER_STATUSES, ...BSFZ_STATUSES].map(o => (
        <button key={o} onClick={() => { onChange(o); setOpen(false); }}
          className="flex items-center justify-between w-full px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-hover">
          {t(`status.${o}` as TranslationKey)} {value === o && <Check size={12} className="text-primary" />}
        </button>
      ))}
    </StatusMenu>
  );
}

/* ─── Prompts editor ────────────────────────────────────────── */

function PromptsPanel() {
  const { t } = useTranslation();
  const [defaults, setDefaults] = useState<PromptSet | null>(null);
  const [draft, setDraft] = useState<PromptSet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.admin.getPrompts()
      .then(r => { setDefaults(r.defaults); setDraft(r.prompts); })
      .catch(e => setErr(String(e)));
  }, []);

  function edit(key: PromptKey, value: string) {
    setDraft(d => (d ? { ...d, [key]: value } : d));
    setSaved(false);
  }

  async function save() {
    if (!draft) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.admin.putPrompts(draft);
      setDraft(r.prompts);
      setDefaults(r.defaults);
      setSaved(true);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  if (!draft || !defaults) {
    return <p className="text-sm text-ink-muted">{err ?? '…'}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">{t('admin.prompts.intro')}</p>
      {err && <p className="text-xs text-bad-text">{err}</p>}

      {PROMPT_KEYS.map(key => {
        const isDefault = draft[key].trim() === defaults[key].trim();
        return (
          <div key={key} className="glass-card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-2 gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-ink">
                  {t(`admin.prompts.label.${key}` as TranslationKey)}
                </h2>
                <span className={[
                  'px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider',
                  isDefault ? 'bg-surface-hover text-ink-muted' : 'bg-primary-50 text-primary',
                ].join(' ')}>
                  {isDefault ? t('admin.prompts.is_default') : t('admin.prompts.modified')}
                </span>
              </div>
              <button
                onClick={() => edit(key, defaults[key])}
                disabled={isDefault}
                className="inline-flex items-center gap-1 text-xs text-ink-subtle hover:text-ink disabled:opacity-40 disabled:cursor-default"
              >
                <RotateCcw size={13} /> {t('admin.prompts.reset')}
              </button>
            </div>
            <textarea
              value={draft[key]}
              onChange={e => edit(key, e.target.value)}
              rows={key === 'novelty_scoring' ? 16 : 7}
              spellCheck={false}
              className="w-full px-3 py-2 text-xs font-mono leading-relaxed bg-surface-subtle border border-ink/10 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/20 resize-y"
            />
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy}
          className="btn-gradient inline-flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none text-sm px-5 py-2.5 rounded-lg">
          <Save size={15} /> {t('admin.prompts.save')}
        </button>
        {saved && <span className="text-xs text-ok-text">{t('admin.prompts.saved')}</span>}
      </div>
    </div>
  );
}

/* ─── atoms ──────────────────────────────────────────────────── */

const inputCls = 'px-3 py-2 text-sm bg-surface-subtle border border-ink/10 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/20';

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-5 py-3 text-left font-semibold">{children}</th>;
}
