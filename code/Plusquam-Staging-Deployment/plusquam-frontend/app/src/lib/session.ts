const TOKEN_KEY = 'plusquam_token';

export type SessionUser = { id?: string; email?: string; role?: string; name?: string };

export function getToken(): string | null {
  try {
    const current = sessionStorage.getItem(TOKEN_KEY);
    if (current) return current;
    // Migrate existing sessions once, then remove the persistent token copy.
    const legacy = localStorage.getItem(TOKEN_KEY);
    if (legacy) {
      sessionStorage.setItem(TOKEN_KEY, legacy);
      localStorage.removeItem(TOKEN_KEY);
      return legacy;
    }
  } catch { /* storage can be disabled by the browser */ }
  return null;
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

export function clearToken(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

/** Decode (not verify) the JWT payload to read display claims. */
export function getSessionUser(): SessionUser | null {
  const token = getToken();
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    let b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    b += '='.repeat((4 - (b.length % 4)) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0)));
    const p = JSON.parse(json);
    return { id: p.sub, email: p.email, role: p.role, name: p.name };
  } catch {
    return null;
  }
}

/** Up-to-two-letter initials from a name (falls back to the email local-part). */
export function initials(name?: string, email?: string): string {
  const src = (name && name.trim()) || (email ? email.split('@')[0] : '');
  if (!src) return 'PQ';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const ini = parts.slice(0, 2).map(s => s[0]?.toUpperCase() ?? '').join('');
  return ini || src.slice(0, 2).toUpperCase();
}
