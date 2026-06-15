// ── Auth persistence helpers ──────────────────────────────────────────────────
// Caches the user profile in localStorage so the UI can restore immediately
// on page load while silentRefresh runs in the background.
// The access token is NEVER stored here — it stays in memory only.

const KEY = 'dp-auth-user';

export function saveUserCache(user) {
  try { localStorage.setItem(KEY, JSON.stringify(user)); } catch {}
}

export function loadUserCache() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function clearUserCache() {
  try { localStorage.removeItem(KEY); } catch {}
}
