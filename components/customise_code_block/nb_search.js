// ── Notebook Global Search ────────────────────────────────────────────────────
// Mounts a search box in the center of cds-notebook-toolbar.
// Highlights all matches across all .nb-editor textareas via overlay divs.
// Completely independent — touches no cell run/save logic.

let _query     = '';
let _matches   = [];   // [{ editorEl, cellMatchIdx }] — one entry per match occurrence
let _activeIdx = -1;
let _countEl   = null;
let _inputEl   = null;
let _clearBtnEl = null;

// ── Public ────────────────────────────────────────────────────────────────────

export function mountNbSearch(toolbar, insertBeforeEl) {
  // Two flex:1 spacers bracket the search box to centre it.
  const spacerL = _el('div', 'nb-search-spacer');
  const spacerR = _el('div', 'nb-search-spacer');
  const wrap    = _el('div', 'nb-search-wrap');

  const input   = document.createElement('input');
  input.type        = 'text';
  input.className   = 'nb-search-input';
  input.placeholder = '搜索 Cells…';
  input.autocomplete = 'off';
  input.spellcheck  = false;
  input.setAttribute('aria-label', '搜索所有 Cell');

  const count   = _el('span', 'nb-search-count');
  const prevBtn = _navBtn('↑', 'Shift+Enter / ↑ 上一个');
  const nextBtn = _navBtn('↓', 'Enter / ↓  下一个');
  const clearBtn = _el('button', 'nb-search-clear sc-btn');
  clearBtn.title = '清除 (Esc)';
  clearBtn.innerHTML =
    `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.8" stroke-linecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;

  _countEl   = count;
  _inputEl   = input;
  _clearBtnEl = clearBtn;

  wrap.append(input, count, prevBtn, nextBtn, clearBtn);

  if (insertBeforeEl && toolbar.contains(insertBeforeEl)) {
    toolbar.insertBefore(spacerL, insertBeforeEl);
    toolbar.insertBefore(wrap,    insertBeforeEl);
    toolbar.insertBefore(spacerR, insertBeforeEl);
  } else {
    toolbar.append(spacerL, wrap, spacerR);
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  let _debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(_debounce);
    _debounce = setTimeout(() => _runSearch(input.value), 80);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); _navigate(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); _clear(); input.blur(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); _navigate(1); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _navigate(-1); }
  });

  prevBtn.addEventListener('click', () => _navigate(-1));
  nextBtn.addEventListener('click', () => _navigate(1));
  clearBtn.addEventListener('click', () => { _clear(); input.focus(); });

  // Ctrl/Cmd+F — focus search when coding screen is visible
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.key !== 'f') return;
    const cs = document.getElementById('coding-screen');
    if (!cs || cs.dataset.screenState === 'closed') return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  // Re-run active search when cells change
  document.addEventListener('input', e => {
    if (_query && e.target?.classList.contains('nb-editor')) {
      clearTimeout(_debounce);
      _debounce = setTimeout(() => _runSearch(_query), 300);
    }
  }, true);
}

// ── Search ────────────────────────────────────────────────────────────────────

function _runSearch(raw) {
  _query = raw.trim();
  _clearHighlights();
  _matches = [];

  const showClear = _query.length > 0;
  if (_clearBtnEl) _clearBtnEl.style.opacity = showClear ? '1' : '0';
  if (_clearBtnEl) _clearBtnEl.style.pointerEvents = showClear ? '' : 'none';

  if (!_query) { _renderCount(); return; }

  const lq      = _query.toLowerCase();
  const editors = [...document.querySelectorAll('.nb-cell[data-nb-id] .nb-editor')];

  for (const editorEl of editors) {
    const text   = editorEl.value;
    const lower  = text.toLowerCase();
    let pos = 0;
    let cellMatchIdx = 0;
    while (true) {
      const idx = lower.indexOf(lq, pos);
      if (idx === -1) break;
      _matches.push({ editorEl, start: idx, end: idx + _query.length, cellMatchIdx });
      cellMatchIdx++;
      pos = idx + 1;
    }
    if (cellMatchIdx > 0) _buildLayer(editorEl, text, lq);
  }

  _activeIdx = _matches.length > 0 ? 0 : -1;
  _renderCount();
  _activateMatch();
}

function _navigate(dir) {
  if (!_matches.length) return;
  _activeIdx = (_activeIdx + dir + _matches.length) % _matches.length;
  _renderCount();
  _activateMatch();
}

function _clear() {
  _query     = '';
  _matches   = [];
  _activeIdx = -1;
  if (_inputEl)   _inputEl.value = '';
  if (_clearBtnEl) { _clearBtnEl.style.opacity = '0'; _clearBtnEl.style.pointerEvents = 'none'; }
  _clearHighlights();
  _renderCount();
}

// ── Highlight layer ───────────────────────────────────────────────────────────

function _buildLayer(editorEl, text, lq) {
  const body = editorEl.closest('.nb-body');
  if (!body) return;

  const layer = _el('div', 'nb-search-hl-layer');
  layer.setAttribute('aria-hidden', 'true');

  // Build innerHTML: escape text, wrap matches in <mark class="nb-hl">
  let html = '';
  let pos = 0;
  const lower = text.toLowerCase();
  let mIdx = 0;
  while (pos <= text.length) {
    const idx = lower.indexOf(lq, pos);
    if (idx === -1) { html += _esc(text.slice(pos)); break; }
    html += _esc(text.slice(pos, idx));
    html += `<mark class="nb-hl" data-m="${mIdx}">${_esc(text.slice(idx, idx + lq.length))}</mark>`;
    pos = idx + lq.length;
    mIdx++;
  }

  // <pre> inside layer mirrors textarea metrics exactly
  const pre = _el('pre', 'nb-hl-pre');
  pre.innerHTML = html;
  layer.appendChild(pre);
  body.appendChild(layer);
}

function _activateMatch() {
  // Remove previous active mark
  document.querySelectorAll('.nb-hl--active').forEach(m => m.classList.remove('nb-hl--active'));
  if (_activeIdx < 0 || _activeIdx >= _matches.length) return;

  const { editorEl, cellMatchIdx } = _matches[_activeIdx];
  const body  = editorEl.closest('.nb-body');
  const layer = body?.querySelector('.nb-search-hl-layer');
  if (!layer) return;

  const mark = layer.querySelector(`.nb-hl[data-m="${cellMatchIdx}"]`);
  mark?.classList.add('nb-hl--active');

  // Scroll cell into view
  editorEl.closest('.nb-cell')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _clearHighlights() {
  document.querySelectorAll('.nb-search-hl-layer').forEach(el => el.remove());
}

function _renderCount() {
  if (!_countEl) return;
  if (_query && _matches.length > 0) {
    _countEl.textContent = `${_activeIdx + 1} / ${_matches.length}`;
    _countEl.style.display = '';
  } else if (_query && _matches.length === 0) {
    _countEl.textContent = '无匹配';
    _countEl.style.display = '';
  } else {
    _countEl.textContent = '';
    _countEl.style.display = 'none';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _el(tag, cls) {
  const el = document.createElement(tag);
  el.className = cls;
  return el;
}

function _navBtn(text, title) {
  const btn = _el('button', 'nb-search-nav-btn sc-btn');
  btn.textContent = text;
  btn.title = title;
  return btn;
}

function _esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
