import { escapeHtml, renderJson } from './content_screen_utility.js';
import { FLAT_PAGES }            from '../../../content_pages/pages.js';
import { setupNavSearch }        from '../../search_bar/search_bar.js';

// ── Setup ───────────────────────────────────────────────────────────────────────
function setupContentScreen() {
  const hero = document.getElementById('content-screen');
  if (!hero) return;

  hero.classList.add('content-screen');

  // ── Build split layout ───────────────────────────────────────────────────────
  hero.innerHTML = `
    <aside class="docs-sidebar nav-sidebar-inner" id="docs-sidebar">
      <div class="docs-sidebar-header">
        <i class="ti ti-book-2"></i>
        <span>文档</span>
      </div>
      <div class="nav-search-container" id="docs-search-container"></div>
      <div class="docs-nav-scroll nav-sections">
        <div id="docs-nav-tree"></div>
      </div>
    </aside>
    <main class="docs-main" id="docs-main">
      <nav class="docs-breadcrumb" id="docs-breadcrumb">
        <span class="docs-bc-root">文档</span>
      </nav>
      <div class="docs-body" id="docs-body">
        <div class="docs-welcome">
          <i class="ti ti-book-open-2 docs-welcome-icon"></i>
          <p>从左侧目录选择章节开始阅读</p>
        </div>
      </div>
      <nav class="docs-pagination" id="docs-pagination" hidden>
        <button class="docs-prev-btn" id="docs-prev-btn">← 上一页</button>
        <button class="docs-next-btn" id="docs-next-btn">下一页 →</button>
      </nav>
    </main>
  `;

  const bodyEl   = document.getElementById('docs-body');
  const bcEl     = document.getElementById('docs-breadcrumb');
  const paginEl  = document.getElementById('docs-pagination');
  const prevBtn  = document.getElementById('docs-prev-btn');
  const nextBtn  = document.getElementById('docs-next-btn');

  let _currentFile = null;

  // ── Breadcrumb update ────────────────────────────────────────────────────────
  function _setBreadcrumb(group, title) {
    bcEl.innerHTML =
      `<span class="docs-bc-root">文档</span>` +
      (group ? `<span class="docs-bc-sep">›</span><span class="docs-bc-group">${escapeHtml(group)}</span>` : '') +
      `<span class="docs-bc-sep">›</span><span class="docs-bc-current">${escapeHtml(title)}</span>`;
  }

  // ── Prev / Next ──────────────────────────────────────────────────────────────
  function _updatePagination(file) {
    const idx  = FLAT_PAGES.findIndex(p => p.dataFile === file);
    const prev = FLAT_PAGES[idx - 1];
    const next = FLAT_PAGES[idx + 1];
    if (idx === -1) { paginEl.hidden = true; return; }

    paginEl.hidden = false;
    prevBtn.hidden = !prev;
    nextBtn.hidden = !next;
    if (prev) prevBtn.textContent = `← ${prev.title}`;
    if (next) nextBtn.textContent = `下一页：${next.title} →`;

    prevBtn.onclick = prev
      ? () => window.contentScreen.renderFromJson(prev.dataFile, { title: prev.title, group: prev.group })
      : null;
    nextBtn.onclick = next
      ? () => window.contentScreen.renderFromJson(next.dataFile, { title: next.title, group: next.group })
      : null;
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  window.contentScreen = {

    getNavSlot() { return document.getElementById('docs-nav-tree'); },
    showNav() {},   // no-op in split layout
    showChat() {},  // no-op
    hideNav() {},   // no-op
    getChatSlot() { return null; },

    render(html) { bodyEl.innerHTML = html; },
    clear()      { bodyEl.innerHTML = ''; },
    getBody()    { return bodyEl; },

    async renderFromJson(jsonPath, { title = null, group = null } = {}) {
      _currentFile = jsonPath;
      window.screenController?.ensureVisible?.('content');

      // Breadcrumb
      _setBreadcrumb(group, title ?? '');

      // Loading
      bodyEl.innerHTML = '<p class="docs-loading"><i class="ti ti-loader-2 docs-spin"></i> 加载中…</p>';

      try {
        const resp = await fetch(jsonPath);
        if (!resp.ok) throw new Error(`${resp.status}`);
        const data = await resp.json();
        _renderDocs(data, bodyEl);
      } catch (err) {
        bodyEl.innerHTML = `<p class="docs-error">无法加载内容 (${escapeHtml(err.message)})</p>`;
      }

      // Pagination
      _updatePagination(jsonPath);

      // Scroll top
      document.getElementById('docs-main')?.scrollTo(0, 0);

      // MathJax
      if (window.MathJax?.typesetPromise) MathJax.typesetPromise([bodyEl]).catch(() => {});
    },
  };

  // Mount search bar into docs sidebar
  const searchContainer = document.getElementById('docs-search-container');
  if (searchContainer) setupNavSearch(searchContainer, FLAT_PAGES);

  // Register screen
  requestAnimationFrame(() => {
    window.screenController?.register('content', hero, {
      label: '文档',
      persisted: true,
      defaultOpen: false,
      noChip: true,
      group: 'hero',
    });
  });
}

// ── Docs renderer (adapted from content_screen_utility renderJson) ──────────────
function _renderDocs(data, body) {
  const { title, setup, blocks = [] } = data;
  let html = '';

  if (title) {
    html += `<h1 class="docs-h1">${escapeHtml(title)}</h1>`;
  }

  if (setup) {
    html += `<div class="docs-code-wrap"><pre class="docs-code"><code>${escapeHtml(setup.trim())}</code></pre>` +
            `<button class="docs-copy-btn lus-copy-btn" title="复制代码">` +
            `<i class="ti ti-copy"></i></button></div>`;
  }

  for (const block of blocks) {
    html += `<h2 class="docs-h2">${escapeHtml(block.label ?? '')}</h2>`;

    if (block.intro) {
      html += `<p class="docs-p">${escapeHtml(block.intro)}</p>`;
    }

    if (block.note) {
      html += `<div class="docs-tip"><i class="ti ti-bulb docs-tip-icon"></i><span>${escapeHtml(block.note)}</span></div>`;
    }

    if (block.items?.length) {
      html += `<ul class="docs-list">${block.items.map(it => `<li>${escapeHtml(it)}</li>`).join('')}</ul>`;
    }

    const examples = block.examples ?? (block.code ? [{ code: block.code, result: block.result }] : []);
    for (const ex of examples) {
      if (ex.desc) html += `<p class="docs-p docs-ex-desc">${escapeHtml(ex.desc)}</p>`;
      if (ex.code) {
        html += `<div class="docs-code-wrap">` +
                `<pre class="docs-code"><code>${escapeHtml(ex.code)}</code></pre>` +
                `<button class="docs-copy-btn lus-copy-btn" title="复制代码"><i class="ti ti-copy"></i></button>` +
                `</div>`;
      }
      if (ex.result) {
        html += `<pre class="docs-output">${escapeHtml(ex.result)}</pre>`;
      }
    }
  }

  body.innerHTML = html;

  // Copy buttons
  body.querySelectorAll('.docs-copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.previousElementSibling?.querySelector('code')?.textContent ?? '';
      navigator.clipboard?.writeText(code).then(() => {
        btn.innerHTML = `<i class="ti ti-check"></i>`;
        btn.classList.add('lus-copy-btn--done');
        setTimeout(() => {
          btn.innerHTML = `<i class="ti ti-copy"></i>`;
          btn.classList.remove('lus-copy-btn--done');
        }, 1500);
      });
    });
  });
}

// ── Init ────────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupContentScreen);
} else {
  setupContentScreen();
}
