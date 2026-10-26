import { useEffect, useSyncExternalStore } from 'react';
import { API_ENABLED, api } from './api';
import type { Project } from '../data/mockProjects';
import type { Paper } from '../data/mockAssessment';

/**
 * Per-user "Starred" store shared across Dashboard, Report, and Library.
 * With a backend configured it persists server-side (GET/PUT /me/stars) so it
 * follows the account; otherwise it falls back to localStorage.
 */

export type StarredPaper = Paper & { projectId: string; projectName: string };

const KEY_P = 'plusquam_starred_projects';
const KEY_L = 'plusquam_starred_papers';

function loadLocal<T>(key: string): T[] {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T[]) : []; }
  catch { return []; }
}

let projects: Project[] = API_ENABLED ? [] : loadLocal<Project>(KEY_P);
let papers: StarredPaper[] = API_ENABLED ? [] : loadLocal<StarredPaper>(KEY_L);

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const emit = () => listeners.forEach(l => l());

function persist() {
  if (API_ENABLED) {
    api.putStars({ projects, papers }).catch(e => console.warn('[plusquam] stars save failed:', e));
  } else {
    try {
      localStorage.setItem(KEY_P, JSON.stringify(projects));
      localStorage.setItem(KEY_L, JSON.stringify(papers));
    } catch { /* ignore */ }
  }
  emit();
}

// One-time hydration from the server.
let hydrated = !API_ENABLED;
let hydrating: Promise<void> | null = null;
function hydrate() {
  if (hydrated || hydrating) return;
  hydrating = api.getStars()
    .then(s => {
      projects = (s.projects as Project[]) ?? [];
      papers = (s.papers as StarredPaper[]) ?? [];
      hydrated = true;
      emit();
    })
    .catch(e => { console.warn('[plusquam] stars hydrate failed:', e); hydrated = true; });
}

/* ── Projects ── */
export function isProjectStarred(id: string) { return projects.some(p => p.id === id); }
export function toggleStarredProject(p: Project) {
  projects = isProjectStarred(p.id) ? projects.filter(x => x.id !== p.id) : [p, ...projects];
  persist();
}
export function useStarredProjects(): Project[] {
  useEffect(() => { hydrate(); }, []);
  return useSyncExternalStore(subscribe, () => projects, () => projects);
}

/** Remove a project and its starred papers from the store (used on delete). */
export function removeProjectEverywhere(id: string) {
  const hadP = projects.some(p => p.id === id);
  const hadL = papers.some(p => p.projectId === id);
  if (!hadP && !hadL) return;
  projects = projects.filter(p => p.id !== id);
  papers = papers.filter(p => p.projectId !== id);
  persist();
}

/* ── Papers (unique per project + paper id) ── */
const pkey = (projectId: string, id: number) => `${projectId}:${id}`;
export function isPaperStarred(projectId: string, id: number) {
  return papers.some(p => pkey(p.projectId, p.id) === pkey(projectId, id));
}
export function toggleStarredPaper(paper: Paper, projectId: string, projectName: string) {
  const k = pkey(projectId, paper.id);
  papers = papers.some(p => pkey(p.projectId, p.id) === k)
    ? papers.filter(p => pkey(p.projectId, p.id) !== k)
    : [{ ...paper, projectId, projectName }, ...papers];
  persist();
}
export function useStarredPapers(): StarredPaper[] {
  useEffect(() => { hydrate(); }, []);
  return useSyncExternalStore(subscribe, () => papers, () => papers);
}
