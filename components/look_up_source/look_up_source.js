const ICON_SOURCE = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
const ICON_COPY   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK  = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

export function createSourceWidget() {
  let _code    = null;
  let _lang    = null;
  let _rawView = null;
  let _isRaw   = false;

  // ── Toggle button ──────────────────────────────────────────
  const btn = document.createElement('button');
  btn.className   = 'lus-btn';
  btn.title       = 'View source';
  btn.innerHTML   = ICON_SOURCE;
  btn.style.display = 'none';

  // ── Helpers ────────────────────────────────────────────────
  function _getBody() {
    const section = btn.closest('.cds-output-section, .nb-output-section');
    return section?.querySelector('.cds-output-section-body, .nb-output-section-body') ?? null;
  }

  function _showRaw() {
    const body = _getBody();
    if (!body || !_code) return;

    _rawView = document.createElement('div');
    _rawView.className = 'lus-raw-view';

    const header = document.createElement('div');
    header.className = 'lus-raw-header';

    const langLabel = document.createElement('span');
    langLabel.className   = 'lus-lang-label';
    langLabel.textContent = (_lang ?? '').toUpperCase();

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

    header.append(langLabel, copyBtn);

    const pre = document.createElement('pre');
    pre.className = 'lus-code';
    const codeEl = document.createElement('code');
    codeEl.textContent = _code;
    pre.appendChild(codeEl);

    _rawView.append(header, pre);

    // Slide the output body out, raw view in
    body.style.display = 'none';
    body.after(_rawView);

    btn.classList.add('lus-btn--active');
    btn.title = 'Back to output';
    _isRaw = true;
  }

  function _showOutput() {
    const body = _getBody();
    _rawView?.remove();
    _rawView = null;
    if (body) body.style.display = '';
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
