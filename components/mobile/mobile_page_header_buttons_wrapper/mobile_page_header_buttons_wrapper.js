// ── Mobile Header Buttons Wrapper ────────────────────────────────────────────
//  Runs after theme_controller, font_switcher, and language_selector have
//  appended their buttons to <header>. Moves all three into a single
//  grid-trigger dropdown for mobile. On desktop the dropdown is always
//  open (trigger hidden) so layout is unchanged.

import { clearAllCaches, getCacheEntries } from '../../storage_controller/storage_controller.js';

const GRID_ICON = `<svg width="15" height="15" viewBox="0 0 15 15" fill="currentColor" aria-hidden="true">
  <rect x="0.5"  y="0.5"  width="4" height="4" rx="1"/>
  <rect x="5.5"  y="0.5"  width="4" height="4" rx="1"/>
  <rect x="10.5" y="0.5"  width="4" height="4" rx="1"/>
  <rect x="0.5"  y="5.5"  width="4" height="4" rx="1"/>
  <rect x="5.5"  y="5.5"  width="4" height="4" rx="1"/>
  <rect x="10.5" y="5.5"  width="4" height="4" rx="1"/>
  <rect x="0.5"  y="10.5" width="4" height="4" rx="1"/>
  <rect x="5.5"  y="10.5" width="4" height="4" rx="1"/>
  <rect x="10.5" y="10.5" width="4" height="4" rx="1"/>
</svg>`;

const ICON_TERMINAL = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;

