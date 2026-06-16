import { PAGES }          from '../../../content_pages/pages.js';
import { setupNavSearch } from '../../search_bar/search_bar.js';

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

// ── Main setup ─────────────────────────────────────────
function setupNavigationScreen() {
  const menuBtn = document.getElementById('navigation-button');
  if (!menuBtn) return;

  window.renderPages    = PAGES;
  window.renderSections = [];

  // ── Nav content (injected once into content screen's nav slot) ──
  const navInner = document.createElement('div');
  navInner.className = 'cs-nav-inner';
  navInner.innerHTML = `
    <div class="nav-search-container" id="nav-search-mount"></div>
    <div class="nav-sections">
      <p class="nav-section-label">Pages</p>
      <div id="nav-pages-tree"></div>
    </div>
  `;

  let _built  = false;
  let _isOpen = false;

  function open() {
    window.screenController?.ensureVisible('content');
    const cs = window.contentScreen;
    if (!cs) return;
    if (!_built) {
      _built = true;
      cs.getNavSlot().appendChild(navInner);
      const searchMount = navInner.querySelector('#nav-search-mount');
      if (searchMount) setupNavSearch(searchMount, PAGES);
    }
    cs.showNav();
    refreshTree();
    _isOpen = true;
    menuBtn.classList.add('active');
    menuBtn.setAttribute('aria-expanded', 'true');
  }

  function close() {
    const sc    = window.screenController;
    const state = sc?.getState('content');
    if (state === 'closed' || state === 'minimized') {
      sc?.ensureVisible('content');
    } else {
      window.contentScreen?.hideNav();
    }
    _setMenuOpen(false);
  }

  menuBtn.addEventListener('click', () => (_isOpen ? close() : open()));

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && _isOpen) close(); });

  function _setMenuOpen(val) {
    _isOpen = val;
    menuBtn.classList.toggle('active', val);
    menuBtn.setAttribute('aria-expanded', String(val));
  }

  // Sync when AI chat or a content link takes over the view inside content screen
  document.addEventListener('content-nav-closed', () => { if (_isOpen) _setMenuOpen(false); });

  // Content screen hidden by user action (minimize/close button): deactivate menu.
  // Skip if: menu already closed, content is in chat mode, or coding just opened
  // (coding opening means start-coding triggered the minimize — menu state unchanged).
  const _onContentHidden = e => {
    if (e.detail?.id !== 'content') return;
    if (!_isOpen) return;
    const inChat = document.getElementById('content-screen')?.classList.contains('cs-chat-mode');
    if (inChat) return;
    requestAnimationFrame(() => {
      const codingState = window.screenController?.getState('coding');
      if (codingState && codingState !== 'closed') return;
      _setMenuOpen(false);
    });
  };
  document.addEventListener('screen-closed',    _onContentHidden);
  document.addEventListener('screen-minimized', _onContentHidden);

  document.addEventListener('open-ai-in-content', () => {
    if (_isOpen) {
      _isOpen = false;
      menuBtn.classList.remove('active');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('cs-back-to-nav', () => open());

  // ── Tree ──────────────────────────────────────────────
  function refreshTree() {
    const tree = navInner.querySelector('#nav-pages-tree');
    if (!tree) return;
    tree.innerHTML = buildTree(PAGES);

    // Active link + auto-expand ancestors
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

    // Parent links toggle on click
    tree.querySelectorAll('.nav-row').forEach(row => {
      const link   = row.querySelector('.nav-link:not([data-file])');
      const toggle = row.querySelector('.nav-toggle');
      if (link && toggle) {
        link.addEventListener('click', e => { e.preventDefault(); toggle.click(); });
      }
    });

    // Content links → render in content screen (switches to content view)
    tree.querySelectorAll('.nav-link[data-file]').forEach(a => {
      a.addEventListener('click', e => {
        e.preventDefault();
        tree.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        a.classList.add('active');
        window.contentScreen?.renderFromJson(a.dataset.file, { title: a.textContent.trim() });
      });
    });

    // Toggle click
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
