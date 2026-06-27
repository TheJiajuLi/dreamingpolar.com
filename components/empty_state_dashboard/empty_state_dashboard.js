// ── Empty State Dashboard ──────────────────────────────────────────────────────
// Shown in the hero area when all screens are minimised / closed.
// Reuses .doc-card / .doc-card-grid — no new visual language.

import { createLoadDataBtn } from '../import/import_data.js';

const RECENT_KEY  = 'dp_recent_items';
const MAX_RECENT  = 6;

// ── Recent-items API (consumed by notebook / generative screen) ───────────────
export function recordRecentItem({ id, name, type = 'notebook' }) {
  const items = _getRecent().filter(i => i.id !== id);
  items.unshift({ id, name, type, lastOpenedAt: Date.now() });
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  } catch (_) {}
}

function _getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); }
  catch { return []; }
}

function _relTime(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
const SVG_NOTEBOOK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="3" width="16" height="18" rx="1.5"/>
  <line x1="8" y1="8"  x2="16" y2="8"/>
  <line x1="8" y1="12" x2="16" y2="12"/>
  <line x1="8" y1="16" x2="13" y2="16"/>
  <line x1="4" y1="8"  x2="2"  y2="8"/>
  <line x1="4" y1="12" x2="2"  y2="12"/>
  <line x1="4" y1="16" x2="2"  y2="16"/>
</svg>`;

const SVG_ARIA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
  <circle cx="12" cy="12" r="2.2"/>
  <circle cx="5.5" cy="5.5" r="1.4"/>
  <circle cx="18.5" cy="5.5" r="1.4"/>
  <circle cx="5.5" cy="18.5" r="1.4"/>
  <circle cx="18.5" cy="18.5" r="1.4"/>
  <line x1="12" y1="9.8"  x2="6.8"  y2="6.8"/>
  <line x1="12" y1="9.8"  x2="17.2" y2="6.8"/>
  <line x1="12" y1="14.2" x2="6.8"  y2="17.2"/>
  <line x1="12" y1="14.2" x2="17.2" y2="17.2"/>
</svg>`;

const SVG_DATA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="12" cy="6" rx="7" ry="2.5"/>
  <path d="M5 6v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6"/>
  <path d="M5 10v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-4"/>
  <path d="M5 14v3c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-3"/>
</svg>`;

// SVG icons matching each app's vertical toolbar button
const ICON_SVG = {
  notebook:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><line x1="10" y1="6.5" x2="14" y2="6.5"/><line x1="6.5" y1="10" x2="6.5" y2="14"/><line x1="17.5" y1="10" x2="17.5" y2="14"/><line x1="10" y1="17.5" x2="14" y2="17.5"/></svg>`,
  generative: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  grid:       `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/><line x1="15" y1="9" x2="15" y2="21"/></svg>`,
  dataset:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5V6"/><path d="M5 10v4c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-4"/><path d="M5 14v3c0 1.38 3.13 2.5 7 2.5s7-1.12 7-2.5v-3"/></svg>`,
  default:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
};

// ── Build DOM ─────────────────────────────────────────────────────────────────
function _buildDashboard() {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state-dashboard';

  // ── Greeting ──────────────────────────────────────────────────────────────
  const greeting = document.createElement('div');
  greeting.className = 'esd-greeting';
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
  const base = window.BASE ?? '';
  greeting.innerHTML =
    `<img src="${base}/assets/app_logo/dreaming_polar.png" class="esd-greeting-logo" alt="Dreaming Polar">` +
    `<span class="esd-greeting-text">${timeOfDay}，今天想做什么分析？</span>`;
  wrap.appendChild(greeting);

  // ── Quick-start cards ─────────────────────────────────────────────────────
  const quickSection = document.createElement('div');
  quickSection.className = 'esd-section';
  quickSection.innerHTML = `<h3 class="esd-section-title">快速开始</h3>`;

  const grid = document.createElement('div');
  grid.className = 'doc-card-grid';

  // — New Notebook
  const btnNotebook = _card(SVG_NOTEBOOK, '新建 Notebook', '从空白 Cell 开始一次新分析');
  btnNotebook.addEventListener('click', () => {
    window.screenController?.open('coding');
  });

  // — Load Data (reuse existing component)
  const loadDataInner = createLoadDataBtn({ varName: 'df' });
  const btnData = _card(SVG_DATA, '导入数据', '上传 CSV / Excel，自动注入为 df');
  btnData.addEventListener('click', () => {
    window.screenController?.open('coding');
    // Give the coding screen a frame to appear, then trigger load
    requestAnimationFrame(() => requestAnimationFrame(() => loadDataInner.click()));
  });

  // — Ask ARIA
  const btnAria = _card(SVG_ARIA, '问问 ARIA', '用自然语言描述你想做的分析');
  btnAria.addEventListener('click', () => {
    window.screenController?.open('terminal');
    requestAnimationFrame(() => {
      document.getElementById('terminal-input')?.focus();
    });
  });

  grid.append(btnNotebook, btnData, btnAria);
  quickSection.appendChild(grid);
  wrap.appendChild(quickSection);

  // ── Recent items ──────────────────────────────────────────────────────────
  const recentSection = document.createElement('div');
  recentSection.className = 'esd-section';
  recentSection.innerHTML = `<h3 class="esd-section-title">最近使用</h3>`;

  const recentList  = document.createElement('div');
  recentList.className = 'esd-recent-list';
  recentList.id = 'esd-recent-list';

  const recentEmpty = document.createElement('div');
  recentEmpty.className = 'esd-recent-empty';
  recentEmpty.id = 'esd-recent-empty';
  recentEmpty.textContent = '还没有使用记录 — 从上方开始你的第一次分析吧';

  recentSection.append(recentList, recentEmpty);
  wrap.appendChild(recentSection);

  return { el: wrap, recentList, recentEmpty };
}

