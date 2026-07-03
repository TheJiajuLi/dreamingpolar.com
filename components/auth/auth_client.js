// ── Dreaming Polar Auth Client ────────────────────────────────
// Access Token 存内存，Refresh Token 由后端以 httpOnly Cookie 管理
import { saveUserCache, loadUserCache, clearUserCache } from './auth_hooks.js';
import { initSync } from '../shared/notebook_sync.js';

const AUTH_BASE = 'https://api.dreamingpolar.com/auth';

const KEEP_LS_KEYS = new Set([
  'theme',
  'mathfield-font',
  'dreaming-polar-lang',
  'dp-settings',
  'dp-rb-open',
  'dp-rb-pane',
  'dp-last-user-id',
  'dp-last-user-key',
]);

const KEEP_LS_PREFIXES = [
  'dp-screen-',
  'dp-nudge-snooze-',
];

function _shouldClearLocalStorageKey(key) {
  if (!key) return false;
  if (KEEP_LS_KEYS.has(key)) return false;
  if (KEEP_LS_PREFIXES.some((p) => key.startsWith(p))) return false;

  // Clear all user/business state on account switch/logout.
  return key.startsWith('dp-') || key.startsWith('dreaming-polar-');
}

function _shouldClearSessionStorageKey(key) {
  if (!key) return false;
  return key.startsWith('dp-') || key.startsWith('dreaming-polar-');
}

function clearBusinessCache() {
  const lsKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) lsKeys.push(k);
  }
  lsKeys.forEach((k) => {
    if (!_shouldClearLocalStorageKey(k)) return;
    try { localStorage.removeItem(k); } catch (_) {}
  });

  const ssKeys = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (k) ssKeys.push(k);
  }
  ssKeys.forEach((k) => {
    if (!_shouldClearSessionStorageKey(k)) return;
    try { sessionStorage.removeItem(k); } catch (_) {}
  });
}

function _userIdentityKey(user) {
  if (!user || typeof user !== 'object') return '';
  if (user.id != null && String(user.id).trim()) return `id:${String(user.id).trim()}`;
  if (user.username && String(user.username).trim()) return `username:${String(user.username).trim().toLowerCase()}`;
  if (user.email && String(user.email).trim()) return `email:${String(user.email).trim().toLowerCase()}`;
  return '';
}

function _syncUserFromStorage() {
  const cached = loadUserCache();
  const nextUser = (cached && typeof cached === 'object') ? cached : null;
  const prevKey = _userIdentityKey(_uiUser);
  const nextKey = _userIdentityKey(nextUser);

  if (prevKey && nextKey && prevKey !== nextKey) {
    clearBusinessCache();
  }

  if (prevKey === nextKey) return;

  _uiUser = nextUser;
  _updateVtBtn();
  _renderProfile();
  document.dispatchEvent(new CustomEvent('dp-auth-state', { detail: { user: _uiUser } }));
}

function _bindCrossTabAuthSync() {
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== localStorage) return;
    if (e.key && !['dp-auth-user', 'dp-last-user-key', 'dp-last-user-id'].includes(e.key)) return;
    _syncUserFromStorage();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    _syncUserFromStorage();
  });
}

let _accessToken = null;
let _authInitPromise = null;
let _authInited = false;

async function authFetch(path, opts = {}) {
  const res = await fetch(`${AUTH_BASE}${path}`, {
    ...opts,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message ?? '请求失败'), { status: res.status });
  return data;
}

