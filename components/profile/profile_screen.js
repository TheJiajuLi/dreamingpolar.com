// ── Profile Screen ───────────────────────────────────────────────────────────
import { logActivity } from '../shared/activity_logger.js';
import { injectDataFrame } from '../compiler/compiler.js';

const AUTH_BASE = 'https://api.dreamingpolar.com/auth';

const RECENT_KEY          = 'dp_recent_items';
const RECENT_FILES_KEY    = 'dp_recent_files';
const ACTIVITY_LOG_KEY    = 'dp-activity-log';
const ACTIVITY_EVENTS_KEY = 'dp-activity-events';

// ── Helpers ───────────────────────────────────────────────────────────────────
// Use LOCAL date components to avoid UTC timezone mismatch near midnight
function _dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _relTime(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function _dayLabel(ts) {
  const d = new Date(ts);
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
  if (_dateKey(d) === _dateKey(today))     return '今天';
  if (_dateKey(d) === _dateKey(yesterday)) return '昨天';
  return `${d.getMonth()+1}月${d.getDate()}日`;
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function _buildHeatmap() {
  const log = (() => { try { return JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) ?? '{}'); } catch { return {}; } })();
  const wrap = document.createElement('div');
  wrap.className = 'prof-heatmap';
  const today = new Date(); today.setHours(0,0,0,0);

  for (let w = 11; w >= 0; w--) {
    const col = document.createElement('div');
    col.className = 'prof-heatmap-col';
    for (let d = 6; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(today.getDate() - w * 7 - d);
      const cell = document.createElement('div');
      cell.className = 'prof-heatmap-cell';
      if (date > today) { col.appendChild(cell); continue; }
      const key   = _dateKey(date);
      const count = log[key] ?? 0;
      cell.dataset.level = count === 0 ? 0 : count <= 2 ? 1 : count <= 5 ? 2 : 3;
      cell.title = count === 0
        ? `${date.getMonth()+1}月${date.getDate()}日 · 暂无活动`
        : `${date.getMonth()+1}月${date.getDate()}日 · ${count} 次运行`;
      col.appendChild(cell);
    }
    wrap.appendChild(col);
  }
  return wrap;
}

// ── Activity feed ─────────────────────────────────────────────────────────────
function _buildActivityFeed() {
  const events = (() => { try { return JSON.parse(localStorage.getItem(ACTIVITY_EVENTS_KEY) ?? '[]'); } catch { return []; } })();
  const frag = document.createDocumentFragment();

  if (!events.length) {
    const p = document.createElement('p');
    p.className = 'prof-empty';
    p.textContent = '还没有活动记录，开始你的第一次分析吧';
    frag.appendChild(p);
    return frag;
  }

  const groups = new Map();
  for (const ev of events.slice(0, 20)) {
    const lbl = _dayLabel(ev.time);
    if (!groups.has(lbl)) groups.set(lbl, []);
    groups.get(lbl).push(ev);
  }

  for (const [label, items] of groups) {
    const grp = document.createElement('div');
    grp.className = 'prof-activity-group';
    const dateEl = document.createElement('div');
    dateEl.className = 'prof-activity-date';
    dateEl.textContent = label;
    grp.appendChild(dateEl);
    for (const ev of items) {
      const row = document.createElement('div');
      row.className = 'prof-activity-row';
      row.innerHTML =
        `<span class="prof-activity-dot"></span>` +
        `<span class="prof-activity-desc">${_esc(ev.desc)}</span>` +
        `<span class="prof-activity-time">${_relTime(ev.time)}</span>`;
      grp.appendChild(row);
    }
    frag.appendChild(grp);
  }
  return frag;
}

