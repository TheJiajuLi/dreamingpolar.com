// ── Profile Screen — Phase 1, localStorage only ────────────────────────────
import { logActivity } from '../shared/activity_logger.js';

const RECENT_KEY          = 'dp_recent_items';
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
  generative: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
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

  const avatarEl = document.createElement('div');
  avatarEl.className = 'prof-avatar';
  avatarEl.textContent = initials;

  const nameEl = document.createElement('div');
  nameEl.className = 'prof-name';
  nameEl.textContent = user.username ?? '';

  const emailEl = document.createElement('div');
  emailEl.className = 'prof-email';
  emailEl.textContent = user.email ?? '';

  const joinedEl = document.createElement('div');
  joinedEl.className = 'prof-joined';
  joinedEl.textContent = `注册于 ${joined}`;

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
  editForm.hidden = true;

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

  // Toggle edit mode
  function _openEdit() {
    editForm.hidden = false;
    editPencil.style.display = 'none';
    editInput.value = nameEl.textContent;
    editInput.focus();
    editInput.select();
  }
  function _closeEdit() {
    editForm.hidden = true;
    editPencil.style.display = '';
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
    saveBtn.disabled = true; saveBtn.textContent = '保存中…';
    try {
      await window.authClient?.updateMe({ username: newName });
      const updatedUser = { ...window._dpGetAuthUser(), username: newName };
      document.dispatchEvent(new CustomEvent('dp-auth-state', { detail: { user: updatedUser } }));
      window._dpGetAuthUser = () => updatedUser;
      nameEl.textContent = newName;
      avatarEl.textContent = newName.slice(0, 2).toUpperCase();
      _closeEdit();
      saveBtn.disabled = false; saveBtn.textContent = '保存';
    } catch (e) {
      editErr.textContent = e.message || '保存失败';
      saveBtn.disabled = false; saveBtn.textContent = '保存';
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
  sidebar.append(avatarEl, nameRow, editForm, emailEl, joinedEl, actionsEl);

  // ── Content ────────────────────────────────────────────────────────────────
  const content = document.createElement('main');
  content.className = 'prof-content';

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

  content.append(nbSec, hmSec, actSec);
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
