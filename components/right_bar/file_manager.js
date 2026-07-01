// ── File Manager — right bar panel ───────────────────────────────────────────
// Unified file import centre: files imported here are immediately available
// to both Notebook (py.FS) and Quick Analysis (dataset_store / ARIA tabs).
// No "select destination" step — import once, use everywhere.

import { setDataset, removeDataset, getAllDatasets } from '../shared/dataset_store.js';
import { ensureXlsx, parseToDataset }    from '../import/import_data.js';
import { writeToFS }                     from '../compiler/compiler.js';
import { createSettingsPanel, getSettings } from './settings.js';
import { logActivity } from '../shared/activity_logger.js';

const INJECT_KEY      = 'dreaming-polar-inject-store';
const CODE_FILE_KEY   = 'dp-code-file-store';
const RECENT_FILES_KEY = 'dp_recent_files';
const MAX_RECENT_FILES = 10;

// ── Context-aware action button (screen-dependent label & routing) ─────────────
const _ARIA_BTN_ICON = `<svg width="14" height="14" viewBox="3 3 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="display:block;pointer-events:none"><circle cx="12" cy="12" r="2.2"/><circle cx="5.5" cy="5.5" r="1.4"/><circle cx="18.5" cy="5.5" r="1.4"/><circle cx="5.5" cy="18.5" r="1.4"/><circle cx="18.5" cy="18.5" r="1.4"/><line x1="12" y1="9.8" x2="6.8" y2="6.8"/><line x1="12" y1="9.8" x2="17.2" y2="6.8"/><line x1="12" y1="14.2" x2="6.8" y2="17.2"/><line x1="12" y1="14.2" x2="17.2" y2="17.2"/></svg>`;

const SCREEN_ACTION_META = {
  'coding':   { label: '插入至 Notebook', icon: 'ti-corner-down-left' },
  'terminal': { label: '发送给 ARIA',     icon: _ARIA_BTN_ICON        },
  'grid':     { label: '发送给 DP Grid',  icon: 'ti-table'            },
  'ai-chat':  { label: '发送给 AI 对话',  icon: 'ti-message'          },
  'profile':  { label: '插入至 Notebook', icon: 'ti-corner-down-left' },
  'content':  { label: '插入至 Notebook', icon: 'ti-corner-down-left' },
};
const _DEFAULT_ACTION = { label: '插入至 Notebook', icon: 'ti-corner-down-left' };

let _activeScreenId = null;
const _actionBtns   = new Set();   // all live data-file action buttons

function _getActionMeta() {
  return SCREEN_ACTION_META[_activeScreenId] ?? _DEFAULT_ACTION;
}
function _applyActionBtn(btn) {
  const { label, icon } = _getActionMeta();
  btn.title         = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML     = icon.startsWith('<') ? icon : `<i class="ti ${icon}"></i>`;
}
function _refreshAllActionBtns() {
  for (const btn of _actionBtns) {
    if (!btn.isConnected) { _actionBtns.delete(btn); continue; }
    _applyActionBtn(btn);
  }
}

function _recordRecentFile({ name, varName, size, fileType }) {
  let files;
  try { files = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '[]'); } catch { files = []; }
  files = files.filter(f => f.name !== name);
  files.unshift({ name, varName, size, fileType, openedAt: Date.now() });
  try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files.slice(0, MAX_RECENT_FILES))); } catch (_) {}
}

const LANG_ICON = {
  python:   'ti-brand-python',
  markdown: 'ti-markdown',
  latex:    'ti-math',
  mathjax:  'ti-code',
};
const LANG_COLOR = {
  python:   '#3b82f6',
  markdown: '#10b981',
  latex:    '#8b5cf6',
  mathjax:  '#f59e0b',
};
const LANG_EXT = {
  python: '.py', markdown: '.md', latex: '.tex', mathjax: '.html',
};

function _loadCodeStore() {
  try { return JSON.parse(localStorage.getItem(CODE_FILE_KEY) ?? '{}'); } catch { return {}; }
}
function _saveCodeStore(store) {
  try { localStorage.setItem(CODE_FILE_KEY, JSON.stringify(store)); } catch {}
}

const TYPE_ICON = {
  csv:  'ti-file-type-csv',
  json: 'ti-file-type-json',
  xlsx: 'ti-file-spreadsheet',
  xls:  'ti-file-spreadsheet',
  xml:  'ti-file-code-2',
};

// ── inject-store helpers ──────────────────────────────────────────────────────
function _loadStore() {
  try { return JSON.parse(localStorage.getItem(INJECT_KEY) ?? '{}'); }
  catch { return {}; }
}

function _saveStore(store) {
  try { localStorage.setItem(INJECT_KEY, JSON.stringify(store)); }
  catch (e) { console.warn('[file-manager] localStorage quota exceeded:', e.message); }
}

// ── Parse entry → dataset {columns, dtypes, rows} ─────────────────────────────
async function _parseEntry(entry) {
  const { fileType, filename, data: raw, isBase64 } = entry;
  const isExcel = fileType === 'xlsx' || fileType === 'xls';

  if (isExcel) {
    const XLSX = await ensureXlsx();
    const binary = atob(raw);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const wb  = XLSX.read(bytes, { type: 'array' });
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
    return parseToDataset(csv, filename);
  }
  const text = isBase64 ? atob(raw) : raw;
  return parseToDataset(text, filename);
}

