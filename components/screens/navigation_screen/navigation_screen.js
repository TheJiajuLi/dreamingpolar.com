import { PAGES }          from '../../../content_pages/pages.js';
import { setupNavSearch } from '../../search_bar/search_bar.js';

const RENDER_SOURCE_TAG = 'buildTree-v2';

// ── Card grid builder (for Docs sections) ─────────────
function buildCardGrid(cards) {
  return `<div class="doc-card-grid">${cards.map(({ title, desc, dataFile, icon }) => `
    <button class="doc-card" data-file="${dataFile || ''}">
      <div class="doc-card-icon">${icon || ''}</div>
      <div class="doc-card-title">${title}</div>
      <div class="doc-card-desc">${desc || ''}</div>
    </button>`).join('')}</div>`;
}

// ── Section label resolver ─────────────────────────────
function resolveSectionLabel(section) {
  if (!section.title) {
    console.error('[navigation_screen] 分组缺少 title 字段：', section);
    return '(未命名分组)';
  }
  return section.title;
}

// ── Tree builder ───────────────────────────────────────
function buildTree(pages, depth = 0) {
  if (!pages?.length) return '';

  const items = pages.map((section) => {
    const { href, title, children, dataFile, cardGrid, cards } = section;
    if (cardGrid && cards?.length) {
      const label = resolveSectionLabel(section);
      return `<li class="nav-item nav-item--cards" data-render-source="${RENDER_SOURCE_TAG}">
        <div class="nav-section-label nav-section-label--docs">${label}</div>
        ${buildCardGrid(cards)}
      </li>`;
    }
    const hasChildren = !!children?.length;
    return `
      <li class="nav-item" data-render-source="${RENDER_SOURCE_TAG}">
        <div class="nav-row">
          <a class="nav-link" href="${href || '#'}" ${dataFile ? `data-file="${dataFile}"` : ''}>${title}</a>
          ${hasChildren
            ? `<button class="nav-toggle" aria-expanded="false">›</button>`
            : ''}
        </div>
        ${hasChildren
          ? `<div class="nav-children" hidden>${buildTree(children, depth + 1)}</div>`
          : ''}
      </li>`;
  }).join('');

  return `<ul class="nav-list" data-depth="${depth}" data-render-source="${RENDER_SOURCE_TAG}">${items}</ul>`;
}

// ── Main setup ─────────────────────────────────────────
function setupNavigationScreen() {
  const menuBtn = document.getElementById('navigation-button');
  if (!menuBtn) return;

  window.renderPages    = PAGES;
  window.renderSections = [];

  const navInner = document.createElement('div');
  navInner.className = 'cs-nav-inner';
  navInner.innerHTML = `
    <div class="nav-search-container" id="nav-search-mount"></div>
    <div class="nav-sections">
      <div id="nav-pages-tree"></div>
    </div>
  `;

  let _built = false;

  function _buildNav() {
    if (_built) return;
    _built = true;
    const cs = window.contentScreen;
    if (!cs) return;
    cs.getNavSlot().appendChild(navInner);
    const searchMount = navInner.querySelector('#nav-search-mount');
    if (searchMount) setupNavSearch(searchMount, window.renderPages ?? PAGES);
  }

  function _isContentOpen() {
    const s = window.screenController?.getState('content');
    return s === 'normal' || s === 'maximized';
  }

  function _syncBtn() {
    const open = _isContentOpen();
    menuBtn.classList.toggle('active', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  }

  function open() {
    window.screenController?.open('content');
    requestAnimationFrame(() => {
      _buildNav();
      window.contentScreen?.showNav();
      refreshTree();
    });
  }

  function close() {
    window.screenController?.close('content');
  }

  menuBtn.addEventListener('click', () => (_isContentOpen() ? close() : open()));

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _isContentOpen()) close(); });

  for (const evt of ['screen-opened', 'screen-closed', 'screen-minimized']) {
    document.addEventListener(evt, e => { if (e.detail?.id === 'content') _syncBtn(); });
  }

  const contentEl = document.getElementById('content-screen');
  if (contentEl) {
    new MutationObserver(_syncBtn).observe(contentEl, {
      attributes: true,
      attributeFilter: ['data-screen-state'],
    });
  }

  document.addEventListener('cs-back-to-nav', () => open());

  setTimeout(_syncBtn, 300);

  // ── Tree ──────────────────────────────────────────────
  function refreshTree() {
    const tree = navInner.querySelector('#nav-pages-tree');
    if (!tree) return;
    const data = window.renderPages ?? PAGES;
    console.log('[navigation_screen] refreshTree 渲染数据:',
      data.map(s => ({ title: s.title, cardGrid: s.cardGrid })));
    tree.innerHTML = data.map(section => `
  <li class="nav-item nav-item--cards" data-render-source="buildTree-v2">
    <div class="nav-section-label nav-section-label--docs">${section.title}</div>
    <div class="doc-card-grid">${(section.cards || []).map(c => `
      <button class="doc-card" data-file="${c.dataFile || ''}">
        <div class="doc-card-icon">${c.icon || ''}</div>
        <div class="doc-card-title">${c.title}</div>
        <div class="doc-card-desc">${c.desc || ''}</div>
      </button>`).join('')}
    </div>
  </li>`).join('');

    const path = window.location.pathname;
    tree.querySelectorAll('.nav-link').forEach(a => {
      const active = a.getAttribute('href') === path;
      a.classList.toggle('active', active);
      if (active) {
        let el = a.closest('.nav-children');
        while (el) {
          el.hidden = false;
          const item = el.closest('.nav-item');
          item?.classList.add('open');
          const btn = item?.querySelector(':scope > .nav-row > .nav-toggle');
          if (btn) btn.setAttribute('aria-expanded', 'true');
          el = item?.parentElement?.closest('.nav-children');
        }
      }
    });

    tree.querySelectorAll('.nav-row').forEach(row => {
      const link   = row.querySelector('.nav-link:not([data-file])');
      const toggle = row.querySelector('.nav-toggle');
      if (link && toggle) {
        link.addEventListener('click', e => { e.preventDefault(); toggle.click(); });
      }
    });

    tree.querySelectorAll('.nav-link[data-file]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        tree.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        a.classList.add('active');
        window.contentScreen?.renderFromJson(a.dataset.file, { title: a.textContent.trim() });
      });
    });

    tree.querySelectorAll('.doc-card[data-file]').forEach(btn => {
      btn.addEventListener('click', () => {
        tree.querySelectorAll('.doc-card').forEach(c => c.classList.remove('active'));
        tree.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        btn.classList.add('active');
        const title = btn.querySelector('.doc-card-title')?.textContent.trim() ?? '';
        window.contentScreen?.renderFromJson(btn.dataset.file, { title });
      });
    });

    tree.querySelectorAll('.nav-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const item     = btn.closest('.nav-item');
        const children = item.querySelector(':scope > .nav-children');
        const opening  = children.hidden;
        children.hidden = !opening;
        btn.setAttribute('aria-expanded', String(opening));
        item.classList.toggle('open', opening);
      });
    });
  }
}

// ── Init ───────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNavigationScreen);
} else {
  setupNavigationScreen();
}