export async function register(username, email, password) {
  return authFetch('/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  });
}

export async function login(email, password) {
  const data = await authFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  _accessToken = data.accessToken;
  _scheduleRefresh(14 * 60 * 1000);
  return data;
}

let _refreshTimer = null;

function _scheduleRefresh(ms) {
  clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(silentRefresh, ms);
}

export async function silentRefresh() {
  try {
    const data   = await authFetch('/refresh', { method: 'POST' });
    _accessToken = data.accessToken;
    _scheduleRefresh(14 * 60 * 1000);
    return true;
  } catch {
    _accessToken = null;
    return false;
  }
}

export async function logout() {
  clearTimeout(_refreshTimer);
  await authFetch('/logout', { method: 'POST' }).catch(() => {});
  _accessToken = null;
  clearBusinessCache();
  clearUserCache();
  try { localStorage.removeItem('dp-last-user-id'); } catch (_) {}
  try { localStorage.removeItem('dp-last-user-key'); } catch (_) {}
}

export async function getMe() {
  if (!_accessToken) throw new Error('未登录');
  return authFetch('/me', {
    headers: { Authorization: `Bearer ${_accessToken}` },
  });
}

export async function authedFetch(url, opts = {}) {
  if (!_accessToken) throw new Error('未登录');
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_accessToken}`,
      ...(opts.headers ?? {}),
    },
  });
}

export const isLoggedIn = () => !!_accessToken;
export const getAccessToken = () => _accessToken;

export async function forgotPassword(email) {
  return authFetch('/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token, newPassword) {
  return authFetch('/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });
}

export async function updateMe(data) {
  if (!_accessToken) throw new Error('未登录');
  return authFetch('/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${_accessToken}` },
    body: JSON.stringify(data),
  });
}

export async function updateMeAvatar(avatar) {
  if (!_accessToken) throw new Error('未登录');
  return authFetch('/me/avatar', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${_accessToken}` },
    body: JSON.stringify({ avatar }),
  });
}

export async function updateMeBio(bio) {
  if (!_accessToken) throw new Error('未登录');
  return authFetch('/me/bio', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${_accessToken}` },
    body: JSON.stringify({ bio }),
  });
}

window.authClient = { register, login, logout, getMe, updateMe, updateMeAvatar, updateMeBio, authedFetch,
                      silentRefresh, isLoggedIn, getAccessToken,
                      forgotPassword, resetPassword,
                      showResetPassword: (token) => _buildResetPage(token) };

export function initAuth() {
  if (_authInited) return Promise.resolve(window.authClient);
  if (_authInitPromise) return _authInitPromise;

  _authInitPromise = Promise.resolve().then(() => {
    _initUI();
    _authInited = true;
    return window.authClient;
  });

  return _authInitPromise;
}

// ══════════════════════════════════════════════════════════════
//  AUTH UI  — vertical toolbar button + modal + profile panel
// ══════════════════════════════════════════════════════════════

const _USER_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
const _X_SVG    = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const _OUT_SVG  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

let _uiUser    = null;
let _uiOverlay = null;
let _uiProfile = null;

function _initUI() {
  _buildOverlay();
  _buildProfile();
  _bindCrossTabAuthSync();
  const go = () => {
    setupUserScreen();
    _buildVtBtn();
    // Restore UI immediately from cache, then verify with silentRefresh
    const cached = loadUserCache();
    if (cached) { _uiUser = cached; _updateVtBtn(); _renderProfile(); }
    silentRefresh().then(ok => {
      if (ok) {
        _fetchUser();
      } else {
        clearUserCache();
        _uiUser = null;
        _updateVtBtn();
        _renderProfile();
      }
    });
  };
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', go)
    : go();

  // ── Reset-password page: detect ?token= in URL ────────────────────────────
  const _resetToken = new URLSearchParams(location.search).get('token');
  if (_resetToken) {
    const _doReset = () => _buildResetPage(_resetToken);
    document.readyState === 'loading'
      ? document.addEventListener('DOMContentLoaded', _doReset)
      : _doReset();
  }
}

// ── Auth button is now in the VT bottom, set up by setupUserScreen() ──────────
function _buildVtBtn() {
  // Button is in VT bottom, set up by setupUserScreen() below
  document.dispatchEvent(new CustomEvent('dp-auth-state', { detail: { user: _uiUser } }));
}

function _updateVtBtn() {
  // Dispatch state so any listener (right bar) can update
  document.dispatchEvent(new CustomEvent('dp-auth-state', {
    detail: { user: _uiUser }
  }));
}

