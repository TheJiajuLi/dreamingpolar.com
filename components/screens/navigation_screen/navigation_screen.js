import { PAGES }          from '../../../content_pages/pages.js';
import { setupNavSearch } from '../../search_bar/search_bar.js';

// ── Config ─────────────────────────────────────────────
const STORAGE = {
  open: 'dreaming-polar-nav-open',
};

// ── Tree builder ───────────────────────────────────────
function buildTree(pages, depth = 0) {
  if (!pages?.length) return '';

  const items = pages.map(({ href, title, children, dataFile }) => {
    const hasChildren = !!children?.length;
    return `
      <li class="nav-item">
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

  return `<ul class="nav-list" data-depth="${depth}">${items}</ul>`;
}

// ── Sidebar template ───────────────────────────────────
function createSidebar() {
  const el = document.createElement('aside');
  el.className = 'nav-sidebar';
  el.setAttribute('aria-label', 'Navigation');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="nav-sidebar-inner">
      <div class="nav-header">
        <span class="nav-title">Navigation</span>
        <button class="nav-close-btn" aria-label="Close navigation">✕</button>
      </div>
      <div class="nav-search-container" id="nav-search-mount"></div>
      <div class="nav-sections">
        <p class="nav-section-label">Pages</p>
        <div id="nav-pages-tree"></div>
      </div>
    </div>
  `;
  return el;
}

// ── Main setup ─────────────────────────────────────────
function setupNavigationScreen() {
  const menuBtn    = document.getElementById('menu-button');
  const pageLayout = document.getElementById('page-layout');
  if (!menuBtn || !pageLayout) return;

  window.renderPages    = PAGES;
  window.renderSections = [];

  const NAV_W_KEY = 'dreaming-polar-nav-width';
  const savedW = localStorage.getItem(NAV_W_KEY);
  if (savedW) document.documentElement.style.setProperty('--nav-w', savedW);

  const sidebar = createSidebar();
  const vt = document.getElementById('vertical-toolbar');
  pageLayout.insertBefore(sidebar, vt ? vt.nextSibling : pageLayout.firstChild);

  // ── Resize handle ──
  const handle = document.createElement('div');
  handle.className = 'nav-resize-handle';
  sidebar.appendChild(handle);

  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.classList.add('nav-resizing');
    e.preventDefault();

    let rafId = null;
    let pendingW = startW;

    const onMove = mv => {
      const newW = Math.max(140, Math.min(startW + (mv.clientX - startX), window.innerWidth * 0.45));
      if (newW === pendingW) return;
      pendingW = newW;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        document.documentElement.style.setProperty('--nav-w', pendingW + 'px');
      });
    };

    const onUp = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      handle.classList.remove('dragging');
      document.body.classList.remove('nav-resizing');
      localStorage.setItem(NAV_W_KEY, getComputedStyle(document.documentElement).getPropertyValue('--nav-w').trim());
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });

  // ── Embedded search ──
  const searchMount = document.getElementById('nav-search-mount');
  if (searchMount) setupNavSearch(searchMount, PAGES);

  // ── Tree ──
  function refreshTree() {
    const tree = document.getElementById('nav-pages-tree');
    if (!tree) return;
    tree.innerHTML = buildTree(PAGES);

    // active link + auto-expand its ancestors
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

    // parent links (has children, no data-file) → clicking text also toggles
    tree.querySelectorAll('.nav-row').forEach(row => {
      const link   = row.querySelector('.nav-link:not([data-file])');
      const toggle = row.querySelector('.nav-toggle');
      if (link && toggle) {
        link.addEventListener('click', e => {
          e.preventDefault();
          toggle.click();
        });
      }
    });

    // content links — render JSON in content screen instead of navigating
    tree.querySelectorAll('.nav-link[data-file]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        tree.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        a.classList.add('active');
        window.contentScreen?.renderFromJson(a.dataset.file);
        if (window.innerWidth <= 768) {
          close();
          document.dispatchEvent(new CustomEvent('mob-switch-to-content'));
        }
      });
    });

    // toggle click
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

  // ── Open / close ──
  let isOpen = localStorage.getItem(STORAGE.open) === 'true';

  function open() {
    isOpen = true;
    sidebar.classList.add('open');
    sidebar.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.classList.add('active');
    localStorage.setItem(STORAGE.open, 'true');
    refreshTree();
  }

  function close() {
    isOpen = false;
    sidebar.classList.remove('open');
    sidebar.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.classList.remove('active');
    localStorage.setItem(STORAGE.open, 'false');
  }

  menuBtn.addEventListener('click', () => (isOpen ? close() : open()));
  sidebar.querySelector('.nav-close-btn').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) close(); });
  document.addEventListener('mob-close-nav', () => { if (isOpen) close(); });

  // click on blank content area closes nav
  document.querySelector('main.hero')?.addEventListener('click', () => {
    if (isOpen) close();
  });

  if (isOpen) open();

}

// ── Init ───────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNavigationScreen);
} else {
  setupNavigationScreen();
}