function setupMobHeaderWrapper() {
  const header = document.querySelector('header.page-header');
  if (!header) return;

  const themeBtn = header.querySelector('.theme-controller');
  const langWrap = header.querySelector('.lang-btn-wrapper');
  const fontBtn  = header.querySelector('.font-switcher-btn');
  if (!themeBtn && !langWrap && !fontBtn) return;

  // ── Build structure ───────────────────────────────────────────────────────
  const outerWrap = document.createElement('div');
  outerWrap.className = 'mob-hdr-btns-wrapper';

  const trigger = document.createElement('button');
  trigger.className = 'mob-hdr-btns-trigger';
  trigger.setAttribute('aria-label', 'Display settings');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = GRID_ICON;

  const dropdown = document.createElement('div');
  dropdown.className = 'mob-hdr-btns-dropdown';
  // On desktop the trigger is CSS-hidden and dropdown is always inline — never mark it
  // aria-hidden there. On mobile it starts closed, so hide from screen readers + focus.
  if (window.matchMedia('(max-width: 768px)').matches) {
    dropdown.setAttribute('aria-hidden', 'true');
    dropdown.setAttribute('inert', '');
  }

  // ── Cache cell ────────────────────────────────────────────────────────────
  const cacheBtn = document.createElement('button');
  cacheBtn.className = 'mob-hdr-cache-btn';
  cacheBtn.setAttribute('aria-label', '清除缓存');
  cacheBtn.textContent = '⊘';

  // Confirmation shelf (hidden until cacheBtn is tapped)
  const cacheShelf = document.createElement('div');
  cacheShelf.className = 'mob-hdr-cache-shelf';
  cacheShelf.innerHTML = `
    <span class="mob-hdr-cache-shelf-msg"></span>
    <button class="mob-hdr-cache-yes">是</button>
    <button class="mob-hdr-cache-no">否</button>
  `;

  function showShelf() {
    const count = getCacheEntries().length;
    cacheShelf.querySelector('.mob-hdr-cache-shelf-msg').textContent =
      `清除 ${count} 条缓存记录？`;
    cacheShelf.classList.add('visible');
    cacheBtn.classList.add('active');
  }

  function hideShelf() {
    cacheShelf.classList.remove('visible');
    cacheBtn.classList.remove('active');
  }

  cacheBtn.addEventListener('click', () => {
    if (cacheShelf.classList.contains('visible')) { hideShelf(); return; }
    showShelf();
  });

  cacheShelf.querySelector('.mob-hdr-cache-yes').addEventListener('click', () => {
    clearAllCaches();
    hideShelf();
    close();
    location.reload();
  });

  cacheShelf.querySelector('.mob-hdr-cache-no').addEventListener('click', () => {
    hideShelf();
  });

  // ── Terminal cell (mobile only) ───────────────────────────────────────────
  const termBtn = document.createElement('button');
  termBtn.className = 'dp-terminal-toolbar-btn mob-hdr-terminal-btn';
  termBtn.setAttribute('aria-label', '终端');
  termBtn.innerHTML = ICON_TERMINAL;
  termBtn.addEventListener('click', () => {
    const state = window.screenController?.getState('terminal');
    if (state === 'closed' || !state) {
      window.screenController?.open('terminal');
      // Immediately maximise on mobile so the terminal is full-screen on open
      requestAnimationFrame(() => {
        const panel = document.getElementById('terminal-panel');
        if (panel && !panel.classList.contains('terminal--max')) {
          panel.classList.add('terminal--max');
          const maxBtn = panel.querySelector('.term-max-btn');
          if (maxBtn) maxBtn.textContent = '⤡';
        }
      });
    } else {
      window.screenController?.close('terminal');
    }
    close();
  });

  // Sync active state when terminal opens/closes
  document.addEventListener('screen-opened',  ({ detail }) => { if (detail?.id === 'terminal') termBtn.classList.add('active');    });
  document.addEventListener('screen-closed',  ({ detail }) => { if (detail?.id === 'terminal') termBtn.classList.remove('active'); });

  // Wrap each button in a labelled cell
  const CELL_DEFS = [
    { el: themeBtn,  label: '主题' },
    { el: langWrap,  label: '语言' },
    { el: fontBtn,   label: '字体' },
    { el: termBtn,   label: '终端',  cls: 'mob-hdr-terminal-cell' },
    { el: cacheBtn,  label: '缓存', cls: 'mob-hdr-cache-cell' },
  ];

  CELL_DEFS.forEach(({ el, label, cls }) => {
    if (!el) return;
    const cell = document.createElement('div');
    cell.className = 'mob-hdr-btn-cell' + (cls ? ` ${cls}` : '');
    const lbl = document.createElement('span');
    lbl.className   = 'mob-hdr-btn-label';
    lbl.textContent = label;
    cell.appendChild(el);
    cell.appendChild(lbl);
    dropdown.appendChild(cell);
  });

  dropdown.appendChild(cacheShelf);

  outerWrap.appendChild(trigger);
  outerWrap.appendChild(dropdown);
  header.appendChild(outerWrap);

  // ── Toggle ────────────────────────────────────────────────────────────────
  let isOpen = false;

  function open() {
    isOpen = true;
    outerWrap.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    dropdown.setAttribute('aria-hidden', 'false');
    dropdown.removeAttribute('inert');
  }

  function close() {
    isOpen = false;
    outerWrap.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    dropdown.setAttribute('aria-hidden', 'true');
    dropdown.setAttribute('inert', '');
    hideShelf();
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    isOpen ? close() : open();
  });

  document.addEventListener('click', e => {
    if (isOpen && !outerWrap.contains(e.target)) close();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) close();
  });
}

// Modules are deferred — by the time this runs, theme/font/lang buttons
// are already in the DOM (no DOMContentLoaded listener needed).
setupMobHeaderWrapper();

// ── Mobile Auth Panel ─────────────────────────────────────────────────────────
// Adds a user icon button to the mobile header. Tapping opens a full-screen
// panel (below the header) with login/register or profile content.
// auth_client.js loads after this module, so auth state is read via events.