// Expose for other modules to call directly
window._dpAuthOpenPanel  = () => window.screenController?.open('user');
window._dpAuthOpenLogin  = (tab = 'login') => _openModal(tab);
window._dpGetAuthUser    = () => _uiUser;
window._dpAuthLogout     = async () => {
  await logout();
  clearUserCache();
  _uiUser = null;
  _updateVtBtn();
  _renderProfile();
  document.dispatchEvent(new CustomEvent('dp-auth-logout'));
};

// ── Modal ─────────────────────────────────────────────────────
function _buildOverlay() {
  _uiOverlay = document.createElement('div');
  _uiOverlay.className = 'au-overlay';
  _uiOverlay.innerHTML = `
    <div class="au-modal" role="dialog" aria-modal="true">
      <div class="au-modal-top">
        <span class="au-brand-tag">Dreaming Polar</span>
        <button class="au-x-btn" aria-label="Close">${_X_SVG}</button>
      </div>
      <div class="au-tabs">
        <button class="au-tab active" data-tab="login">Sign in</button>
        <button class="au-tab" data-tab="register">Create account</button>
      </div>

      <form class="au-form" id="au-login-form">
        <div class="au-field">
          <label class="au-lbl" for="au-l-email">Email</label>
          <input class="au-input" id="au-l-email" type="email" placeholder="you@example.com" autocomplete="email" required>
        </div>
        <div class="au-field">
          <label class="au-lbl" for="au-l-pass">Password</label>
          <input class="au-input" id="au-l-pass" type="password" placeholder="••••••••" autocomplete="current-password" required>
        </div>
        <div class="au-err" id="au-l-err"></div>
        <button class="au-submit" type="submit">Sign in</button>
        <p class="au-footer-link"><button type="button" data-switch="forgot">忘记密码？</button></p>
        <p class="au-footer-link">No account? <button type="button" data-switch="register">Create one →</button></p>
      </form>

      <form class="au-form" id="au-forgot-form" style="display:none">
        <div class="au-field">
          <label class="au-lbl" for="au-f-email">注册邮箱</label>
          <input class="au-input" id="au-f-email" type="email" placeholder="you@example.com" autocomplete="email" required>
        </div>
        <div class="au-err" id="au-f-err"></div>
        <div class="au-success" id="au-f-ok" style="display:none"></div>
        <button class="au-submit" type="submit">发送重置链接</button>
        <p class="au-footer-link">想起来了？<button type="button" data-switch="login">返回登录 →</button></p>
      </form>

      <form class="au-form" id="au-reg-form" style="display:none">
        <div class="au-field">
          <label class="au-lbl" for="au-r-name">Username</label>
          <input class="au-input" id="au-r-name" type="text" placeholder="极地" autocomplete="username" required>
        </div>
        <div class="au-field">
          <label class="au-lbl" for="au-r-email">Email</label>
          <input class="au-input" id="au-r-email" type="email" placeholder="you@example.com" autocomplete="email" required>
        </div>
        <div class="au-field">
          <label class="au-lbl" for="au-r-pass">Password</label>
          <input class="au-input" id="au-r-pass" type="password" placeholder="Min 8 characters" autocomplete="new-password" required>
        </div>
        <div class="au-err" id="au-r-err"></div>
        <button class="au-submit" type="submit">Create account</button>
        <p class="au-footer-link">Have an account? <button type="button" data-switch="login">Sign in →</button></p>
      </form>
    </div>`;

  _uiOverlay.addEventListener('click', e => { if (e.target === _uiOverlay) _closeModal(); });
  _uiOverlay.querySelector('.au-x-btn').addEventListener('click', _closeModal);
  _uiOverlay.querySelectorAll('.au-tab').forEach(t => t.addEventListener('click', () => _switchTab(t.dataset.tab)));
  _uiOverlay.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', () => _switchTab(b.dataset.switch)));
  _uiOverlay.querySelector('#au-login-form').addEventListener('submit', _handleLogin);
  _uiOverlay.querySelector('#au-reg-form').addEventListener('submit', _handleReg);
  _uiOverlay.querySelector('#au-forgot-form').addEventListener('submit', _handleForgot);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeModal(); });
  document.body.appendChild(_uiOverlay);
}

