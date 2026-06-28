import { buildIndex }  from './search_bar_utilities.js';
import { attachHooks } from './search_bar_hooks.js';

// ── Embed search widget into the nav sidebar ─────────────────
// wrapEl  = .nav-search-container  (flex-shrink: 0 inside .nav-sidebar-inner)
// Results list is inserted as a flex sibling of .nav-sections so it fills
// the remaining sidebar height while searching.
export async function setupNavSearch(wrapEl, pages) {

  // ── DOM ──────────────────────────────────────────────────
  wrapEl.innerHTML = `
    <div class="nav-search-wrap">
      <span class="nav-search-icon" aria-hidden="true">⌕</span>
      <input
        class="nav-search-input"
        type="text"
        placeholder="search topics…"
        autocomplete="off"
        spellcheck="false"
        aria-label="Search topics"
      />
      <span class="nav-search-clear" aria-label="Clear" hidden>✕</span>
    </div>
  `;

  const inner       = wrapEl.closest('.nav-sidebar-inner');
  const navSections = inner?.querySelector('.nav-sections');

  const resultsList = document.createElement('ul');
  resultsList.className = 'nav-search-results';
  resultsList.hidden    = true;
  if (navSections) inner.insertBefore(resultsList, navSections);

  const input    = wrapEl.querySelector('.nav-search-input');
  const clearBtn = wrapEl.querySelector('.nav-search-clear');

  // ── Index state ──────────────────────────────────────────
  let index    = null;
  let indexing = false;

  async function ensureIndex() {
    if (index)    return index;
    if (indexing) return null;
    indexing = true;
    input.classList.add('nav-search-loading');
    index = await buildIndex(pages);
    input.classList.remove('nav-search-loading');
    return index;
  }

  // ── Shared helpers ───────────────────────────────────────
  function getItems() {
    return [...resultsList.querySelectorAll('.nav-search-item')];
  }

  function setActive(i) {
    getItems().forEach((el, n) => el.classList.toggle('active', n === i));
    getItems()[i]?.scrollIntoView({ block: 'nearest' });
  }

  async function selectItem(li) {
    const { dataFile, id } = li.dataset;
    input.value = '';
    clearSearch();
    await window.contentScreen?.renderFromJson(dataFile);
    document.querySelectorAll('.nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.file === dataFile);
    });
    // Wait two frames so the render fully paints before measuring positions
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target  = document.getElementById(id);
      const scroller = document.getElementById('docs-main');
      if (!target || !scroller) return;
      // Scroll so the heading title aligns with the top of the content area
      const targetTop   = target.getBoundingClientRect().top;
      const scrollerTop = scroller.getBoundingClientRect().top;
      scroller.scrollBy({ top: targetTop - scrollerTop - 16, behavior: 'smooth' });
    }));
  }

  function clearSearch() {
    resultsList.hidden    = true;
    resultsList.innerHTML = '';
    clearBtn.hidden       = true;
    if (navSections) navSections.hidden = false;
  }

  // ── Wire events ──────────────────────────────────────────
  attachHooks({
    input, clearBtn, resultsList, navSections,
    getItems, setActive, selectItem, clearSearch, ensureIndex,
  });
}