(function setupMobAuth() {
  const header = document.querySelector('header.page-header');
  if (!header) return;

  const _USER_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const _OUT_SVG  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

  // ── Header button ───────────────────────────────────────────────────────────
  const authBtn = document.createElement('button');
  authBtn.className = 'mob-auth-btn';
  authBtn.setAttribute('aria-label', 'Account');
  authBtn.innerHTML = _USER_SVG;

  // Place auth button as a cell inside the existing dropdown
  const dropdown = header.querySelector('.mob-hdr-btns-dropdown');
  if (dropdown) {
    const authCell = document.createElement('div');
    authCell.className = 'mob-hdr-btn-cell mob-hdr-auth-cell';
    const authLbl = document.createElement('span');
    authLbl.className = 'mob-hdr-btn-label';
    authLbl.textContent = '账号';
    authCell.append(authBtn, authLbl);
    // Insert before cache shelf (last element) so it appears at the end of the grid
    const shelf = dropdown.querySelector('.mob-hdr-cache-shelf');
    shelf ? dropdown.insertBefore(authCell, shelf) : dropdown.appendChild(authCell);
  }

  // ── Panel ───────────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'mob-auth-panel';
  document.body.appendChild(panel);

  let _user    = null;
  let _isMax   = false;
  let _isOpen  = false;

  // ── Panel header (persists across views) ────────────────────────────────────
  const panelHdr = document.createElement('div');
  panelHdr.className = 'mob-auth-panel-hdr';

  const panelTitle = document.createElement('span');
  panelTitle.className = 'mob-auth-panel-title';
  panelTitle.textContent = '账号';

  const maxBtn = document.createElement('button');
  maxBtn.className = 'sc-btn mob-auth-max-btn';
  maxBtn.title = 'Maximize';
  maxBtn.textContent = '⤢';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sc-btn mob-auth-close-btn';
  closeBtn.title = 'Close';
  closeBtn.textContent = '−';

  const hdrToolbar = document.createElement('div');
  hdrToolbar.className = 'sc-toolbar';
  hdrToolbar.append(maxBtn, closeBtn);
  panelHdr.append(panelTitle, hdrToolbar);

  const panelBody = document.createElement('div');
  panelBody.className = 'mob-auth-panel-body';

  panel.append(panelHdr, panelBody);

  // ── Open / close / maximize ─────────────────────────────────────────────────
  function openPanel() {
    _isOpen = true;
    panel.classList.add('open');
    render();
  }

  function closePanel() {
    _isOpen = false;
    panel.classList.remove('open');
    panel.classList.remove('maximized');
    _isMax = false;
    maxBtn.textContent = '⤢';
  }

  maxBtn.addEventListener('click', () => {
    _isMax = !_isMax;
    panel.classList.toggle('maximized', _isMax);
    maxBtn.textContent = _isMax ? '⤡' : '⤢';
  });

  closeBtn.addEventListener('click', closePanel);

  authBtn.addEventListener('click', e => {
    e.stopPropagation();
    // Close the settings dropdown first
    header.querySelector('.mob-hdr-btns-wrapper')?.classList.remove('open');
    _isOpen ? closePanel() : openPanel();
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _isOpen) closePanel(); });

  // ── Render ──────────────────────────────────────────────────────────────────
  function _esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render() {
    _user ? renderProfile() : renderAuth();
    updateAuthBtn();
  }

  function renderAuth() {
    panelTitle.textContent = '账号';
    panelBody.innerHTML = `
      <div class="mob-auth-tabs">
        <button class="mob-auth-tab active" data-tab="login">登录</button>
        <button class="mob-auth-tab" data-tab="register">注册</button>
      </div>

      <form class="mob-auth-form" id="mob-login-form">
        <div class="au-field">
          <label class="au-lbl" for="mob-l-email">Email</label>
          <input class="au-input" id="mob-l-email" type="email" placeholder="you@example.com" autocomplete="email" required>
        </div>
        <div class="au-field">
          <label class="au-lbl" for="mob-l-pass">Password</label>
          <input class="au-input" id="mob-l-pass" type="password" placeholder="••••••••" autocomplete="current-password" required>
        </div>
        <div class="au-err" id="mob-l-err"></div>
        <button class="au-submit" type="submit">登录</button>
      </form>

      <form class="mob-auth-form" id="mob-reg-form" style="display:none">
        <div class="au-field">
          <label class="au-lbl" for="mob-r-name">用户名</label>
          <input class="au-input" id="mob-r-name" type="text" placeholder="极地" autocomplete="username" required>
        </div>
        <div class="au-field">
          <label class="au-lbl" for="mob-r-email">Email</label>
          <input class="au-input" id="mob-r-email" type="email" placeholder="you@example.com" autocomplete="email" required>
        </div>
        <div class="au-field">
          <label class="au-lbl" for="mob-r-pass">Password</label>
          <input class="au-input" id="mob-r-pass" type="password" placeholder="至少 8 位" autocomplete="new-password" required>
        </div>
        <div class="au-err" id="mob-r-err"></div>
        <button class="au-submit" type="submit">注册</button>
      </form>`;

    // Tab switching
    panelBody.querySelectorAll('.mob-auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panelBody.querySelectorAll('.mob-auth-tab').forEach(t => t.classList.toggle('active', t === tab));
        panelBody.querySelector('#mob-login-form').style.display = tab.dataset.tab === 'login'    ? '' : 'none';
        panelBody.querySelector('#mob-reg-form').style.display   = tab.dataset.tab === 'register' ? '' : 'none';
        panelBody.querySelectorAll('.au-err').forEach(e => e.classList.remove('show'));
      });
    });

    // Login handler
    panelBody.querySelector('#mob-login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector('.au-submit'), err = panelBody.querySelector('#mob-l-err');
      btn.disabled = true; btn.textContent = '登录中…'; err.classList.remove('show');
      try {
        await window.authClient.login(
          f.querySelector('#mob-l-email').value.trim(),
          f.querySelector('#mob-l-pass').value
        );
        _user = await window.authClient.getMe();
        document.dispatchEvent(new CustomEvent('dp-auth-login', { detail: _user }));
        render();
      } catch (ex) {
        err.textContent = ex.message || '登录失败';
        err.classList.add('show');
        btn.disabled = false; btn.textContent = '登录';
      }
    });

    // Register handler
    panelBody.querySelector('#mob-reg-form').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector('.au-submit'), err = panelBody.querySelector('#mob-r-err');
      btn.disabled = true; btn.textContent = '注册中…'; err.classList.remove('show');
      try {
        const email = f.querySelector('#mob-r-email').value.trim();
        await window.authClient.register(f.querySelector('#mob-r-name').value.trim(), email, f.querySelector('#mob-r-pass').value);
        await window.authClient.login(email, f.querySelector('#mob-r-pass').value);
        _user = await window.authClient.getMe();
        document.dispatchEvent(new CustomEvent('dp-auth-login', { detail: _user }));
        render();
      } catch (ex) {
        err.textContent = ex.message || '注册失败';
        err.classList.add('show');
        btn.disabled = false; btn.textContent = '注册';
      }
    });
  }

  function renderProfile() {
    const joined   = _user?.created_at
      ? new Date(_user.created_at * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';
    const initials = (_user?.username ?? '?').slice(0, 2).toUpperCase();
    panelTitle.textContent = _user?.username ?? '账号';
    panelBody.innerHTML = `
      <div class="mob-auth-profile">
        <div class="au-profile-head">
          <div class="au-profile-avatar">${initials}</div>
          <div>
            <div class="au-profile-name">${_esc(_user?.username)}</div>
            <div class="au-profile-email">${_esc(_user?.email)}</div>
          </div>
        </div>
        <div class="au-profile-stats">
          <div class="au-profile-row">
            <span class="au-profile-key">加入时间</span>
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
          <button class="au-logout" id="mob-auth-logout">${_OUT_SVG} 退出登录</button>
        </div>
      </div>`;

    panelBody.querySelector('#mob-auth-logout').addEventListener('click', async () => {
      await window.authClient.logout().catch(() => {});
      _user = null;
      document.dispatchEvent(new CustomEvent('dp-auth-logout'));
      render();
    });
  }

  function updateAuthBtn() {
    if (_user) {
      const initials = (_user.username ?? '?').slice(0, 2).toUpperCase();
      authBtn.innerHTML = `<span class="au-vt-avatar" style="font-size:0.6rem">${initials}</span>`;
      authBtn.title = _user.username;
      authBtn.classList.add('mob-auth-btn--in');
    } else {
      authBtn.innerHTML = _USER_SVG;
      authBtn.title = 'Account';
      authBtn.classList.remove('mob-auth-btn--in');
    }
  }

  // ── Auth event listeners ─────────────────────────────────────────────────────
  document.addEventListener('dp-auth-login', ({ detail }) => {
    _user = detail;
    updateAuthBtn();
    if (_isOpen) render();
  });

  document.addEventListener('dp-auth-logout', () => {
    _user = null;
    updateAuthBtn();
    if (_isOpen) render();
  });
}());