function _openModal(tab = 'login') {
  _switchTab(tab);
  _uiOverlay.classList.add('au-open');
  requestAnimationFrame(() => {
    const focusMap = { login: '#au-l-email', register: '#au-r-name', forgot: '#au-f-email' };
    _uiOverlay.querySelector(focusMap[tab] ?? '#au-l-email')?.focus();
  });
}
function _closeModal() {
  _uiOverlay.classList.remove('au-open');
  _uiOverlay.querySelectorAll('.au-err').forEach(e => e.classList.remove('show'));
}
function _switchTab(tab) {
  _uiOverlay.querySelectorAll('.au-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  _uiOverlay.querySelector('#au-login-form').style.display  = tab === 'login'    ? '' : 'none';
  _uiOverlay.querySelector('#au-reg-form').style.display    = tab === 'register' ? '' : 'none';
  _uiOverlay.querySelector('#au-forgot-form').style.display = tab === 'forgot'   ? '' : 'none';
  _uiOverlay.querySelectorAll('.au-err').forEach(e => e.classList.remove('show'));
  const okEl = _uiOverlay.querySelector('#au-f-ok');
  if (okEl) okEl.style.display = 'none';
}

// ── Form handlers ─────────────────────────────────────────────
async function _handleLogin(e) {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('.au-submit'), err = f.querySelector('.au-err');
  btn.disabled = true; btn.textContent = 'Signing in…'; err.classList.remove('show');
  try {
    await login(f.querySelector('#au-l-email').value.trim(), f.querySelector('#au-l-pass').value);
    await _fetchUser(); _closeModal();
  } catch (ex) { err.textContent = ex.message || 'Login failed'; err.classList.add('show'); }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
}

async function _handleReg(e) {
  e.preventDefault();
  const f = e.target, btn = f.querySelector('.au-submit'), err = f.querySelector('.au-err');
  btn.disabled = true; btn.textContent = 'Creating…'; err.classList.remove('show');
  try {
    const email = f.querySelector('#au-r-email').value.trim();
    await register(f.querySelector('#au-r-name').value.trim(), email, f.querySelector('#au-r-pass').value);
    await login(email, f.querySelector('#au-r-pass').value);
    await _fetchUser(); _closeModal();
  } catch (ex) { err.textContent = ex.message || 'Registration failed'; err.classList.add('show'); }
  finally { btn.disabled = false; btn.textContent = 'Create account'; }
}

async function _handleForgot(e) {
  e.preventDefault();
  const f   = e.target;
  const btn = f.querySelector('.au-submit');
  const err = f.querySelector('.au-err');
  const ok  = f.querySelector('#au-f-ok');
  btn.disabled = true; btn.textContent = '发送中…'; err.classList.remove('show');
  ok.style.display = 'none';
  try {
    await forgotPassword(f.querySelector('#au-f-email').value.trim());
    ok.textContent = '✓ 重置链接已发送，请查收邮件';
    ok.style.display = '';
    btn.style.display = 'none';
  } catch (ex) {
    err.textContent = ex.message || '发送失败，请稍后重试';
    err.classList.add('show');
    btn.disabled = false; btn.textContent = '发送重置链接';
  }
}

// ── Reset password page (detected from URL ?token=) ──────────────────────────
function _buildResetPage(token) {
  if (document.getElementById('au-reset-overlay')) return; // guard: already shown
  const overlay = document.createElement('div');
  overlay.id = 'au-reset-overlay';
  overlay.className = 'au-overlay au-open';
  overlay.innerHTML = `
    <div class="au-modal" role="dialog" aria-modal="true">
      <div class="au-modal-top">
        <span class="au-brand-tag">Dreaming Polar</span>
      </div>
      <form class="au-form" id="au-reset-form">
        <div class="au-field">
          <label class="au-lbl" for="au-rp-pass">新密码</label>
          <input class="au-input" id="au-rp-pass" type="password" placeholder="至少 8 位" minlength="8" autocomplete="new-password" required>
        </div>
        <div class="au-field">
          <label class="au-lbl" for="au-rp-pass2">确认新密码</label>
          <input class="au-input" id="au-rp-pass2" type="password" placeholder="再输一次" minlength="8" autocomplete="new-password" required>
        </div>
        <div class="au-err" id="au-rp-err"></div>
        <div class="au-success" id="au-rp-ok" style="display:none"></div>
        <button class="au-submit" type="submit" id="au-rp-btn">重置密码</button>
      </form>
    </div>`;

  document.body.appendChild(overlay);

  overlay.querySelector('#au-reset-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn  = overlay.querySelector('#au-rp-btn');
    const err  = overlay.querySelector('#au-rp-err');
    const ok   = overlay.querySelector('#au-rp-ok');
    const p1   = overlay.querySelector('#au-rp-pass').value;
    const p2   = overlay.querySelector('#au-rp-pass2').value;
    err.classList.remove('show');

    if (p1 !== p2) {
      err.textContent = '两次密码不一致';
      err.classList.add('show');
      return;
    }

    btn.disabled = true; btn.textContent = '重置中…';
    try {
      await resetPassword(token, p1);
      ok.textContent = '✓ 密码已重置，3 秒后跳转登录';
      ok.style.display = '';
      btn.style.display = 'none';
      setTimeout(() => {
        overlay.remove();
        const url = new URL(location.href);
        url.searchParams.delete('token');
        history.replaceState(null, '', url.toString());
        _openModal('login');
      }, 3000);
    } catch (ex) {
      const expired = /expired|invalid|used/i.test(ex.message ?? '');
      err.innerHTML = expired
        ? `链接已失效，请重新申请 — <button type="button" class="au-rp-resend">重新发送</button>`
        : (ex.message || '重置失败');
      err.classList.add('show');
      err.querySelector('.au-rp-resend')?.addEventListener('click', () => {
        overlay.remove();
        _openModal('forgot');
      });
      btn.disabled = false; btn.textContent = '重置密码';
    }
  });
}

