// ── ICM Ghost Text — AI code prediction overlay ───────────────────────────────
// Triggers 800ms after user stops typing (when ICM is ON and lang = python).
// Displays grey italic prediction text overlaid on the textarea.
// Tab accepts, any other key or Esc dismisses.

const _PROXY = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001/api/ghost'
  : 'https://api.dreamingpolar.com/api/ghost';

const _SYSTEM =
  '你是一个通用 Python IDE 的代码补全引擎，类似 GitHub Copilot。\n' +
  '用户可能在写任何类型的 Python 代码：\n' +
  '数据分析、机器学习、Web开发、算法、数学建模、系统脚本、爬虫等。\n\n' +
  '规则：\n' +
  '- 只输出紧接在光标后的代码，1-3行\n' +
  '- 不要解释，不要注释，不要代码块标记\n' +
  '- 代码风格与用户现有代码保持一致\n' +
  '- 预测要有实际意义，不要输出废话\n' +
  '- 直接输出纯代码，不加任何前缀或标点';

function _esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _stripFences(raw) {
  return raw.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```\s*$/, '').trim();
}

// ── Public: attach ghost text to one cell ─────────────────────────────────────
export function attachGhostText({ body, editor, cell, icmEnabled, icmOnChange }) {
  // ── Ghost layer (absolute overlay over textarea) ──────────────────────────
  const layer = document.createElement('div');
  layer.className = 'nb-ghost-layer';
  layer.setAttribute('aria-hidden', 'true');
  body.appendChild(layer);

  let _ghost     = '';    // current predicted text (without leading newline)
  let _timer     = null;
  let _abort     = null;
  let _inflight  = false;

  // ── Render layer ──────────────────────────────────────────────────────────
  function _render() {
    if (!_ghost) { layer.innerHTML = ''; return; }
    const code = editor.value;
    // Invisible text mirrors the textarea content so ghost text lands in the right position
    layer.innerHTML =
      `<pre class="nb-ghost-pre">${_esc(code)}<span class="nb-ghost-text">${_esc('\n' + _ghost)}</span></pre>`;
    layer.scrollTop = editor.scrollTop;
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  function _clear() {
    clearTimeout(_timer);
    _abort?.abort();
    _abort     = null;
    _inflight  = false;
    _ghost     = '';
    layer.innerHTML = '';
  }

  // ── Predict ───────────────────────────────────────────────────────────────
  async function _predict() {
    if (!icmEnabled() || cell.lang !== 'python') return;
    const code = editor.value;
    if (!code.trim()) return;

    // Don't predict on empty or whitespace-only cursor line
    const pos    = editor.selectionStart;
    const before = code.slice(0, pos);
    const curLine = before.split('\n').pop();
    if (!curLine.trim()) return;

    if (_inflight) return;
    _inflight = true;
    _abort    = new AbortController();

    const timeoutId = setTimeout(() => _abort.abort(), 5000);

    try {
      const lineNum = before.split('\n').length;
      const userMsg =
        `代码:\n\`\`\`python\n${code}\n\`\`\`\n光标在第 ${lineNum} 行，预测接下来的代码：`;

      const res = await fetch(_PROXY, {
        method:  'POST',
        signal:  _abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          messages:   [{ role: 'user', content: userMsg }],
          system:     _SYSTEM,
          max_tokens: 100,
        }),
      });

      clearTimeout(timeoutId);
      if (!res.ok || _abort.signal.aborted) return;

      const data = await res.json();
      const raw  = data.content ?? data.text ?? '';
      const text = _stripFences(raw);

      if (text && !_abort.signal.aborted) {
        _ghost = text;
        _render();
      }
    } catch (_) {
      // Silent failure — timeout, network error, or aborted
    } finally {
      _inflight = false;
      clearTimeout(timeoutId);
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────

  // input: reset debounce on every keystroke
  editor.addEventListener('input', () => {
    _clear();
    _timer = setTimeout(_predict, 500);
  });

  // keydown (capture phase — intercepts before ICM Tab handler)
  editor.addEventListener('keydown', e => {
    if (!_ghost) return;

    if (e.key === 'Tab') {
      // Accept ghost text
      e.preventDefault();
      e.stopImmediatePropagation();
      const pos    = editor.selectionStart;
      const before = editor.value.slice(0, pos);
      const after  = editor.value.slice(editor.selectionEnd);
      const insert = '\n' + _ghost;
      editor.value = before + insert + after;
      const newPos = pos + insert.length;
      editor.selectionStart = editor.selectionEnd = newPos;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      _clear();
    } else if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta' && e.key !== 'Alt') {
      // Any other key dismisses the ghost
      _clear();
    }
  }, { capture: true });

  // scroll sync
  editor.addEventListener('scroll', () => {
    if (_ghost) layer.scrollTop = editor.scrollTop;
  });

  // ICM toggled off → clear prediction
  icmOnChange(enabled => { if (!enabled) _clear(); });
}