function _card(iconSvg, title, desc) {
  const btn = document.createElement('button');
  btn.className = 'doc-card esd-action-card';
  btn.innerHTML = `
    <div class="doc-card-icon">${iconSvg}</div>
    <div class="doc-card-title">${title}</div>
    <div class="doc-card-desc">${desc}</div>`;
  return btn;
}

function _renderRecent(listEl, emptyEl) {
  const items = _getRecent();
  if (!items.length) {
    listEl.style.display  = 'none';
    emptyEl.style.display = '';
    return;
  }
  listEl.style.display  = '';
  emptyEl.style.display = 'none';
  listEl.innerHTML = '';
  for (const item of items.slice(0, MAX_RECENT)) {
    const row = document.createElement('button');
    row.className = 'esd-recent-item';
    row.innerHTML = `
      <span class="esd-recent-icon">${ICON_SVG[item.type] || ICON_SVG.default}</span>
      <span class="esd-recent-name">${item.name}</span>
      <span class="esd-recent-time">${_relTime(item.lastOpenedAt)}</span>`;
    row.addEventListener('click', () => {
      // Re-open the relevant screen and dispatch a custom event with the item
      const screenId = item.type === 'dataset' ? 'terminal' : 'coding';
      window.screenController?.open(screenId);
      document.dispatchEvent(new CustomEvent('dp-open-recent', { detail: item }));
    });
    listEl.appendChild(row);
  }
}

// ── Mount ─────────────────────────────────────────────────────────────────────
export function initDashboard() {
  const heroRow = document.querySelector('.hero-screens-row');
  if (!heroRow) return;

  const { el, recentList, recentEmpty } = _buildDashboard();
  el.style.display = 'none';
  heroRow.appendChild(el);

  // ── Visibility logic: show when ALL hero screens are closed/minimised ──────
  // Show dashboard only when every hero screen is closed / minimised
  const HERO_IDS = ['content', 'coding', 'terminal', 'ai-chat', 'grid', 'user', 'profile'];
  function _allClosed() {
    const sc = window.screenController;
    if (!sc) return false;
    return HERO_IDS.every(id => {
      const s = sc.getState(id);
      if (s === null) return false; // not yet registered → treat as unknown (not closed)
      return s === 'closed' || s === 'minimized';
    });
  }

  function _sync() {
    const show = _allClosed();
    el.style.display = show ? '' : 'none';
    if (show) _renderRecent(recentList, recentEmpty);
  }

  // Watch all data-screen-state attribute changes (covers initial registration + toggling).
  // This catches cases where screens register after initDashboard runs (content uses rAF delay).
  const heroScreens = document.querySelector('.hero-screens-row');
  if (heroScreens) {
    new MutationObserver(_sync).observe(heroScreens, {
      attributes: true,
      attributeFilter: ['data-screen-state'],
      subtree: true,
    });
  }

  // Also listen to explicit events (minimize uses restore chip, not MutationObserver path)
  for (const evt of ['screen-opened', 'screen-closed', 'screen-minimized']) {
    document.addEventListener(evt, _sync);
  }

  // Initial check after everything settles (screens register across multiple rAFs)
  setTimeout(_sync, 200);
}