// ── Profile panel ─────────────────────────────────────────────
function _buildProfile() {
  _uiProfile = document.createElement('div');
  _uiProfile.className = 'au-profile';
  document.body.appendChild(_uiProfile);
  document.addEventListener('click', e => {
    if (_uiProfile.classList.contains('au-open') &&
        !_uiProfile.contains(e.target) && !e.target.closest('#au-vt-btn'))
      _uiProfile.classList.remove('au-open');
  });
}

function _toggleProfile() { _uiProfile.classList.toggle('au-open'); }

function _renderProfile() {
  if (!_uiUser) { _uiProfile.innerHTML = ''; return; }
  const joined   = new Date(_uiUser.created_at * 1000)
    .toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  const initials = (_uiUser.username ?? '?').slice(0, 2).toUpperCase();
  _uiProfile.innerHTML = `
    <div class="au-profile-head">
      <div class="au-profile-avatar">${initials}</div>
      <div>
        <div class="au-profile-name">${_esc(_uiUser.username)}</div>
        <div class="au-profile-email">${_esc(_uiUser.email)}</div>
      </div>
    </div>
    <div class="au-profile-stats">
      <div class="au-profile-row">
        <span class="au-profile-key">Joined</span>
        <span class="au-profile-val">${joined}</span>
      </div>
      <div class="au-profile-row">
        <span class="au-profile-key">Templates</span>
        <span class="au-phase-badge">Phase 2</span>
      </div>
      <div class="au-profile-row">
        <span class="au-profile-key">Notebooks</span>
        <span class="au-phase-badge">Phase 2</span>
      </div>
    </div>
    <div class="au-profile-actions">
      <button class="au-logout" id="au-logout-btn">${_OUT_SVG} Sign out</button>
    </div>`;
  _uiProfile.querySelector('#au-logout-btn').addEventListener('click', async () => {
    await logout();
    clearUserCache();
    _uiUser = null;
    _updateVtBtn();
    _renderProfile();
    _uiProfile.classList.remove('au-open');
    document.dispatchEvent(new CustomEvent('dp-auth-logout'));
  });
}

