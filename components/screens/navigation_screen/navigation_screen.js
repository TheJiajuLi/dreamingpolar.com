import { PAGES, FLAT_PAGES } from '../../../content_pages/pages.js';

// ── Sidebar nav tree ────────────────────────────────────────────────────────────

let _activeFile = null;
let _activeTitle = null;

function _makeItem(item, depth = 0) {
  const li = document.createElement('li');
  li.className = 'docs-nav-item' + (depth > 0 ? ' docs-nav-item--child' : '');

  if (item.children?.length) {
    // Parent with children (expandable)
    const header = document.createElement('div');
    header.className = 'docs-nav-parent';
    header.innerHTML =
      `<span class="docs-nav-parent-label">${item.title}</span>` +
      `<i class="ti ti-chevron-right docs-nav-chevron"></i>`;

    const childList = document.createElement('ul');
    childList.className = 'docs-nav-children';
    item.children.forEach(child => childList.appendChild(_makeItem(child, depth + 1)));

    header.addEventListener('click', () => {
      const open = li.classList.toggle('docs-nav-item--open');
      header.querySelector('.docs-nav-chevron').style.transform = open ? 'rotate(90deg)' : '';
    });

    li.append(header, childList);
  } else if (item.dataFile) {
    // Leaf with dataFile
    const a = document.createElement('button');
    a.className = 'docs-nav-link';
    a.dataset.file  = item.dataFile;
    a.dataset.title = item.title;
    a.dataset.group = item.group ?? '';

    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.title;
    a.appendChild(labelSpan);

    if (item.badge) {
      const badge = document.createElement('span');
      badge.className = 'docs-nav-badge';
      badge.textContent = item.badge;
      a.appendChild(badge);
    }

    a.addEventListener('click', () => _loadPage(item.dataFile, item.title, item.group));
    li.appendChild(a);
  }

  return li;
}

function _buildTree(container) {
  container.innerHTML = '';
  for (const group of PAGES) {
    const groupEl = document.createElement('div');
    groupEl.className = 'docs-nav-group';

    const label = document.createElement('div');
    label.className = 'docs-nav-group-label';
    label.textContent = group.group;
    groupEl.appendChild(label);

    const ul = document.createElement('ul');
    ul.className = 'docs-nav-list';
    group.items.forEach(item => ul.appendChild(_makeItem(item)));
    groupEl.appendChild(ul);

    container.appendChild(groupEl);
  }
}

function _setActive(file, title = null) {
  _activeFile = file;
  _activeTitle = title;

  const buttons = [...document.querySelectorAll('.docs-nav-link')];
  let target = null;

  if (title) {
    target = buttons.find(btn => btn.dataset.file === file && btn.dataset.title === title) ?? null;
  }
  if (!target) {
    target = buttons.find(btn => btn.dataset.file === file) ?? null;
  }

  buttons.forEach(btn => {
    const isActive = btn === target;
    btn.classList.toggle('docs-nav-link--active', isActive);
    // Auto-expand parent when child is active
    if (isActive) {
      let parent = btn.closest('.docs-nav-item--child')?.closest('li.docs-nav-item');
      if (parent && !parent.classList.contains('docs-nav-item--open')) {
        parent.classList.add('docs-nav-item--open');
        const chev = parent.querySelector('.docs-nav-chevron');
        if (chev) chev.style.transform = 'rotate(90deg)';
      }
    }
  });
}

function _loadPage(file, title, group) {
  _setActive(file, title);
  window.contentScreen?.renderFromJson(file, { title, group });
}

// ── Main setup ──────────────────────────────────────────────────────────────────
function setupNavigationScreen() {
  const menuBtn = document.getElementById('navigation-button');
  if (!menuBtn) return;

  function _isContentOpen() {
    const s = window.screenController?.getState('content');
    return s === 'normal' || s === 'maximized';
  }

  function _syncBtn() {
    const open = _isContentOpen();
    menuBtn.classList.toggle('active', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  }

  menuBtn.addEventListener('click', () => {
    if (_isContentOpen()) {
      window.screenController?.close('content');
    } else {
      window.screenController?.open('content');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _isContentOpen()) window.screenController?.close('content');
  });

  for (const evt of ['screen-opened', 'screen-closed', 'screen-minimized']) {
    document.addEventListener(evt, e => { if (e.detail?.id === 'content') _syncBtn(); });
  }

  // Build nav tree once content screen is ready
  function _initTree() {
    const treeEl = document.getElementById('docs-nav-tree');
    if (!treeEl || treeEl.dataset.built) return;
    treeEl.dataset.built = '1';
    _buildTree(treeEl);

    // Auto-load first page
    const first = FLAT_PAGES[0];
    if (first) _loadPage(first.dataFile, first.title, first.group);
  }

  // Try immediately (content screen may already be mounted)
  requestAnimationFrame(() => {
    _initTree();
    _syncBtn();
  });

  // Also try when content screen opens
  document.addEventListener('screen-opened', e => {
    if (e.detail?.id === 'content') _initTree();
  });
}

// ── Init ────────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNavigationScreen);
} else {
  setupNavigationScreen();
}