// ── App icons — match vertical toolbar button SVGs ────────────────────────────
const _ICON_SVG = {
  notebook: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><line x1="10" y1="6.5" x2="14" y2="6.5"/><line x1="6.5" y1="10" x2="6.5" y2="14"/><line x1="17.5" y1="10" x2="17.5" y2="14"/><line x1="10" y1="17.5" x2="14" y2="17.5"/></svg>`,
  generative: `<svg width="22" height="22" viewBox="3 3 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="2.2"/><circle cx="5.5" cy="5.5" r="1.4"/><circle cx="18.5" cy="5.5" r="1.4"/><circle cx="5.5" cy="18.5" r="1.4"/><circle cx="18.5" cy="18.5" r="1.4"/><line x1="12" y1="9.8" x2="6.8" y2="6.8"/><line x1="12" y1="9.8" x2="17.2" y2="6.8"/><line x1="12" y1="14.2" x2="6.8" y2="17.2"/><line x1="12" y1="14.2" x2="17.2" y2="17.2"/></svg>`,
  grid: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/></svg>`,
  dataset: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6"/><path d="M5 10v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-4"/><path d="M5 14v3c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-3"/></svg>`,
  default:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
};

// ── Recent notebooks ──────────────────────────────────────────────────────────
function _buildRecentNotebooks() {
  const items = (() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; } })();
  const top3 = items.slice(0, 3);

  if (!top3.length) {
    const p = document.createElement('p');
    p.className = 'prof-empty';
    p.textContent = '还没有最近打开的 Notebook';
    return p;
  }

  const grid = document.createElement('div');
  grid.className = 'prof-notebooks-grid';

  for (const item of top3) {
    const card = document.createElement('button');
    card.className = 'prof-nb-card';
    card.innerHTML =
      `<span class="prof-nb-icon">${_ICON_SVG[item.type] ?? _ICON_SVG.default}</span>` +
      `<span class="prof-nb-name">${_esc(item.name)}</span>` +
      `<span class="prof-nb-time">${_relTime(item.lastOpenedAt)}</span>`;
    card.addEventListener('click', () => {
      window.screenController?.open(item.screenId ?? 'coding');
      document.dispatchEvent(new CustomEvent('dp-open-recent', { detail: item }));
    });
    grid.appendChild(card);
  }
  return grid;
}

// ── Recent files ──────────────────────────────────────────────────────────────
function _fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function _buildRecentFiles() {
  const files = (() => { try { return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '[]'); } catch { return []; } })();
  const top5 = files.slice(0, 5);

  if (!top5.length) {
    const p = document.createElement('p');
    p.className = 'prof-empty';
    p.textContent = '还没有导入过文件';
    return p;
  }

  const list = document.createElement('div');
  list.className = 'prof-files-list';

  for (const f of top5) {
    const row = document.createElement('div');
    row.className = 'prof-file-row';
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();
    const badge = ext === 'csv' ? 'CSV' : ext === 'xlsx' || ext === 'xls' ? 'Excel' : ext.toUpperCase();
    row.innerHTML =
      `<span class="prof-file-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6"/><path d="M5 10v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-4"/><path d="M5 14v3c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-3"/></svg></span>` +
      `<span class="prof-file-name">${_esc(f.name)}</span>` +
      `<span class="prof-file-meta">${f.varName ? `→ ${_esc(f.varName)}` : ''}</span>` +
      `<span class="prof-file-badge">${_esc(badge)}</span>` +
      `<span class="prof-file-size">${_fmtSize(f.size)}</span>` +
      `<span class="prof-file-time">${_relTime(f.openedAt)}</span>`;
    list.appendChild(row);
  }
  return list;
}

// ── Cloud File Manager ────────────────────────────────────────────────────────
const _CFM_TYPE_ICON = {
  csv: 'ti-file-type-csv', json: 'ti-file-type-json',
  xlsx: 'ti-file-spreadsheet', xls: 'ti-file-spreadsheet', xml: 'ti-file-code-2',
  py: 'ti-brand-python', md: 'ti-markdown', tex: 'ti-math', html: 'ti-code',
};
const _CFM_TYPE_COLOR = {
  csv: '#10b981', json: '#f59e0b', xlsx: '#22c55e', xls: '#22c55e', xml: '#8b5cf6',
  py: '#3b82f6', md: '#10b981', tex: '#8b5cf6', html: '#f59e0b',
};
const _CFM_DATA_EXTS = new Set(['csv','json','xlsx','xls','xml']);