// ── Helpers ───────────────────────────────────────────────────
async function _fetchUser() {
  try {
    _uiUser = await getMe();

    const prevUserKey = localStorage.getItem('dp-last-user-key') || localStorage.getItem('dp-last-user-id') || '';
    const currentUserKey = _userIdentityKey(_uiUser);

    if (prevUserKey && currentUserKey && prevUserKey !== currentUserKey) {
      // 用户切换，清空旧缓存
      clearBusinessCache();
      clearUserCache();
    }

    if (currentUserKey) {
      localStorage.setItem('dp-last-user-key', currentUserKey);
      if (currentUserKey.startsWith('id:')) {
        localStorage.setItem('dp-last-user-id', currentUserKey.slice(3));
      }
    }

    saveUserCache(_uiUser);
  } catch {
    _uiUser = null;
  }
  _updateVtBtn();
  _renderProfile();
  document.dispatchEvent(new CustomEvent('dp-auth-login', { detail: _uiUser }));
  if (_uiUser) initSync();
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setupUserScreen() {
  const screen = document.getElementById('user-screen');
  if (!screen) return;

  // Register with screenController — same pattern as other hero screens
  // Double rAF ensures screenController exists before registering
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.screenController?.register('user', screen, {
      label: '账号', group: 'hero', persisted: false, defaultOpen: false, noChip: true
    });
    // Force closed so it doesn't appear in split view on load
    window.screenController?.close('user');
  }));

  screen.className += ' user-screen';

  const inner = document.createElement('div');
  inner.className = 'user-screen-inner';
  screen.appendChild(inner);

  function _render() {
    const user = _uiUser;
    if (user) {
      const initials = (user.username ?? '?').slice(0, 2).toUpperCase();
      const joined   = new Date((user.created_at ?? 0) * 1000)
        .toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      inner.innerHTML = `
        <div class="usr-card">
          <div class="usr-avatar">${initials}</div>
          <div class="usr-name">${_esc(user.username)}</div>
          <div class="usr-email">${_esc(user.email)}</div>
          <div class="usr-joined">加入于 ${joined}</div>
        </div>
        <div class="usr-features">
          <div class="usr-feature-row">
            <span class="usr-feature-label">Notebooks</span>
            <span class="usr-badge">Phase 2</span>
          </div>
          <div class="usr-feature-row">
            <span class="usr-feature-label">Templates</span>
            <span class="usr-badge">Phase 2</span>
          </div>
        </div>
        <button class="usr-logout-btn" id="usr-logout">
          <i class="ti ti-logout"></i> 退出登录
        </button>`;
      inner.querySelector('#usr-logout')?.addEventListener('click', async () => {
        await window._dpAuthLogout?.();
        _render();
      });
    } else {
      inner.innerHTML = `
        <div class="usr-guest">
          <div class="usr-guest-icon"><i class="ti ti-user-circle"></i></div>
          <h3 class="usr-guest-title">登录 Dreaming Polar</h3>
          <p class="usr-guest-sub">保存 Notebook，同步数据，解锁更多功能</p>
          <button class="usr-login-btn" id="usr-login">
            <i class="ti ti-login"></i> 登录
          </button>
          <button class="usr-reg-btn" id="usr-reg">
            创建账号
          </button>
        </div>`;
      inner.querySelector('#usr-login')?.addEventListener('click', () => window._dpAuthOpenLogin?.('login'));
      inner.querySelector('#usr-reg')?.addEventListener('click',   () => window._dpAuthOpenLogin?.('register'));
    }
  }

  _render();
  document.addEventListener('dp-auth-state', () => _render());

  // VT user button is now created in file_manager.js (same pattern as fullscreen btn)

  window._dpAuthOpenPanel = () => window.screenController?.open('user');
}

initAuth();
