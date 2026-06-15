// ── Dreaming Polar Auth Client ────────────────────────────────
// Access Token 存内存，Refresh Token 由后端以 httpOnly Cookie 管理

const BASE = window.location.hostname === 'localhost' ||
             window.location.hostname === '127.0.0.1'
  ? 'http://127.0.0.1:3001/auth'
  : 'https://dp-auth-backend.onrender.com/auth';

let _accessToken = null;

async function authFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
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

window.authClient = { register, login, logout, getMe, authedFetch,
                      silentRefresh, isLoggedIn, getAccessToken };

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
  const go = () => {
    _buildVtBtn();
    silentRefresh().then(ok => { if (ok) _fetchUser(); });
  };
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', go)
    : go();
}

// ── VT button ─────────────────────────────────────────────────
function _buildVtBtn() {
  const vtBottom = document.querySelector('#vertical-toolbar .vt-bottom');
  if (!vtBottom) return;
  const btn = document.createElement('button');
  btn.className = 'vt-btn au-vt-btn';
  btn.id = 'au-vt-btn';
  btn.title = 'Account';
  btn.innerHTML = _USER_SVG;
  btn.addEventListener('click', () => isLoggedIn() ? _toggleProfile() : _openModal('login'));
  vtBottom.appendChild(btn);
}

function _updateVtBtn() {
  const btn = document.getElementById('au-vt-btn');
  if (!btn) return;
  if (_uiUser) {
    btn.innerHTML = `<span class="au-vt-avatar">${_esc(_uiUser.username).slice(0, 2).toUpperCase()}</span>`;
    btn.title = _uiUser.username;
    btn.classList.add('au-logged-in');
  } else {
    btn.innerHTML = _USER_SVG;
    btn.title = 'Account';
    btn.classList.remove('au-logged-in');
  }
}

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
        <p class="au-footer-link">No account? <button type="button" data-switch="register">Create one →</button></p>
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeModal(); });
  document.body.appendChild(_uiOverlay);
}

function _openModal(tab = 'login') {
  _switchTab(tab);
  _uiOverlay.classList.add('au-open');
  requestAnimationFrame(() => {
    _uiOverlay.querySelector(tab === 'login' ? '#au-l-email' : '#au-r-name')?.focus();
  });
}
function _closeModal() {
  _uiOverlay.classList.remove('au-open');
  _uiOverlay.querySelectorAll('.au-err').forEach(e => e.classList.remove('show'));
}
function _switchTab(tab) {
  _uiOverlay.querySelectorAll('.au-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  _uiOverlay.querySelector('#au-login-form').style.display = tab === 'login' ? '' : 'none';
  _uiOverlay.querySelector('#au-reg-form').style.display   = tab === 'register' ? '' : 'none';
  _uiOverlay.querySelectorAll('.au-err').forEach(e => e.classList.remove('show'));
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
    _uiUser = null;
    _updateVtBtn();
    _renderProfile();
    _uiProfile.classList.remove('au-open');
    document.dispatchEvent(new CustomEvent('dp-auth-logout'));
  });
}

// ── Helpers ───────────────────────────────────────────────────
async function _fetchUser() {
  try { _uiUser = await getMe(); } catch { _uiUser = null; }
  _updateVtBtn();
  _renderProfile();
  document.dispatchEvent(new CustomEvent('dp-auth-login', { detail: _uiUser }));
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

_initUI();