// Runnable import code inserted into a Notebook cell
function _buildCode(entry) {
  const { varName, fileType, filename } = entry;
  const readers = {
    csv:  `pd.read_csv("${filename}")`,
    json: `pd.read_json("${filename}")`,
    xlsx: `pd.read_excel("${filename}")`,
    xls:  `pd.read_excel("${filename}")`,
    xml:  `pd.read_xml("${filename}")`,
  };
  const reader = readers[fileType] ?? `pd.read_csv("${filename}")`;
  return (
    `# "${filename}" → ${varName}\n` +
    `import pandas as pd\n` +
    `${varName} = ${reader}\n` +
    `print(${varName}.shape)\n` +
    `${varName}.head()`
  );
}

// Friendly hint comment (kept for drag-to-editor use)
function _buildHint(entry) {
  const { varName, filename, fileType } = entry;
  const readers = {
    csv:  `pd.read_csv("${filename}")`,
    json: `pd.read_json("${filename}")`,
    xlsx: `pd.read_excel("${filename}")`,
    xls:  `pd.read_excel("${filename}")`,
    xml:  `pd.read_xml("${filename}")`,
  };
  const reader = readers[fileType] ?? `pd.read_csv("${filename}")`;
  return (
    `# "${filename}" 已就绪，直接读取：\n` +
    `import pandas as pd\n` +
    `${varName} = ${reader}\n` +
    `${varName}.head()`
  );
}

// ── Restore inject-store → dataset_store on page load ────────────────────────
// dataset_store is in-memory only. On page load we re-parse each inject-store
// entry so ARIA gets real rows (not empty arrays) for its AI prompts.
// Each entry is parsed independently — one failure won't block others.
async function _syncStoreToDataset() {
  const store   = _loadStore();
  const entries = Object.values(store).filter(e => e?.filename && e?.data != null);
  for (const entry of entries) {
    try {
      const dataset = await _parseEntry(entry);
      if (dataset) setDataset(dataset);
    } catch (e) {
      // Fallback: at least register metadata so ARIA tab appears
      console.warn('[file-manager] parse failed on restore, using metadata:', entry.filename, e);
      try {
        setDataset({
          name:    entry.filename,
          columns: entry.columnNames ?? [],
          dtypes:  {},
          rows:    [],
        });
      } catch (_) {}
    }
  }
}

