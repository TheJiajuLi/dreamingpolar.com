const ICON_SOURCE = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
const ICON_COPY   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export function createSourceWidget() {
  let _code      = null;
  let _lang      = null;
  let _isRaw     = false;
  let _savedHTML = null;  // snapshot of textPane content for restore

  // ── Toggle button ──────────────────────────────────────────
  const btn = document.createElement('button');
  btn.className   = 'lus-btn';
  btn.title       = 'View source';
  btn.innerHTML   = ICON_SOURCE;
  btn.style.display = 'none';

  // ── Helpers ────────────────────────────────────────────────
  function _getTextPane() {
    const section = btn.closest('.cds-output-section, .nb-output-section');
    return section?.querySelector('.cds-output-text-pane')
        ?? section?.querySelector('.cds-output-section-body, .nb-output-section-body')
        ?? null;
  }

  function _showRaw() {
    const pane = _getTextPane();
    if (!pane || !_code) return;

    // Snapshot current output content so we can restore it
    _savedHTML = pane.innerHTML;

    // Replace pane content inline — no new sibling element
    pane.innerHTML = '';

    const langBar = document.createElement('div');
    langBar.className = 'lus-inline-lang-bar';

    const langLabel = document.createElement('span');
    langLabel.className   = 'lus-lang-label';
    langLabel.textContent = (_lang ?? 'source').toUpperCase();

    const copyBtn = document.createElement('button');
    copyBtn.className = 'lus-copy-btn';
    copyBtn.title     = 'Copy source';
    copyBtn.innerHTML = ICON_COPY;
    copyBtn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard?.writeText(_code).then(() => {
        copyBtn.innerHTML = ICON_CHECK;
        copyBtn.classList.add('lus-copy-btn--done');
        setTimeout(() => {
          copyBtn.innerHTML = ICON_COPY;
          copyBtn.classList.remove('lus-copy-btn--done');
        }, 1600);
      });
    });

    langBar.append(langLabel, copyBtn);

    const pre = document.createElement('pre');
    pre.className = 'output-text lus-source-pre';
    pre.textContent = _code;

    pane.append(langBar, pre);

    btn.classList.add('lus-btn--active');
    btn.title = 'Back to output';
    _isRaw = true;
  }

  function _showOutput() {
    const pane = _getTextPane();
    if (pane && _savedHTML !== null) {
      pane.innerHTML = _savedHTML;
      _savedHTML = null;
    }
    btn.classList.remove('lus-btn--active');
    btn.title = 'View source';
    _isRaw = false;
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    _isRaw ? _showOutput() : _showRaw();
  });

  return {
    element: btn,
    setSource(code, lang) {
      if (_isRaw) _showOutput();   // reset to output when new result arrives
      _code = code ?? null;
      _lang = lang ?? null;
      btn.style.display = _code ? '' : 'none';
    },
  };
}
