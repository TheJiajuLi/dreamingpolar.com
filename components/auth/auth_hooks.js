// ── Auth persistence helpers ──────────────────────────────────────────────────
// Caches the user profile in localStorage so the UI can restore immediately
// on page load while silentRefresh runs in the background.
// The access token is NEVER stored here — it stays in memory only.

const KEY_PREFIX = 'dp-auth-user';
const LAST_KEY = 'dp-auth-user:last-key';
const LAST_IDENTITY_KEY = 'dp-auth-user:last-identity';

function _userIdentityKey(user) {
  if (!user || typeof user !== 'object') return '';
  if (user.id != null && String(user.id).trim()) return `id:${String(user.id).trim()}`;
  if (user.username && String(user.username).trim()) return `username:${String(user.username).trim().toLowerCase()}`;
  if (user.email && String(user.email).trim()) return `email:${String(user.email).trim().toLowerCase()}`;
  return '';
}

function _cacheKeyFor(userOrIdentity) {
  const identity = typeof userOrIdentity === 'string'
    ? String(userOrIdentity).trim()
    : _userIdentityKey(userOrIdentity);
  return identity ? `${KEY_PREFIX}:${identity}` : '';
}

function _getActiveIdentity() {
  try {
    const identity = sessionStorage.getItem(LAST_IDENTITY_KEY) || '';
    if (identity) return identity;
    const legacyKey = sessionStorage.getItem(LAST_KEY) || '';
    return legacyKey.startsWith(`${KEY_PREFIX}:`) ? legacyKey.slice(KEY_PREFIX.length + 1) : '';
  } catch { return ''; }
}

function _setActiveIdentity(identity) {
  try {
    if (identity) sessionStorage.setItem(LAST_IDENTITY_KEY, identity);
    else sessionStorage.removeItem(LAST_IDENTITY_KEY);
  } catch {}
}

function _resolveIdentity(userOrIdentity) {
  if (userOrIdentity) {
    return typeof userOrIdentity === 'string'
      ? String(userOrIdentity).trim()
      : _userIdentityKey(userOrIdentity);
  }
  return _getActiveIdentity() || '';
}

function _scopedKey(baseKey, userOrIdentity) {
  const identity = _resolveIdentity(userOrIdentity);
  return identity ? `${baseKey}:${identity}` : '';
}

export function saveUserCache(user) {
  const key = _cacheKeyFor(user);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(user)); } catch {}
  try { sessionStorage.setItem(LAST_KEY, key); } catch {}
  _setActiveIdentity(_userIdentityKey(user));
}

export function loadUserCache(userOrIdentity) {
  const key = userOrIdentity ? _cacheKeyFor(userOrIdentity) : _cacheKeyFor(_getActiveIdentity());
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

export function clearUserCache(userOrIdentity) {
  const key = userOrIdentity ? _cacheKeyFor(userOrIdentity) : _cacheKeyFor(_getActiveIdentity());
  if (!key) {
    try { sessionStorage.removeItem(LAST_KEY); } catch {}
    _setActiveIdentity('');
    return;
  }
  try { localStorage.removeItem(key); } catch {}
  try {
    if (sessionStorage.getItem(LAST_KEY) === key) sessionStorage.removeItem(LAST_KEY);
  } catch {}
  if (!userOrIdentity) _setActiveIdentity('');
}

export function getScopedStorageKey(baseKey, userOrIdentity) {
  return _scopedKey(baseKey, userOrIdentity);
}

export function loadScopedJson(baseKey, fallback = null, userOrIdentity) {
  const key = _scopedKey(baseKey, userOrIdentity);
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveScopedJson(baseKey, value, userOrIdentity) {
  const key = _scopedKey(baseKey, userOrIdentity);
  if (!key) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearScopedJson(baseKey, userOrIdentity) {
  const key = _scopedKey(baseKey, userOrIdentity);
  if (!key) return false;
  try { localStorage.removeItem(key); return true; } catch { return false; }
}

if (typeof window !== 'undefined') {
  window.dpAuthStore = {
    saveUserCache,
    loadUserCache,
    clearUserCache,
    getScopedStorageKey,
    loadScopedJson,
    saveScopedJson,
    clearScopedJson,
    setActiveIdentity: _setActiveIdentity,
    getActiveIdentity: _getActiveIdentity,
    _cacheKeyFor,
  };
}