export function initFileManager() {
  const rightBar = document.getElementById('right-bar');
  if (!rightBar) return;

  _syncStoreToDataset();

  // ── Two strip buttons: Files + Settings ───────────────────────────────────
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'rb-btn rb-file-toggle-btn';
  toggleBtn.title = '文件管理';
  toggleBtn.innerHTML = `<i class="ti ti-folder-open" style="font-size:14px"></i>`;

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'rb-btn rb-settings-toggle-btn';
  settingsBtn.title = '设置';
  settingsBtn.innerHTML = `<i class="ti ti-settings" style="font-size:14px"></i>`;

  const rbTop = rightBar.querySelector('.rb-top');
  rbTop?.appendChild(toggleBtn);
  rbTop?.appendChild(settingsBtn);

  // ── Fullscreen shortcut button (rb-bottom) ────────────────────────────────
  const fsBtn = document.createElement('button');
  fsBtn.className = 'rb-btn rb-fs-btn';
  fsBtn.title = '全屏 (Esc)';
  fsBtn.innerHTML = `<i class="ti ti-arrows-maximize" style="font-size:14px"></i>`;
  fsBtn.addEventListener('click', () => {
    window._dpToggleFullscreen?.();
    // Sync icon
    requestAnimationFrame(() => {
      const isFs = window._dpIsFullscreen?.() ?? false;
      fsBtn.innerHTML = isFs
        ? `<i class="ti ti-arrows-minimize" style="font-size:14px"></i>`
        : `<i class="ti ti-arrows-maximize" style="font-size:14px"></i>`;
      fsBtn.title = isFs ? '退出全屏 (Esc)' : '全屏 (Esc)';
    });
  });
  // Sync icon when fullscreen changes externally (e.g. Esc key)
  document.addEventListener('keydown', () => requestAnimationFrame(() => {
    const isFs = window._dpIsFullscreen?.() ?? false;
    fsBtn.innerHTML = isFs
      ? `<i class="ti ti-arrows-minimize" style="font-size:14px"></i>`
      : `<i class="ti ti-arrows-maximize" style="font-size:14px"></i>`;
    fsBtn.title = isFs ? '退出全屏 (Esc)' : '全屏 (Esc)';
  }));
  rightBar.querySelector('.rb-bottom')?.appendChild(fsBtn);

  // ── User account button — page header right side (GitHub-style) ─────────
  const userBtn = document.createElement('button');
  userBtn.className = 'au-hdr-btn usr-hdr-btn';
  userBtn.id        = 'au-vt-btn';
  userBtn.title     = '账号';
  userBtn.innerHTML = `<i class="ti ti-user-circle" style="font-size:18px"></i>`;
  userBtn.addEventListener('click', () => {
    const user = window._dpGetAuthUser?.();
    if (user) {
      // Logged in → open profile hero screen
      const state = window.screenController?.getState('profile');
      if (!state || state === 'closed') window.screenController?.open('profile');
      else window.screenController?.close('profile');
    } else {
      // Not logged in → open login modal
      window._dpAuthOpenLogin?.('login');
    }
  });
  // Place in vertical toolbar bottom — symmetric with fullscreen in rb-bottom
  const vtBottom = document.querySelector('#vertical-toolbar .vt-bottom');
  if (vtBottom) {
    vtBottom.appendChild(userBtn);
  } else {
    requestAnimationFrame(() => {
      const vt = document.querySelector('#vertical-toolbar .vt-bottom');
      if (vt) vt.appendChild(userBtn);
    });
  }

  function _syncUserBtn() {
    const user  = window._dpGetAuthUser?.();
    const state = window.screenController?.getState('profile');
    if (user) {
      if (user.avatar) {
        userBtn.innerHTML = `<img src="${user.avatar}" style="width:26px;height:26px;border-radius:50%;object-fit:cover">`;
      } else {
        const initials = (user.username ?? '?').slice(0, 2).toUpperCase();
        userBtn.innerHTML = `<span class="au-vt-avatar">${initials}</span>`;
      }
      userBtn.title = user.username ?? '账号';
      userBtn.classList.add('au-logged-in');
    } else {
      userBtn.innerHTML = `<i class="ti ti-user-circle" style="font-size:18px"></i>`;
      userBtn.title = '登录 / 注册';
      userBtn.classList.remove('au-logged-in');
    }
    userBtn.classList.toggle('active', state === 'normal' || state === 'maximized');
  }
  for (const evt of ['screen-opened', 'screen-closed']) {
    document.addEventListener(evt, e => { if (e.detail?.id === 'profile') _syncUserBtn(); });
  }
  document.addEventListener('dp-auth-state', () => {
    _syncUserBtn();
    if (_open && _activePane === 'profile') _renderProfilePane();
    if (_open && _activePane === 'files') _refresh().catch(console.error);
  });

  // ── Outer container — clips the two-panel slide ───────────────────────────
  const panelOuter = document.createElement('div');
  panelOuter.className = 'rb-panel-outer';
  panelOuter.hidden = true;
  rightBar.appendChild(panelOuter);

  // ── Inner sliding track — files | settings | profile ─────────────────────
  const panelTrack = document.createElement('div');
  panelTrack.className = 'rb-panel-track';
  panelOuter.appendChild(panelTrack);

  // ── Files panel (pane 0) ──────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'rb-file-panel rb-slide-pane';
  panelTrack.appendChild(panel);

  // ── Settings panel (pane 1) ───────────────────────────────────────────────
  const { panel: settingsPanel, settings: initialSettings, hdrClose: settingsClose } = createSettingsPanel(
    (key, val) => _onSettingChange(key, val)
  );
  settingsPanel.classList.add('rb-slide-pane');
  settingsClose?.addEventListener('click', _close);
  panelTrack.appendChild(settingsPanel);

  // ── Profile panel (pane 2) ────────────────────────────────────────────────
  const profilePane = document.createElement('div');
  profilePane.className = 'rb-slide-pane rb-profile-pane';

  const profileHdr = document.createElement('div');
  profileHdr.className = 'rb-file-hdr';
  const profileBack = document.createElement('button');
  profileBack.className = 'rb-file-hdr-close';
  profileBack.innerHTML = `<i class="ti ti-chevron-left"></i>`;
  profileBack.addEventListener('click', _close);
  const profileTitle = document.createElement('span');
  profileTitle.className = 'rb-file-hdr-title';
  profileTitle.textContent = '账号信息';
  profileHdr.append(profileBack, profileTitle);

  const profileBody = document.createElement('div');
  profileBody.className = 'rb-profile-body';

  profilePane.append(profileHdr, profileBody);
  panelTrack.appendChild(profilePane);

  function _renderProfilePane() {
    const user = window._dpGetAuthUser?.();
    if (!user) {
      profileBody.innerHTML = `
        <div class="rb-profile-guest">
          <p class="rb-profile-guest-hint">请先登录</p>
          <button class="au-submit rb-profile-login-btn" id="rb-profile-login-btn">登录</button>
        </div>`;
      profileBody.querySelector('#rb-profile-login-btn')?.addEventListener('click', () => {
        _close();
        window._dpAuthOpenLogin?.('login');
      });
      return;
    }
    const initials = (user.username ?? '?').slice(0, 2).toUpperCase();
    const joined   = user.created_at
      ? new Date(user.created_at * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
      : '—';
    profileBody.innerHTML = `
      <div class="rb-profile-avatar-wrap">
        <div class="rb-profile-avatar">${initials}</div>
        <div class="rb-profile-name">${_esc(user.username ?? '')}</div>
        <div class="rb-profile-email">${_esc(user.email ?? '')}</div>
        <div class="rb-profile-joined">注册于 ${joined}</div>
      </div>
      <div class="rb-profile-section">
        <div class="rb-profile-section-title">修改昵称</div>
        <div class="au-field">
          <input class="au-input rb-profile-username-input" id="rb-uname-input"
            type="text" value="${_esc(user.username ?? '')}" maxlength="20" autocomplete="off">
        </div>
        <div class="au-err" id="rb-uname-err"></div>
        <button class="au-submit rb-profile-save-btn" id="rb-uname-save">保存</button>
      </div>
      <div class="rb-profile-section rb-profile-danger">
        <button class="rb-profile-logout-btn" id="rb-profile-logout">
          <i class="ti ti-logout"></i> 退出登录
        </button>
      </div>`;

    const input   = profileBody.querySelector('#rb-uname-input');
    const saveBtn = profileBody.querySelector('#rb-uname-save');
    const errEl   = profileBody.querySelector('#rb-uname-err');

    saveBtn.addEventListener('click', async () => {
      const newName = input.value.trim();
      errEl.classList.remove('show');
      if (!newName) { errEl.textContent = '昵称不能为空'; errEl.classList.add('show'); return; }
      if (newName.length > 20) { errEl.textContent = '昵称不超过 20 字'; errEl.classList.add('show'); return; }
      saveBtn.disabled = true; saveBtn.textContent = '保存中…';
      try {
        await updateMe({ username: newName });
        const updatedUser = { ...window._dpGetAuthUser(), username: newName };
        document.dispatchEvent(new CustomEvent('dp-auth-state', { detail: { user: updatedUser } }));
        window._dpGetAuthUser = () => updatedUser;
        // 成功：绿色"✓ 已保存"，1.5秒后恢复
        saveBtn.textContent = '✓ 已保存';
        saveBtn.style.background = '#16a34a';
        saveBtn.style.boxShadow  = '0 4px 12px rgba(22,163,74,0.35)';
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = '保存';
          saveBtn.style.background = '';
          saveBtn.style.boxShadow  = '';
        }, 1500);
        _syncUserBtn();
      } catch (e) {
        // 失败：显示错误信息，3秒后自动清除
        errEl.textContent = e.message || '保存失败';
        errEl.classList.add('show');
        saveBtn.disabled = false; saveBtn.textContent = '保存';
        setTimeout(() => errEl.classList.remove('show'), 3000);
      }
    });

    profileBody.querySelector('#rb-profile-logout')?.addEventListener('click', async () => {
      await window._dpAuthLogout?.();
      _close();
      _renderProfilePane();
    });
  }

  function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  async function updateMe(data) {
    return window.authClient?.updateMe(data) ?? Promise.reject(new Error('auth not ready'));
  }

  let _activePane = 'files'; // 'files' | 'settings' | 'profile'

  function _slideToPane(pane) {
    _activePane = pane;
    const offsets = { files: '0', settings: '-33.333%', profile: '-66.666%' };
    panelTrack.style.transform = `translateX(${offsets[pane] ?? '0'})`;
    toggleBtn.classList.toggle('rb-btn--active',   pane === 'files');
    settingsBtn.classList.toggle('rb-btn--active', pane === 'settings');
    if (pane === 'profile') _renderProfilePane();
    if (getSettings().cacheRightBarState && pane !== 'profile') {
      localStorage.setItem('dp-rb-pane', pane);
    }
  }

  function _onSettingChange(key, val) {
    if (key === 'cacheNotebookOutput' && !val) {
      // clear output cache when disabled
      try { localStorage.removeItem('dreaming-polar-nb-outputs'); } catch (_) {}
    }
  }

  // ── Auto-switch: watch editor for pd.read_csv ─────────────────────────────
  document.addEventListener('notebook-cell-focused', () => {
    if (!getSettings().autoSwitchFiles) return;
    if (!_open) return;
    // Give time for editor to update, then check active line
    setTimeout(() => {
      const activeEditor = document.querySelector('.nb-cell:focus-within .nb-editor');
      if (!activeEditor) return;
      const val = activeEditor.value ?? '';
      const lines = val.split('\n');
      const sel   = activeEditor.selectionStart ?? 0;
      const lineIdx = val.slice(0, sel).split('\n').length - 1;
      const line  = lines[lineIdx] ?? '';
      if (/pd\.read_(?:csv|json|excel|xml)\s*\(/.test(line) && _activePane !== 'files') {
        _slideToPane('files');
      }
    }, 80);
  });

  let _open = false;

  function _open_(defaultPane = 'files') {
    _open = true;
    panelOuter.hidden = false;
    rightBar.classList.add('rb--expanded');
    toggleBtn.classList.add('rb-btn--active');
    settingsBtn.classList.remove('rb-btn--active');
    if (getSettings().cacheRightBarState) {
      localStorage.setItem('dp-rb-open', '1');
    }
    // Always respect the explicitly requested pane — never let localStorage override
    _slideToPane(defaultPane);
    if (defaultPane === 'files') _refresh().catch(console.error);
  }
  function _close() {
    _open = false;
    panelOuter.hidden = true;
    rightBar.classList.remove('rb--expanded');
    toggleBtn.classList.remove('rb-btn--active');
    settingsBtn.classList.remove('rb-btn--active');
    userBtn?.classList.remove('active');
    if (getSettings().cacheRightBarState) {
      localStorage.removeItem('dp-rb-open');
    }
    _exitSelectMode();
  }

  // ── Auto-restore on page load if state memory is ON ──────────────────────
  if (getSettings().cacheRightBarState && localStorage.getItem('dp-rb-open') === '1') {
    const savedPane = localStorage.getItem('dp-rb-pane') === 'settings' ? 'settings' : 'files';
    requestAnimationFrame(() => _open_(savedPane));
  }

  toggleBtn.addEventListener('click', () => {
    if (!_open) { _open_('files'); }
    else if (_activePane === 'files') { _close(); }
    else { _slideToPane('files'); }
  });

  settingsBtn.addEventListener('click', () => {
    if (!_open) { _open_('settings'); }
    else if (_activePane === 'settings') { _close(); }
    else { _slideToPane('settings'); }
  });

  // ── Files panel header ────────────────────────────────────────────────────

  // Header row: title + import button + close
  const hdr = document.createElement('div');
  hdr.className = 'rb-file-hdr';

  const hdrTitle = document.createElement('span');
  hdrTitle.className = 'rb-file-hdr-title';
  hdrTitle.textContent = 'Files';

  // ── "+ Import" button — the new primary entry point ────────────────────────
  const importBtn = document.createElement('button');
  importBtn.className = 'rb-file-import-btn';
  importBtn.title = '导入文件';
  importBtn.innerHTML = `<i class="ti ti-plus"></i> 导入`;

  const hdrClose = document.createElement('button');
  hdrClose.className = 'rb-file-hdr-close';
  hdrClose.innerHTML = `<i class="ti ti-x"></i>`;
  hdrClose.addEventListener('click', _close);

  // "管理" toggle — enters select mode
  const manageBtn = document.createElement('button');
  manageBtn.className = 'rb-file-manage-btn';
  manageBtn.title = '管理文件';
  manageBtn.textContent = '管理';

  hdr.append(hdrTitle, importBtn, manageBtn, hdrClose);

  const body = document.createElement('div');
  body.className = 'rb-file-body';

  // Delete bar (shown in select mode when ≥1 item checked)
  const deleteBar = document.createElement('div');
  deleteBar.className = 'rb-file-delete-bar';
  deleteBar.hidden = true;
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'rb-file-delete-btn';
  deleteBtn.innerHTML = `<i class="ti ti-trash"></i> <span class="rb-del-label">删除所选</span>`;
  const cancelSelBtn = document.createElement('button');
  cancelSelBtn.className = 'rb-file-cancel-sel-btn';
  cancelSelBtn.textContent = '取消';
  deleteBar.append(deleteBtn, cancelSelBtn);

  panel.append(hdr, body, deleteBar);

  let _selectMode = false;
  const _selected = new Set(); // keys in inject-store

  // ── Select mode ───────────────────────────────────────────────────────────
  function _enterSelectMode() {
    _selectMode = true;
    _selected.clear();
    manageBtn.textContent = '完成';
    manageBtn.classList.add('rb-file-manage-btn--active');
    panel.classList.add('rb-panel--select');
    _updateDeleteBar();
    _refresh().catch(console.error);
  }
  function _exitSelectMode() {
    _selectMode = false;
    _selected.clear();
    manageBtn.textContent = '管理';
    manageBtn.classList.remove('rb-file-manage-btn--active');
    panel.classList.remove('rb-panel--select');
    deleteBar.hidden = true;
    _refresh().catch(console.error);
  }
  function _updateDeleteBar() {
    const n = _selected.size;
    deleteBar.hidden = !(_selectMode && n > 0);
    deleteBar.querySelector('.rb-del-label').textContent =
      n > 0 ? `删除所选 (${n})` : '删除所选';
  }

  manageBtn.addEventListener('click', () =>
    _selectMode ? _exitSelectMode() : _enterSelectMode()
  );

  cancelSelBtn.addEventListener('click', _exitSelectMode);

  deleteBtn.addEventListener('click', () => {
    if (!_selected.size) return;
    const store = _loadStore();
    // Remove from dataset_store (ARIA tabs) before wiping inject-store entries
    _selected.forEach(key => {
      const filename = store[key]?.filename;
      if (filename) removeDataset(filename);  // triggers dataset-updated → ARIA refreshes
      delete store[key];
    });
    _saveStore(store);
    _selected.clear();
    _exitSelectMode();
    document.dispatchEvent(new CustomEvent('nb-file-imported'));
  });

  // ── Core import logic ─────────────────────────────────────────────────────
  // 1. Parse file in JS
  // 2. Save to inject-store (Notebook cells can flush on Run)
  // 3. Write to Pyodide FS (any cell can use filename directly)
  // 4. Write to dataset_store (ARIA tabs appear immediately)
  async function _doImport(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const fileType = ['xlsx','xls','json','xml'].includes(ext) ? ext : 'csv';
    const isExcel  = fileType === 'xlsx' || fileType === 'xls';

    importBtn.disabled = true;
    importBtn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>`;

    try {
      // Read raw data
      let rawData, isBase64 = false;
      if (isExcel) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        // Store as base64 for JSON-serializable inject-store
        let bin = '';
        bytes.forEach(b => { bin += String.fromCharCode(b); });
        rawData = btoa(bin);
        isBase64 = true;
      } else {
        rawData = await file.text();
      }

      // Parse for metadata (columns, dtypes, rows)
      const tempEntry = { fileType, filename: file.name, data: rawData, isBase64 };
      const dataset = await _parseEntry(tempEntry);
      if (!dataset) throw new Error('文件解析失败');

      const varName = _resolveVarName(file.name);
      const rows    = dataset.rows.length;
      const columns = dataset.columns.length;

      // Save to inject-store
      const store = _loadStore();
      const cellId = `fm_${Date.now()}`; // file-manager owned entry (no cell binding)
      store[cellId] = {
        varName, fileType,
        filename:    file.name,
        rows,
        columns,
        columnNames: dataset.columns,
        data:        rawData,
        isBase64,
      };
      _saveStore(store);

      // Write to Pyodide FS (independent, best-effort)
      try {
        writeToFS(file.name, isExcel ? rawData : rawData, fileType);
      } catch (e) {
        console.warn('[file-manager] writeToFS failed:', e);
      }

      // Write to dataset_store → ARIA tabs (independent, best-effort)
      try {
        setDataset(dataset);
      } catch (e) {
        console.warn('[file-manager] setDataset failed:', e);
      }

        // Notify listeners
        document.dispatchEvent(new CustomEvent('nb-file-imported', {
          detail: { varName, rows, columns, filename: file.name, fileType, cellId },
        }));
        logActivity('import', `导入 ${file.name}`);
        _recordRecentFile({ name: file.name, varName, size: file.size, fileType });

      _refresh().catch(console.error);
    } catch (err) {
      console.warn('[file-manager] import failed:', err);
      // Show inline error briefly
      const errEl = document.createElement('div');
      errEl.className = 'rb-file-empty';
      errEl.style.color = '#dc2626';
      errEl.textContent = `✗ ${err.message ?? '导入失败'}`;
      body.prepend(errEl);
      setTimeout(() => errEl.remove(), 3000);
    } finally {
      importBtn.disabled = false;
      importBtn.innerHTML = `<i class="ti ti-plus"></i> 导入`;
    }
  }

  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.csv,.xlsx,.xls,.json,.xml';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.remove();
      if (file) await _doImport(file);
    });
    input.click();
  });

  // Allocate a Python variable name that doesn't clash with existing ones
  const _usedVarNames = new Set();
  function _resolveVarName(filename) {
    const base = filename
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'df';
    // Seed from existing store
    if (!_usedVarNames.size) {
      Object.values(_loadStore()).forEach(e => { if (e.varName) _usedVarNames.add(e.varName); });
    }
    if (!_usedVarNames.has('df')) { _usedVarNames.add('df'); return 'df'; }
    let name = `df_${base}`, i = 2;
    while (_usedVarNames.has(name)) name = `df_${base}_${i++}`;
    _usedVarNames.add(name);
    return name;
  }

  // ── Time formatting ───────────────────────────────────────────────────────
  function _timeAgo(ms) {
    const diff = Date.now() - ms;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + '分钟前';
    const h = Math.floor(min / 60);
    if (h < 24) return h + '小时前';
    return Math.floor(h / 24) + '天前';
  }

  // ── Fetch cloud files ──────────────────────────────────────────────────────
  async function _fetchCloudFiles() {
    if (!window.authClient?.isLoggedIn()) return [];
    try {
      const token = window.authClient.getAccessToken();
      const res = await fetch(
        'https://api.dreamingpolar.com/auth/files',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  // ── Cloud file item renderer ───────────────────────────────────────────────
  function _makeCloudFileItem(file) {
    const row = document.createElement('div');
    row.className = 'rb-file-item';

    const icon = file.filename.endsWith('.py') ? 'ti-file-code'
      : file.filename.match(/\.(csv|xlsx|xls)$/) ? 'ti-table'
      : 'ti-file';

    const size = file.size_bytes < 1024
      ? file.size_bytes + ' B'
      : file.size_bytes < 1024 * 1024
      ? (file.size_bytes / 1024).toFixed(1) + ' KB'
      : (file.size_bytes / 1024 / 1024).toFixed(1) + ' MB';

    const ago = _timeAgo(file.created_at * 1000);

    row.innerHTML = `
      <i class="ti ${icon} rb-file-item-icon"></i>
      <div class="rb-file-item-info">
        <div class="rb-file-item-name">${file.filename}</div>
        <div class="rb-file-item-meta">${size} · ${ago}</div>
      </div>
      <div class="rb-cloud-actions">
        <button class="rb-file-action-btn rb-inject-cloud" title="注入到内核">
          <i class="ti ti-player-play"></i>
        </button>
        <button class="rb-file-action-btn rb-delete-cloud" title="删除">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    `;

    // 注入到内核
    row.querySelector('.rb-inject-cloud').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const token = window.authClient.getAccessToken();
        const res = await fetch(
          `https://api.dreamingpolar.com/auth/files/${file.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error('下载失败');
        const buffer = await res.arrayBuffer();
        const varName = file.filename.replace(/\.[^/.]+$/, '')
          .replace(/[^a-zA-Z0-9_]/g, '_');
        if (window.injectDataFrame) {
          window.injectDataFrame(varName, new Uint8Array(buffer), file.file_type ?? 'csv', file.filename);
        }
      } catch (e) {
        console.error('[cloud inject]', e);
      }
    });

    // 删除
    row.querySelector('.rb-delete-cloud').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`确认删除 ${file.filename}？`)) return;
      try {
        const token = window.authClient.getAccessToken();
        const res = await fetch(
          `https://api.dreamingpolar.com/auth/files/${file.id}`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.ok) {
          row.remove();
        }
      } catch (e) {
        console.error('[cloud delete]', e);
      }
    });

    return row;
  }

  // ── Render file list ───────────────────────────────────────────────────────
  async function _refresh() {
    body.innerHTML = '';
    const store = _loadStore();

    // Deduplicate by filename — keep the entry with most info (prefer fm_* over cell-id)
    const byFilename = new Map(); // filename → {key, entry}
    Object.entries(store).forEach(([key, entry]) => {
      if (!entry?.filename) return;
      const existing = byFilename.get(entry.filename);
      // Prefer fm_* entries (file-manager owned) over cell-id entries
      if (!existing || key.startsWith('fm_')) {
        byFilename.set(entry.filename, { key, entry });
      }
    });

    const dedupedEntries = [...byFilename.values()];

    // 云端文件（登录后显示）
    if (window.authClient?.isLoggedIn()) {
      const cloudFiles = await _fetchCloudFiles();
      if (cloudFiles.length > 0) {
        const cloudSec = _makeSection('云端文件', 'ti-cloud', false);
        
        const dataFiles = cloudFiles.filter(f => f.file_type === 'data');
        const codeFiles2 = cloudFiles.filter(f => f.file_type === 'code');
        
        if (dataFiles.length > 0) {
          dataFiles.forEach(f => cloudSec.body.appendChild(_makeCloudFileItem(f)));
        }
        
        if (codeFiles2.length > 0) {
          codeFiles2.forEach(f => cloudSec.body.appendChild(_makeCloudFileItem(f)));
        }
        
        body.appendChild(cloudSec.el);
      }
    }

    // Section: 数据文件
    const sec = _makeSection('数据文件', 'ti-database', dedupedEntries.length === 0);
    if (dedupedEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rb-file-placeholder';
      empty.textContent = '还没有导入文件 — 点击上方"导入"按钮添加';
      sec.body.appendChild(empty);
    } else {
      dedupedEntries.forEach(({ key, entry }) => sec.body.appendChild(_makeFileItem(key, entry)));
    }
    body.appendChild(sec.el);

    // Section: 代码文件 (from cell save-as-file)
    const codeFiles = Object.values(_loadCodeStore());
    const codeSec = _makeSection('代码文件', 'ti-file-code', codeFiles.length === 0);
    if (codeFiles.length === 0) {
      const ph = document.createElement('div');
      ph.className = 'rb-file-placeholder';
      ph.textContent = '在 Cell 里按 Ctrl+S 保存为代码文件';
      codeSec.body.appendChild(ph);
    } else {
      codeFiles.sort((a, b) => b.savedAt - a.savedAt)
               .forEach(entry => codeSec.body.appendChild(_makeCodeFileItem(entry)));
    }
    body.appendChild(codeSec.el);

    // Section: 模型 & 配置 (placeholder)
    const modelSec = _makeSection('模型 & 配置', 'ti-brain', true);
    const placeholder = document.createElement('div');
    placeholder.className = 'rb-file-placeholder';
    placeholder.textContent = '开发中 — 保存训练好的模型';
    modelSec.body.appendChild(placeholder);
    body.appendChild(modelSec.el);
  }

  function _makeCodeFileItem(entry) {
    const { filename, language, code, savedAt } = entry;
    const item = document.createElement('div');
    item.className = 'rb-file-item rb-code-file-item';

    const iconEl = document.createElement('i');
    iconEl.className = `ti ${LANG_ICON[language] ?? 'ti-file-code'} rb-file-item-icon`;
    iconEl.style.color = LANG_COLOR[language] ?? '#6366f1';

    const info = document.createElement('div');
    info.className = 'rb-file-item-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'rb-file-item-name';
    nameEl.textContent = filename;

    const metaEl = document.createElement('div');
    metaEl.className = 'rb-file-item-meta';
    const ext = LANG_EXT[language] ?? '';
    const timeStr = savedAt ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    metaEl.textContent = `${language}${ext ? ' · ' + ext : ''}${timeStr ? ' · ' + timeStr : ''}`;

    info.append(nameEl, metaEl);

    // Insert into cell button
    const insertBtn = document.createElement('button');
    insertBtn.className = 'rb-file-action-btn';
    insertBtn.title = '插入到 Notebook';
    insertBtn.innerHTML = `<i class="ti ti-corner-down-left"></i>`;

    function _doInsert() {
      document.dispatchEvent(new CustomEvent('nb-code-file-click', {
        detail: { filename, language, code },
      }));
      item.classList.add('rb-file-item--flash');
      setTimeout(() => item.classList.remove('rb-file-item--flash'), 600);
    }

    insertBtn.addEventListener('click', e => { e.stopPropagation(); _doInsert(); });
    item.addEventListener('click', _doInsert);

    // Delete via right-click context menu (simple confirm)
    item.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!confirm(`删除代码文件 "${filename}"？`)) return;
      const store = _loadCodeStore();
      delete store[filename];
      _saveCodeStore(store);
      _refresh().catch(console.error);
    });

    item.append(iconEl, info, insertBtn);
    return item;
  }

  function _makeSection(title, icon, collapsed = false) {
    const el   = document.createElement('div');
    el.className = 'rb-file-section';

    const hdr  = document.createElement('div');
    hdr.className = 'rb-file-section-hdr';
    hdr.innerHTML =
      `<i class="ti ${icon} rb-file-section-icon"></i><span>${title}</span>` +
      `<i class="ti ti-chevron-down rb-file-section-chevron${collapsed ? '' : ' open'}"></i>`;

    const sBody = document.createElement('div');
    sBody.className = 'rb-file-section-body';
    if (collapsed) sBody.hidden = true;

    hdr.addEventListener('click', () => {
      const isOpen = !sBody.hidden;
      sBody.hidden = isOpen;
      hdr.querySelector('.rb-file-section-chevron').classList.toggle('open', !isOpen);
    });

    el.append(hdr, sBody);
    return { el, body: sBody };
  }

  function _makeFileItem(storeKey, entry) {
    const { varName, fileType, filename, rows, columns } = entry;
    const item = document.createElement('div');
    item.className = 'rb-file-item';
    item.draggable = !_selectMode;

    // ── Select circle (visible in select mode) ────────────────────────────
    const circle = document.createElement('span');
    circle.className = 'rb-file-select-circle';
    circle.innerHTML = `<i class="ti ti-check rb-file-check-icon"></i>`;

    const iconEl = document.createElement('i');
    iconEl.className = `ti ${TYPE_ICON[fileType] ?? 'ti-file'} rb-file-item-icon`;

    const info = document.createElement('div');
    info.className = 'rb-file-item-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'rb-file-item-name';
    nameEl.textContent = filename ?? varName;

    const metaEl = document.createElement('div');
    metaEl.className = 'rb-file-item-meta';
    metaEl.textContent = rows
      ? `${Number(rows).toLocaleString()}行 · ${columns}列 · ${varName}`
      : varName;

    info.append(nameEl, metaEl);

    // "→ Notebook / → ARIA / …" icon button (hidden in select mode)
    const toNbBtn = document.createElement('button');
    toNbBtn.className = 'rb-file-action-btn';
    _applyActionBtn(toNbBtn);
    _actionBtns.add(toNbBtn);

    // Shared smart-click dispatcher — routes to active screen
    function _smartClick() {
      if (_activeScreenId === 'terminal') {
        // Dataset is in dataset_store; re-activate it → ARIA switches to chat view
        const ds = getAllDatasets().find(d => d.name === entry.filename);
        if (ds) {
          setDataset(ds); // re-sets active + dispatches dataset-updated source='import'
        } else {
          // Dataset not in store yet; fall back to Notebook
          document.dispatchEvent(new CustomEvent('rb-file-smart-click', {
            detail: { code: _buildCode(entry), entry },
          }));
        }
        item.classList.add('rb-file-item--flash');
        setTimeout(() => item.classList.remove('rb-file-item--flash'), 600);
        return;
      }
      // Default: insert into Notebook
      document.dispatchEvent(new CustomEvent('rb-file-smart-click', {
        detail: { code: _buildCode(entry), entry },
      }));
      item.classList.add('rb-file-item--flash');
      setTimeout(() => item.classList.remove('rb-file-item--flash'), 600);
    }

    toNbBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (_selectMode) return;
      _smartClick();
    });

    item.append(circle, iconEl, info, toNbBtn);

    item.addEventListener('click', () => {
      if (_selectMode) {
        if (_selected.has(storeKey)) {
          _selected.delete(storeKey);
          item.classList.remove('rb-file-item--selected');
        } else {
          _selected.add(storeKey);
          item.classList.add('rb-file-item--selected');
        }
        _updateDeleteBar();
        return;
      }
      _smartClick();
    });

    item.addEventListener('dragstart', e => {
      if (_selectMode) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', _buildCode(entry));
      e.dataTransfer.effectAllowed = 'copy';
    });

    return item;
  }

  // ── Kernel restart: "reload datasets" banner ──────────────────────────────
  let _kernelBanner = null;

  function _showKernelBanner() {
    if (_kernelBanner) return;
    const banner = document.createElement('div');
    banner.className = 'rb-kernel-banner';
    banner.innerHTML =
      `<span class="rb-kernel-banner-text">` +
      `<i class="ti ti-database-off"></i> 内核已重置，数据集待重新注入` +
      `</span>` +
      `<button class="rb-kernel-banner-btn"><i class="ti ti-refresh"></i> 重新载入</button>`;

    const btn = banner.querySelector('.rb-kernel-banner-btn');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .7s linear infinite"></i> 载入中…`;
      document.dispatchEvent(new CustomEvent('reload-injected-datasets'));
    });

    // Insert at top of body
    body.insertBefore(banner, body.firstChild);
    _kernelBanner = banner;
  }

  function _hideKernelBanner() {
    _kernelBanner?.remove();
    _kernelBanner = null;
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  document.addEventListener('nb-file-imported',    () => { if (_open) _refresh().catch(console.error); });
  document.addEventListener('nb-code-file-saved', () => { if (_open) _refresh().catch(console.error); });
  // "修改资料" button in profile screen → open right bar profile pane
  document.addEventListener('dp-open-profile-pane', () => { _open_('profile'); });
  document.addEventListener('kernel-restarted', () => {
    if (_open) _refresh().catch(console.error);
    // Show reload banner if there are any tracked files
    const store = _loadStore();
    const hasFiles = Object.values(store).some(e => e?.filename);
    if (hasFiles) _showKernelBanner();
  });
  document.addEventListener('dataset-updated',    () => { if (_open) _refresh().catch(console.error); });
  document.addEventListener('datasets-reloaded',  () => _hideKernelBanner());

  // ── Track active screen → update action button labels live ────────────────
  document.addEventListener('screen-opened',    ({ detail: { id } }) => {
    _activeScreenId = id;
    _refreshAllActionBtns();
  });
  document.addEventListener('screen-closed',    ({ detail: { id } }) => {
    if (_activeScreenId === id) { _activeScreenId = null; _refreshAllActionBtns(); }
  });
  document.addEventListener('screen-minimized', ({ detail: { id } }) => {
    if (_activeScreenId === id) { _activeScreenId = null; _refreshAllActionBtns(); }
  });
}
