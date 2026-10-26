import { projectUploadError } from './apiErrors';
import type { Assessment } from '../data/mockAssessment';
import { clearToken, getSessionUser, getToken, setToken } from './session';

/**
 * Single source of truth for the API base URL.
 * Set via VITE_API_BASE in .env.production (build) or .env.local (dev).
 * Empty string → MOCK mode: callers fall back to local mock data.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
export const SIGNIN_URL = (import.meta.env.VITE_SIGNIN_URL ?? '')
  .replace(/\/+$/, '') + '/';

/** True when a real backend is configured. */
export const API_ENABLED = API_BASE.length > 0;

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit, hasProjectUpload = false): Promise<T> {
  if (!API_ENABLED) throw new Error('API not configured (MOCK mode)');
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      // Token missing/expired → clear it and return to the sign-in entrance.
      clearToken();
      const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      window.location.href = isLocal ? '/' : SIGNIN_URL;
    }
    throw await projectUploadError(res, hasProjectUpload);
  }
  return res.json() as Promise<T>;
}

/* ─── Typed endpoints (mirror api/src/handlers) ───────────── */

export type StatusHistoryEntry = { status: string; at: string; by?: string };

export type ProjectRecord = {
  id: string;
  title: string;
  description?: string;
  domains?: string[];
  reference?: string;
  status?: string;
  noveltyScore?: number | null;
  reviewStatus?: string;
  reviewComment?: string;
  reviewStatusAt?: string;
  statusHistory?: StatusHistoryEntry[];
  sourceName?: string;
  sourceChars?: number;
  createdAt?: string;
};

/** Optional document upload included in createProject (parsed server-side). */
export type UploadPayload = { filename: string; contentType: string; dataBase64: string };

/** Exchange a short-lived login code for an API token. The JWT never enters a URL. */
export async function exchangeHandoff(code: string): Promise<void> {
  if (!API_ENABLED) throw new Error('API not configured');
  const response = await fetch(`${API_BASE}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) throw new Error('login code could not be exchanged');
  const result = await response.json() as { token?: string };
  if (!result.token || result.token.length > 8_192) throw new Error('invalid login response');
  setToken(result.token);
}

export type StarsState = { projects: unknown[]; papers: unknown[] };

export type NotificationItem = {
  id: string;
  projectId: string;
  projectTitle: string;
  status: string;
  by: string;
  at: string;
  read: boolean;
};

export const api = {
  login: (email: string, password: string, role = 'user') =>
    request<{ handoffCode: string; user: unknown }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, role }),
    }),

  listProjects: () => request<ProjectRecord[]>('/projects'),

  getProject: (id: string) => request<ProjectRecord>(`/projects/${id}`),

  createProject: (p: Partial<ProjectRecord> & { upload?: UploadPayload }) =>
    request<ProjectRecord>('/projects', { method: 'POST', body: JSON.stringify(p) }, Boolean(p.upload)),

  updateProject: (id: string, patch: { reviewStatus?: string; reviewComment?: string }) =>
    request<ProjectRecord>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteProject: (id: string) =>
    request<{ deleted: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  /** Delete a project, role-aware: admins fall back to the admin endpoint
   *  when the project isn't theirs. */
  deleteProjectSmart: async (id: string) => {
    try {
      await api.deleteProject(id);
    } catch (e) {
      if (getSessionUser()?.role === 'admin') {
        await request(`/admin/projects/${id}`, { method: 'DELETE' });
        return;
      }
      throw e;
    }
  },

  /**
   * Save review status/comment, role-aware: the user endpoint is owner-scoped,
   * so when an admin edits a project that isn't theirs (e.g. opened from the
   * Admin "All projects" list) we fall back to the admin endpoint.
   */
  saveProjectReview: async (id: string, patch: { reviewStatus?: string; reviewComment?: string }) => {
    try {
      await api.updateProject(id, patch);
    } catch (e) {
      if (getSessionUser()?.role === 'admin') {
        await api.admin.updateAnyProject(id, patch);
        return;
      }
      throw e;
    }
  },

  getStars: () => request<StarsState>('/me/stars'),

  putStars: (state: StarsState) =>
    request<StarsState>('/me/stars', { method: 'PUT', body: JSON.stringify(state) }),

  getNotifications: () =>
    request<{ items: NotificationItem[]; unread: number }>('/me/notifications'),

  markNotificationsRead: () =>
    request<{ ok: boolean }>('/me/notifications/read', { method: 'POST' }),

  startAssessment: (projectId: string) =>
    request<Assessment>(`/projects/${projectId}/assess`, { method: 'POST' }),

  getStatus: (projectId: string) =>
    request<Array<{ sk: string; status: string }>>(`/projects/${projectId}/status`),

  getAssessment: (projectId: string) =>
    request<Assessment>(`/projects/${projectId}/assessment`),

  getReportPdf: async (projectId: string, lang: string): Promise<Blob> => {
    if (!API_ENABLED) throw new Error('API not configured (MOCK mode)');
    const res = await fetch(
      `${API_BASE}/projects/${projectId}/report.pdf?lang=${encodeURIComponent(lang)}`,
      { headers: { ...authHeaders() } },
    );
    if (!res.ok) {
      if (res.status === 401) {
        clearToken();
        const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        window.location.href = isLocal ? '/' : SIGNIN_URL;
      }
      throw new Error(`API ${res.status} report.pdf`);
    }
    return res.blob();
  },

  admin: {
    listUsers: () => request<AdminUser[]>('/admin/users'),
    createUser: (u: { email: string; password: string; role: string; name: string }) =>
      request<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(u) }),
    deleteUser: (email: string) =>
      request<{ ok: boolean }>(`/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    resetPassword: (email: string, password: string) =>
      request<{ ok: boolean }>(`/admin/users/${encodeURIComponent(email)}/password`, {
        method: 'POST', body: JSON.stringify({ password }),
      }),
    listAllProjects: () => request<AdminProject[]>('/admin/projects'),
    updateAnyProject: (id: string, patch: { reviewStatus?: string; reviewComment?: string }) =>
      request<AdminProject>(`/admin/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    getPrompts: () => request<PromptsResponse>('/admin/prompts'),
    putPrompts: (prompts: PromptSet) =>
      request<PromptsResponse>('/admin/prompts', { method: 'PUT', body: JSON.stringify({ prompts }) }),
  },
};

export const PROMPT_KEYS = [
  'query_understanding', 'synthesis', 'open_questions', 'novelty_scoring',
] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];
export type PromptSet = Record<PromptKey, string>;
export type PromptsResponse = { prompts: PromptSet; defaults: PromptSet };

export type AdminUser = {
  userId: string; email: string; name: string; role: string; createdAt: string;
};
export type AdminProject = {
  id: string; userId: string; title: string; domains?: string[];
  status?: string; noveltyScore?: number | null;
  reviewStatus?: string; reviewComment?: string;
  reviewStatusAt?: string; statusHistory?: StatusHistoryEntry[]; createdAt?: string;
};
