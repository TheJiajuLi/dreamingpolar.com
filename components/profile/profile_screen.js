// ── Profile Screen — Phase 1, localStorage only ────────────────────────────
import { logActivity } from '../shared/activity_logger.js';

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

  content.append(nbSec, filesSec, hmSec, actSec);
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