function _cfmRelTime(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

function _cfmFmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function _buildCloudFileManager(pane) {
  pane.innerHTML = '';

  // ── Toolbar ───────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  toolbar.className = 'cfm-toolbar';

  const statsEl = document.createElement('div');
  statsEl.className = 'cfm-stats';
  statsEl.textContent = '加载中…';

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'cfm-upload-btn';
  uploadBtn.innerHTML = `<i class="ti ti-upload"></i> 上传文件`;

  toolbar.append(statsEl, uploadBtn);
  pane.appendChild(toolbar);

  // ── Status line (progress / errors) ──────────────────────────────────────
  const statusEl = document.createElement('div');
  statusEl.className = 'cfm-status';
  statusEl.hidden = true;
  pane.appendChild(statusEl);

  function _showStatus(msg, isErr = false) {
    statusEl.textContent = msg;
    statusEl.hidden = false;
    statusEl.classList.toggle('cfm-status--err', isErr);
    if (!isErr) setTimeout(() => { statusEl.hidden = true; }, 3000);
  }

  // ── List container ────────────────────────────────────────────────────────
  const listEl = document.createElement('div');
  listEl.className = 'cfm-list';
  pane.appendChild(listEl);

  // ── Fetch & render ────────────────────────────────────────────────────────
  async function _load() {
    listEl.innerHTML = '<div class="cfm-loading">加载中…</div>';
    statsEl.textContent = '加载中…';
    try {
      const res = await window.authClient.authedFetch(`${AUTH_BASE}/files`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const files = await res.json();
      _render(files);
    } catch (e) {
      listEl.innerHTML = `<div class="cfm-empty">加载失败：${_esc(e.message)}</div>`;
      statsEl.textContent = '';
    }
  }

  function _render(files) {
    listEl.innerHTML = '';
    if (!files.length) {
      listEl.innerHTML = '<div class="cfm-empty">还没有云端文件，点击上传开始</div>';
      statsEl.textContent = '0 个文件';
      return;
    }

    const dataFiles = files.filter(f => _CFM_DATA_EXTS.has((f.filename ?? f.name ?? '').split('.').pop().toLowerCase()));
    const codeFiles = files.filter(f => !_CFM_DATA_EXTS.has((f.filename ?? f.name ?? '').split('.').pop().toLowerCase()));
    const totalSize = files.reduce((s, f) => s + (f.size ?? 0), 0);
    statsEl.textContent = `${files.length} 个文件 · ${_cfmFmtSize(totalSize)}`;

    if (dataFiles.length) listEl.appendChild(_makeCfmSection('数据文件', 'ti-database', dataFiles, false));
    if (codeFiles.length) listEl.appendChild(_makeCfmSection('代码文件', 'ti-file-code', codeFiles, true));

    const modelWrap = _makeCfmSectionHeader('模型 & 配置', 'ti-brain');
    const modelPh = document.createElement('div');
    modelPh.className = 'cfm-placeholder';
    modelPh.textContent = '即将推出';
    modelWrap.appendChild(modelPh);
    listEl.appendChild(modelWrap);
  }

  function _makeCfmSectionHeader(title, icon) {
    const wrap = document.createElement('div');
    wrap.className = 'cfm-section';
    const hdr = document.createElement('div');
    hdr.className = 'cfm-section-hdr';
    hdr.innerHTML = `<i class="ti ${icon} cfm-section-icon"></i><span class="cfm-section-title">${_esc(title)}</span>`;
    wrap.appendChild(hdr);
    return wrap;
  }

  function _makeCfmSection(title, icon, files, isCode) {
    const wrap = _makeCfmSectionHeader(title, icon);
    files.forEach(f => wrap.appendChild(_makeCfmFileRow(f, isCode)));
    return wrap;
  }

  function _makeCfmFileRow(f, isCode) {
    const filename = f.filename ?? f.name ?? '';
    const ext = filename.split('.').pop().toLowerCase();
    const row = document.createElement('div');
    row.className = 'cfm-file-row';

    const iconEl = document.createElement('i');
    iconEl.className = `ti ${_CFM_TYPE_ICON[ext] ?? 'ti-file'} cfm-file-icon`;
    iconEl.style.color = _CFM_TYPE_COLOR[ext] ?? '#6366f1';

    const info = document.createElement('div');
    info.className = 'cfm-file-info';

    const nameEl = document.createElement('button');
    nameEl.className = 'cfm-file-name';
    nameEl.title = '点击下载';
    nameEl.textContent = filename;
    nameEl.addEventListener('click', () => _cfmDownload(f));

    const metaEl = document.createElement('div');
    metaEl.className = 'cfm-file-meta';
    metaEl.textContent = [
      _cfmFmtSize(f.size),
      f.created_at ? _cfmRelTime(f.created_at * 1000) : '',
    ].filter(Boolean).join(' · ');

    info.append(nameEl, metaEl);

    const actions = document.createElement('div');
    actions.className = 'cfm-file-actions';

    if (!isCode) {
      const injectBtn = document.createElement('button');
      injectBtn.className = 'cfm-action-btn';
      injectBtn.title = '注入到内核';
      injectBtn.innerHTML = `<i class="ti ti-player-play"></i>`;
      injectBtn.addEventListener('click', () => _cfmInject(f, injectBtn));
      actions.appendChild(injectBtn);
    } else {
      const openBtn = document.createElement('button');
      openBtn.className = 'cfm-action-btn';
      openBtn.title = '在 Notebook 打开';
      openBtn.innerHTML = `<i class="ti ti-external-link"></i>`;
      openBtn.addEventListener('click', () => _cfmOpenInNotebook(f));
      actions.appendChild(openBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'cfm-action-btn cfm-action-btn--danger';
    delBtn.title = '删除';
    delBtn.innerHTML = `<i class="ti ti-trash"></i>`;
    delBtn.addEventListener('click', () => _cfmConfirmDelete(f, row));
    actions.appendChild(delBtn);

    row.append(iconEl, info, actions);
    return row;
  }

  async function _cfmDownload(f) {
    const filename = f.filename ?? f.name ?? 'file';
    try {
      const res = await window.authClient.authedFetch(`${AUTH_BASE}/files/${f.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (e) {
      _showStatus(`下载失败：${e.message}`, true);
    }
  }

  async function _cfmInject(f, btn) {
    const filename = f.filename ?? f.name ?? 'file';
    const ext = filename.split('.').pop().toLowerCase();
    const varName = filename.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'df';
    btn.disabled = true;
    btn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i>`;
    try {
      const res = await window.authClient.authedFetch(`${AUTH_BASE}/files/${f.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const isExcel = ext === 'xlsx' || ext === 'xls';
      let data, fileType;
      if (isExcel) {
        const buf = await res.arrayBuffer();
        data = new Uint8Array(buf);
        fileType = ext;
      } else {
        data = await res.text();
        fileType = ext === 'json' ? 'json' : ext === 'xml' ? 'xml' : 'csv';
      }
      await injectDataFrame(varName, data, fileType, filename);
      _showStatus(`✓ "${filename}" 已注入为 ${varName}`);
    } catch (e) {
      _showStatus(`注入失败：${e.message}`, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="ti ti-player-play"></i>`;
    }
  }

  async function _cfmOpenInNotebook(f) {
    const filename = f.filename ?? f.name ?? 'file';
    try {
      const res = await window.authClient.authedFetch(`${AUTH_BASE}/files/${f.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const code = await res.text();
      document.dispatchEvent(new CustomEvent('cfm-open-code-file', { detail: { filename, code } }));
      _showStatus(`✓ "${filename}" 已发送到 Notebook`);
    } catch (e) {
      _showStatus(`打开失败：${e.message}`, true);
    }
  }

  function _cfmConfirmDelete(f, row) {
    const filename = f.filename ?? f.name ?? '文件';
    if (!window.confirm(`确认删除 ${filename}？此操作不可恢复`)) return;
    _cfmDeleteFile(f, row);
  }

  async function _cfmDeleteFile(f, row) {
    try {
      const res = await window.authClient.authedFetch(`${AUTH_BASE}/files/${f.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      row.classList.add('cfm-file-row--removing');
      setTimeout(() => { row.remove(); _cfmUpdateStats(); }, 250);
    } catch (e) {
      _showStatus(`删除失败：${e.message}`, true);
    }
  }

  function _cfmUpdateStats() {
    const rows = listEl.querySelectorAll('.cfm-file-row');
    if (!rows.length) {
      listEl.innerHTML = '<div class="cfm-empty">还没有云端文件，点击上传开始</div>';
      statsEl.textContent = '0 个文件';
    } else {
      statsEl.textContent = `${rows.length} 个文件`;
    }
  }

  // ── Upload ────────────────────────────────────────────────────────────────
  uploadBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls,.json,.xml,.py,.md,.tex,.html';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      uploadBtn.disabled = true;
      uploadBtn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin .8s linear infinite"></i> 上传中…`;
      _showStatus(`正在上传 "${file.name}"…`);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const token = window.authClient.getAccessToken();
        if (!token) throw new Error('未登录');
        const res = await fetch(`${AUTH_BASE}/files/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message ?? `HTTP ${res.status}`);
        }
        _showStatus(`✓ "${file.name}" 上传成功`);
        _load();
      } catch (e) {
        _showStatus(`上传失败：${e.message}`, true);
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = `<i class="ti ti-upload"></i> 上传文件`;
      }
    });
    input.click();
  });

  _load();
}

// ── Main render ───────────────────────────────────────────────────────────────
function _renderProfile(screen) {
  const user = window._dpGetAuthUser?.();
  if (!user) { screen.innerHTML = ''; return; }

  const initials = (user.username ?? '?').slice(0, 2).toUpperCase();
  const joined   = user.created_at
    ? new Date(user.created_at * 1000).toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' })
    : '—';

  screen.innerHTML = '';
  const layout = document.createElement('div');
  layout.className = 'prof-layout';

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const sidebar = document.createElement('aside');
  sidebar.className = 'prof-sidebar';

  // ── Avatar ────────────────────────────────────────────────────────────────
  const avatarEl = document.createElement('div');
  avatarEl.className = 'prof-avatar';
  avatarEl.title = '点击更换头像';

  const avatarOverlay = document.createElement('div');
  avatarOverlay.className = 'prof-avatar-overlay';
  avatarOverlay.textContent = '更换头像';

  function _setAvatarDisplay(src) {
    avatarEl.innerHTML = '';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      avatarEl.appendChild(img);
    } else {
      avatarEl.textContent = initials;
    }
    avatarEl.appendChild(avatarOverlay);
    _syncRbAvatar(src);
  }

  function _syncRbAvatar(src) {
    const userBtn = document.getElementById('au-vt-btn');
    if (!userBtn) return;
    if (src) {
      userBtn.innerHTML = `<img src="${src}" style="width:26px;height:26px;border-radius:50%;object-fit:cover">`;
    } else {
      userBtn.innerHTML = `<span class="au-vt-avatar">${initials}</span>`;
    }
  }

  _setAvatarDisplay(user.avatar ?? null);

  // Hidden file input for avatar upload
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      // Compress to 200×200 via canvas
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
          const img = new Image();
          img.onload = () => {
            const size = 200;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');
            const scale = Math.max(size / img.width, size / img.height);
            const w = img.width * scale, h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      _setAvatarDisplay(base64);
      const updatedUser = { ...window._dpGetAuthUser(), avatar: base64 };
      window._dpGetAuthUser = () => updatedUser;
      try { localStorage.setItem('dp-auth-user', JSON.stringify(updatedUser)); } catch (_) {}
      // Ensure token is valid before writing to backend
      if (!window.authClient?.isLoggedIn()) {
        await window.authClient?.silentRefresh().catch(() => {});
      }
      window.authClient?.updateMeAvatar(base64)
        .then(() => console.log('[avatar] saved to cloud'))
        .catch(e => console.warn('[avatar] save failed:', e.message));
    } catch (e) {
      console.warn('[avatar upload]', e);
    }
  });

  avatarEl.addEventListener('click', () => fileInput.click());

  const nameEl = document.createElement('div');
  nameEl.className = 'prof-name';
  nameEl.textContent = user.username ?? '';

  const emailEl = document.createElement('div');
  emailEl.className = 'prof-email';
  emailEl.textContent = user.email ?? '';

  const joinedEl = document.createElement('div');
  joinedEl.className = 'prof-joined';
  joinedEl.textContent = `注册于 ${joined}`;

  // ── Bio (signature) ───────────────────────────────────────────────────────
  const bioWrap = document.createElement('div');

  const bioDisplay = document.createElement('div');
  bioDisplay.className = 'prof-bio';
  const _bioText = () => {
    const u = window._dpGetAuthUser?.();
    return u?.bio ?? '';
  };
  const _renderBioDisplay = () => {
    const t = _bioText();
    if (t) {
      bioDisplay.textContent = t;
      bioDisplay.classList.remove('prof-bio-placeholder');
    } else {
      bioDisplay.textContent = '点击添加个性签名';
      bioDisplay.classList.add('prof-bio-placeholder');
    }
  };
  _renderBioDisplay();

  const bioForm = document.createElement('div');
  bioForm.className = 'prof-bio-form';
  bioForm.style.display = 'none';

  const bioInput = document.createElement('textarea');
  bioInput.className = 'prof-bio-input';
  bioInput.maxLength = 100;
  bioInput.rows = 2;
  bioInput.placeholder = '个性签名（最多 100 字）';

  const bioCounter = document.createElement('div');
  bioCounter.className = 'prof-bio-counter';
  bioCounter.textContent = '0 / 100';

  const bioOk = document.createElement('div');
  bioOk.className = 'prof-bio-ok';

  const bioActions = document.createElement('div');
  bioActions.className = 'prof-bio-actions';
  const bioConfirmBtn = document.createElement('button');
  bioConfirmBtn.type = 'button';
  bioConfirmBtn.className = 'prof-bio-btn prof-bio-btn-confirm';
  bioConfirmBtn.textContent = '确定';
  const bioCancelBtn = document.createElement('button');
  bioCancelBtn.type = 'button';
  bioCancelBtn.className = 'prof-bio-btn prof-bio-btn-cancel';
  bioCancelBtn.textContent = '取消';
  bioActions.append(bioCancelBtn, bioConfirmBtn);

  bioForm.append(bioInput, bioCounter, bioActions, bioOk);

  function _onOutsideClick(e) {
    if (!bioForm.contains(e.target)) _closeBio();
  }
  function _openBio() {
    bioDisplay.style.display = 'none';
    bioForm.style.display = '';
    bioInput.value = _bioText();
    bioCounter.textContent = `${bioInput.value.length} / 100`;
    bioOk.textContent = '';
    bioInput.focus();
    bioInput.select();
    document.addEventListener('mousedown', _onOutsideClick);
  }
  function _closeBio() {
    bioForm.style.display = 'none';
    bioDisplay.style.display = '';
    document.removeEventListener('mousedown', _onOutsideClick);
  }

  bioDisplay.addEventListener('click', _openBio);
  bioInput.addEventListener('input', () => {
    bioCounter.textContent = `${bioInput.value.length} / 100`;
  });
  bioInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _saveBio(); }
    if (e.key === 'Escape') _closeBio();
  });
  bioConfirmBtn.addEventListener('click', () => _saveBio());
  bioCancelBtn.addEventListener('click', () => _closeBio());

  async function _saveBio() {
    const newBio = bioInput.value.trim();
    _closeBio();
    const updatedUser = { ...window._dpGetAuthUser(), bio: newBio };
    window._dpGetAuthUser = () => updatedUser;
    try { localStorage.setItem('dp-auth-user', JSON.stringify(updatedUser)); } catch (_) {}
    _renderBioDisplay();
    bioOk.textContent = '';
    bioForm.style.display = 'none';
    // Brief feedback on the display element
    const prev = bioDisplay.style.color;
    bioDisplay.style.color = '#16a34a';
    bioDisplay.textContent = '✓ 已保存';
    setTimeout(() => { bioDisplay.style.color = prev; _renderBioDisplay(); }, 1200);
    // Ensure token is valid before writing to backend
    if (!window.authClient?.isLoggedIn()) {
      await window.authClient?.silentRefresh().catch(() => {});
    }
    window.authClient?.updateMeBio(newBio)
      .then(() => console.log('[bio] saved to cloud'))
      .catch(e => console.warn('[bio] save failed:', e.message));
  }

  bioWrap.append(bioDisplay, bioForm);

  // ── Name row with inline edit ─────────────────────────────────────────────
  const nameRow = document.createElement('div');
  nameRow.className = 'prof-name-row';

  const editPencil = document.createElement('button');
  editPencil.className = 'prof-name-edit-btn';
  editPencil.title = '编辑昵称';
  editPencil.innerHTML = `<i class="ti ti-pencil"></i>`;

  nameRow.append(nameEl, editPencil);

  // Hidden edit form — only shown when pencil is clicked
  const editForm = document.createElement('div');
  editForm.className = 'prof-edit-form';
  editForm.style.display = 'none';

  const editInput = document.createElement('input');
  editInput.className = 'prof-edit-input';
  editInput.type = 'text';
  editInput.value = user.username ?? '';
  editInput.maxLength = 20;
  editInput.autocomplete = 'off';

  const editErr = document.createElement('div');
  editErr.className = 'prof-edit-err';

  const editActions = document.createElement('div');
  editActions.className = 'prof-edit-form-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'prof-save-btn';
  saveBtn.textContent = '保存';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'prof-cancel-btn';
  cancelBtn.textContent = '取消';

  editActions.append(cancelBtn, saveBtn);
  editForm.append(editInput, editErr, editActions);

  // Toggle edit mode — name row hides entirely, replaced by inline input
  // Note: use style.display instead of .hidden because display:flex overrides [hidden]
  function _openEdit() {
    nameRow.style.display = 'none';
    editForm.style.display = 'flex';
    editInput.value = nameEl.textContent;
    editInput.focus();
    editInput.select();
  }
  function _closeEdit() {
    editForm.style.display = 'none';
    nameRow.style.display = '';
    editErr.textContent = '';
  }

  editPencil.addEventListener('click', _openEdit);
  cancelBtn.addEventListener('click', _closeEdit);
  editInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') _closeEdit();
  });

  saveBtn.addEventListener('click', async () => {
    const newName = editInput.value.trim();
    editErr.textContent = '';
    if (!newName) { editErr.textContent = '昵称不能为空'; return; }
    if (newName.length > 20) { editErr.textContent = '不超过 20 字'; return; }

    // ── Optimistic update: close the form immediately, then sync to server ──
    nameEl.textContent = newName;
    avatarEl.textContent = newName.slice(0, 2).toUpperCase();
    saveBtn.textContent = '✓';

    // Close form after brief ✓ confirmation
    setTimeout(() => {
      _closeEdit();
      saveBtn.textContent = '保存';
      saveBtn.disabled = false;
      editPencil.classList.add('prof-name-edit-btn--flash');
      setTimeout(() => editPencil.classList.remove('prof-name-edit-btn--flash'), 1500);
    }, 400);

    // Persist to server in background — failure just logs, doesn't revert UI
    try {
      if (!window.authClient?.isLoggedIn()) {
        await window.authClient?.silentRefresh().catch(() => {});
      }
      await window.authClient?.updateMe({ username: newName });
      const updatedUser = { ...window._dpGetAuthUser(), username: newName };
      window._dpGetAuthUser = () => updatedUser;
      // Dispatch AFTER form is closed so _renderProfile re-render doesn't interfere
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('dp-auth-state', { detail: { user: updatedUser } }));
      }, 500);
    } catch (e) {
      console.warn('[profile] updateMe failed:', e.message);
    }
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  const actionsEl = document.createElement('div');
  actionsEl.className = 'prof-sidebar-actions';

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'prof-logout-btn';
  logoutBtn.innerHTML = `<i class="ti ti-logout"></i> 退出登录`;
  logoutBtn.addEventListener('click', async () => {
    await window._dpAuthLogout?.();
    window.screenController?.close('profile');
  });

  actionsEl.append(logoutBtn);
  sidebar.append(avatarEl, fileInput, nameRow, editForm, emailEl, bioWrap, joinedEl, actionsEl);

  // ── Content ────────────────────────────────────────────────────────────────
  const content = document.createElement('main');
  content.className = 'prof-content';

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabBar = document.createElement('div');
  tabBar.className = 'prof-tabs';

  const tabOverview = document.createElement('button');
  tabOverview.className = 'prof-tab prof-tab--active';
  tabOverview.textContent = '概览';
  tabOverview.dataset.tab = 'overview';

  const tabFiles = document.createElement('button');
  tabFiles.className = 'prof-tab';
  tabFiles.textContent = '文件管理';
  tabFiles.dataset.tab = 'files';

  tabBar.append(tabOverview, tabFiles);
  content.appendChild(tabBar);

  // ── Overview pane ─────────────────────────────────────────────────────────
  const overviewPane = document.createElement('div');
  overviewPane.className = 'prof-tab-pane';
  overviewPane.dataset.pane = 'overview';

  const nbSec = document.createElement('section');
  nbSec.className = 'prof-section';
  nbSec.innerHTML = '<h3 class="prof-section-title">最近访问</h3>';
  nbSec.appendChild(_buildRecentNotebooks());

  const hmSec = document.createElement('section');
  hmSec.className = 'prof-section';
  hmSec.innerHTML = '<h3 class="prof-section-title">活跃度</h3>';
  hmSec.appendChild(_buildHeatmap());

  const actSec = document.createElement('section');
  actSec.className = 'prof-section';
  actSec.innerHTML = '<h3 class="prof-section-title">近期活动</h3>';
  actSec.appendChild(_buildActivityFeed());

  const filesSec = document.createElement('section');
  filesSec.className = 'prof-section';
  filesSec.innerHTML = '<h3 class="prof-section-title">最近文件</h3>';
  filesSec.appendChild(_buildRecentFiles());

  overviewPane.append(nbSec, filesSec, hmSec, actSec);

  // ── File manager pane ─────────────────────────────────────────────────────
  const filesPane = document.createElement('div');
  filesPane.className = 'prof-tab-pane';
  filesPane.dataset.pane = 'files';
  filesPane.hidden = true;

  content.append(overviewPane, filesPane);

  // ── Tab switching ─────────────────────────────────────────────────────────
  let _filesPaneLoaded = false;

  function _switchTab(tab) {
    tabBar.querySelectorAll('.prof-tab').forEach(t =>
      t.classList.toggle('prof-tab--active', t.dataset.tab === tab)
    );
    overviewPane.hidden = tab !== 'overview';
    filesPane.hidden    = tab !== 'files';
    if (tab === 'files' && !_filesPaneLoaded) {
      _filesPaneLoaded = true;
      if (window.authClient?.isLoggedIn()) {
        _buildCloudFileManager(filesPane);
      } else {
        filesPane.innerHTML = '<div class="cfm-empty">请先登录后查看云端文件</div>';
      }
    }
  }

  tabOverview.addEventListener('click', () => _switchTab('overview'));
  tabFiles.addEventListener('click', () => _switchTab('files'));

  layout.append(sidebar, content);
  screen.appendChild(layout);
}

// ── Setup ─────────────────────────────────────────────────────────────────────
function setupProfileScreen() {
  const screen = document.getElementById('profile-screen');
  if (!screen) return;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.screenController?.register('profile', screen, {
      label: '主页', group: 'hero', persisted: false, defaultOpen: false, noChip: true,
    });
    window.screenController?.close('profile');
  }));

  document.addEventListener('screen-opened', ({ detail }) => {
    if (detail?.id === 'profile') _renderProfile(screen);
  });

  document.addEventListener('dp-auth-state', () => {
    if (window.screenController?.getState('profile') === 'normal') _renderProfile(screen);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupProfileScreen);
} else {
  setupProfileScreen();
}
