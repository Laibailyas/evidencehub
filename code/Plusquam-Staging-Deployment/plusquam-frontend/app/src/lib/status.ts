import { useSyncExternalStore } from 'react';
import { API_ENABLED, api } from './api';

/**
 * Per-project review status. When a backend is configured it is the source of
 * truth (persisted on the project record via PATCH /projects/{id}); otherwise
 * it falls back to localStorage so the demo works offline.
 *
 * PQ states are user-settable; BSFZ states are admin-only (enforced server-side).
 */
export type ProjectStatus =
  | 'none' | 'pq_approve' | 'pq_reject'
  | 'bsfz_submitted' | 'bsfz_approved' | 'bsfz_rejected';

export const USER_STATUSES: ProjectStatus[] = ['none', 'pq_approve', 'pq_reject'];
export const BSFZ_STATUSES: ProjectStatus[] = ['bsfz_submitted', 'bsfz_approved', 'bsfz_rejected'];

const KEY = 'plusquam_statuses';

function loadLocal(): Record<string, ProjectStatus> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

let map: Record<string, ProjectStatus> = API_ENABLED ? {} : loadLocal();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const emit = () => listeners.forEach(l => l());

function persistLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

/** Merge statuses loaded from project records (server is source of truth). */
export function seedStatuses(seed: Record<string, ProjectStatus>) {
  map = { ...map, ...seed };
  emit();
}

export function setStatus(id: string, status: ProjectStatus) {
  const prev = map[id];
  map = { ...map, [id]: status };
  emit();
  if (API_ENABLED) {
    api.saveProjectReview(id, { reviewStatus: status }).catch(err => {
      console.warn('[plusquam] status save failed, reverting:', err);
      map = { ...map, [id]: prev ?? 'none' };
      emit();
    });
  } else {
    persistLocal();
  }
}

export function getStatus(id: string): ProjectStatus {
  return map[id] ?? 'none';
}

export function useStatuses(): Record<string, ProjectStatus> {
  return useSyncExternalStore(subscribe, () => map, () => map);
}
