// ── Compiler ─────────────────────────────────────────────
// Execution engine: Python (Pyodide), LaTeX, MathJax, Markdown.
// Dispatches 'compiler-status' events for UI status bars.

import {
  parseError,
  preflightWarnings,
} from '../screens/coding_screen/coding_screen_python/pyodide_error_handling.js';

const PYODIDE_VERSION = '314.0.0';
const PYODIDE_INDEX   = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// ── Status message helpers ────────────────────────────────────────────────────
// Centralised here so i18n migration only needs to touch this one map.
const LANG_LABEL = {
  python:   'Python',
  markdown: 'Markdown',
  latex:    'LaTeX',
  mathjax:  'MathJax',
};

function _cellSuffix(context) {
  return context?.cellIndex != null ? ` · Cell ${context.cellIndex}` : '';
}

let _pyodide     = null;
let _loading     = null;
let _suppressKbs = false; // true during silent background preload

// ── Execution queue ────────────────────────────────────────────────────────────
// Ensures cells run one-at-a-time; multiple rapid Run clicks are serialised,
// not interleaved. Shared by _runPython and injectDataFrame.
const _queue   = [];
let   _running = false;

function _enqueue(taskFn) {
  return new Promise((resolve, reject) => {
    _queue.push({ taskFn, resolve, reject });
    _drain();
  });
}

async function _drain() {
  if (_running || !_queue.length) return;
  _running = true;
  const { taskFn, resolve, reject } = _queue.shift();
  try   { resolve(await taskFn()); }
  catch (e) { reject(e); }
  finally   { _running = false; _drain(); }
}

// ── Web Worker proxy ──────────────────────────────────────────────────────────
// All Python execution goes through the Worker so the main thread stays free.
// The main-thread _pyodide is kept for unmigrated helpers (getDataSample, etc.)
// and will be removed in a later phase once those are also migrated.

const _worker  = new Worker(new URL('./pyodide_worker.js', import.meta.url), { type: 'module' });
const _pending = new Map();
let   _workerReady = null;

_worker.onmessage = ({ data: { id, result, error } }) => {
  const p = _pending.get(id);
  if (!p) return;
  _pending.delete(id);
  error ? p.reject(new Error(error)) : p.resolve(result);
};
_worker.onerror = e => console.error('[Pyodide Worker]', e.message ?? e);

function _call(type, payload = {}) {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    _worker.postMessage({ id, type, payload });
  });
}

function _initWorker() {
  if (_workerReady) return _workerReady;

  // Read inject-store from localStorage (not available in Worker) and pass to init
  let injectFiles = [];
  try {
    const s = JSON.parse(localStorage.getItem('dp-settings') ?? '{}');
    if (s.cacheKernelData !== false) {
      const store = JSON.parse(localStorage.getItem('dreaming-polar-inject-store') ?? '{}');
      injectFiles = Object.values(store).filter(e => e?.filename && e?.data != null);
    }
  } catch (_) {}

  _workerReady = _call('init', { base: window.BASE ?? '', injectFiles })
    .then(() => {
      _dispatch('ready', 'Notebook Editor', 100);
      document.body.classList.add('dp-ready');
      document.body.dispatchEvent(new Event('dp-ready-event'));
    })
    .catch(e => {
      _workerReady = null; // allow retry
      throw e;
    });

  return _workerReady;
}

// Pre-warm the Worker at module load so it's ready before the user clicks Run.
_initWorker().catch(() => {});

// ── Utilities ─────────────────────────────────────────────

function _dispatch(status, message, percent, extra = {}) {
  if (_suppressKbs && status === 'loading') return;
  document.dispatchEvent(new CustomEvent('compiler-status', {
    detail: { status, message, percent, ...extra }
  }));
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src    = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// ── Pyodide bootstrap ─────────────────────────────────────

// ── Pre-write all inject-store files into Pyodide FS at boot ─────────────────
// Called once inside _getPyodide()'s loading chain, after _pyodide is set.
// Each file is written to /home/pyodide/<filename> so user code can reference
// files by relative name without any prior Run (e.g. pd.read_csv("GE.csv")).
// Individual failures are skipped with a warning — one bad entry won't block others.
const _INJECT_KEY = 'dreaming-polar-inject-store';

async function _preWriteInjectStore(py) {
  // Respect the "内核数据预载" setting
  try {
    const s = JSON.parse(localStorage.getItem('dp-settings') ?? '{}');
    if (s.cacheKernelData === false) return;
  } catch (_) {}

  let store;
  try { store = JSON.parse(localStorage.getItem(_INJECT_KEY) ?? '{}'); }
  catch { return; }

  const entries = Object.values(store).filter(e => e?.filename && e?.data != null);
  if (!entries.length) return;

  if (entries.length > 3) {
    _dispatch('loading', `Writing ${entries.length} files to workspace…`, 85, {
      tip: 'Pre-loading files from your file centre into the Python runtime.',
    });
  }

  for (const entry of entries) {
    try {
      writeToFS(entry.filename, entry.data, entry.fileType ?? 'csv');
    } catch (err) {
      console.warn(`[inject-store] Failed to pre-write "${entry.filename}" to FS:`, err);
    }
  }
}

async function _getPyodide() {
  if (_pyodide) return _pyodide;
  if (_loading)  return _loading;

  _loading = (async () => {
    _dispatch('loading', 'Fetching Python runtime…', 5, { tip: 'Pyodide WASM runtime — loads once, cached by browser.' });
    await _loadScript(PYODIDE_INDEX + 'pyodide.js');

    _dispatch('loading', 'Starting interpreter…', 30, { tip: 'Initialising CPython 3.14 in WebAssembly.' });
    const py = await window.loadPyodide({ indexURL: PYODIDE_INDEX, messageCallback: () => {} });

    // Write CJK font into Pyodide FS so matplotlib can use it when it is first
    // imported (pure JS fetch + FS write, no Python execution at boot time).
    try {
      const fontResp = await fetch(`${window.BASE || ''}/assets/fonts/NotoSansSC-Regular.ttf`);
      if (fontResp.ok) {
        const buf = await fontResp.arrayBuffer();
        py.FS.writeFile('/tmp/NotoSansSC.ttf', new Uint8Array(buf));
      }
    } catch (_) {}

    // ── Pre-write inject-store files into Pyodide FS ─────────────────────────
    // Must complete inside this Promise chain so any await _getPyodide() caller
    // is guaranteed the files already exist in py.FS before running user code.
    _pyodide = py;  // set now so writeToFS() can use it
    await _preWriteInjectStore(py);

    _dispatch('ready', 'Notebook Editor', 100);
    document.body.classList.add('dp-ready');
    document.body.dispatchEvent(new Event('dp-ready-event'));
    return py;
  })();

  return _loading;
}

// ── Python runner ─────────────────────────────────────────
// The user's code is passed via pyodide.globals so no quoting issues.

const RUNNER = `
import sys, io, base64, ast, traceback, json as _j
import warnings as _warnings
_warnings.filterwarnings('ignore', category=UserWarning)

# matplotlib is loaded on-demand by loadPackagesFromImports when user code
# imports it. The RUNNER handles its absence gracefully.
try:
    import matplotlib as _mpl
    _mpl.use('agg')
    # Silence ALL matplotlib log messages below ERROR — covers font-substitution
    # warnings that go through logging rather than the warnings module.
    try:
        import logging as _log
        _log.getLogger('matplotlib').setLevel(_log.ERROR)
    except Exception: pass
    # CJK font — set up once per kernel session; font file written to FS at boot.
    if not getattr(_mpl, '_dp_font_set', False):
        try:
            import os as _os, matplotlib.font_manager as _fm
            if _os.path.exists('/tmp/NotoSansSC.ttf'):
                _fm.fontManager.addfont('/tmp/NotoSansSC.ttf')
                _mpl.rcParams['font.family'] = 'Noto Sans SC'
        except Exception: pass
        # Use Computer Modern (LaTeX-standard, always bundled with matplotlib)
        # for math rendering so NotoSansSC's missing math glyphs don't warn.
        _mpl.rcParams['mathtext.fontset'] = 'cm'
        _mpl._dp_font_set = True
    import matplotlib.pyplot as _plt
    _plt.show = lambda *a, **kw: None
    _HAS_MPL = True
except ImportError:
    _plt = None
    _HAS_MPL = False

_out = io.StringIO()
_err = io.StringIO()
_orig_out, _orig_err = sys.stdout, sys.stderr
sys.stdout = _out
sys.stderr = _err

_rich = []
_exc  = None

# ── Shared kernel namespace (Jupyter-like) ─────────────────────────────────
# First call initialises _dp_kernel_ns in Pyodide's global scope;
# subsequent calls reuse it so Cell 1 imports are visible in Cell 2.
if '_dp_kernel_ns' not in dir():
    _dp_kernel_ns = {'__name__': '__main__'}
_ns = _dp_kernel_ns

# Snapshot shapes AND object identity BEFORE exec.
# Skip viz-suggestion only when the object is literally unchanged (same identity + shape).
# Re-running df = pd.read_csv(...) reassigns df → new id → card reappears correctly.
_pre_snap = {}
for _pn, _pv in list(_dp_kernel_ns.items()):
    if _pn.startswith('_'): continue
    try:
        if hasattr(_pv, 'shape'):
            _pre_snap[_pn] = (id(_pv), list(_pv.shape))
    except Exception: pass

try:
    exec(_user_code, _ns)

    if _HAS_MPL:
        for _n in _plt.get_fignums():
            _f = _plt.figure(_n)
            # Skip blank figures — any axis that has no plotted artists means
            # the template ran on data with no numeric columns, producing empty axes.
            _has_data = any(
                len(_ax.lines) + len(_ax.collections) + len(_ax.patches) > 0
                for _ax in _f.get_axes()
            )
            if not _has_data:
                _plt.close(_f)
                continue
            _b = io.BytesIO()
            _f.savefig(_b, format='png', bbox_inches='tight', dpi=150)
            _b.seek(0)
            _rich.append({'type': 'image', 'content': base64.b64encode(_b.read()).decode()})
        _plt.close('all')

    try:
        _tree = ast.parse(_user_code)
        if _tree.body and isinstance(_tree.body[-1], ast.Expr):
            _pos = _out.tell()
            _v = eval(compile(ast.Expression(_tree.body[-1].value), '<expr>', 'eval'), _ns)
            _out.seek(_pos); _out.truncate()
            if _v is not None:
                try:
                    from sympy import latex as _ltx, Basic as _SB
                    if isinstance(_v, _SB):
                        _rich.append({'type': 'latex', 'content': _ltx(_v)})
                    elif isinstance(_v, (list, tuple, set)) and _v and all(isinstance(i, _SB) for i in _v):
                        _rich.append({'type': 'latex', 'content': _ltx(list(_v))})
                    else:
                        _out.write(repr(_v))
                except ImportError:
                    _out.write(repr(_v))
    except Exception:
        pass

except Exception:
    _exc = traceback.format_exc()
finally:
    sys.stdout = _orig_out
    sys.stderr = _orig_err

# ── Post-execution: detect DataFrames created/modified by THIS exec ──────────
# Diff against _pre_snap (captured before exec), not a session-wide dict.
# Result: viz-suggestion appears whenever the current cell creates or changes
# a visualisable variable — re-running the same cell still shows the card.
_viz_candidates = []
try:
    for _vn, _vo in list(_dp_kernel_ns.items()):
        if _vn.startswith('_'): continue
        _kind = type(_vo).__name__
        if _kind not in ('DataFrame', 'Series', 'ndarray'): continue
        try:
            _sh = list(_vo.shape)
        except Exception:
            try: _sh = [int(len(_vo))]
            except Exception: continue
        if _pre_snap.get(_vn) == (id(_vo), _sh): continue  # same object, same shape — skip
        if _kind == 'DataFrame':
            _shape_str = f'{_sh[0]:,}\\u884c\\u00d7{_sh[1]}\\u5217' if len(_sh) > 1 else f'{_sh[0]:,}'
        elif _kind == 'Series':
            _shape_str = f'{_sh[0]:,}\\u5143\\u7d20'
        else:
            _shape_str = '\\u00d7'.join(str(d) for d in _sh)
        _vc = {'varName': _vn, 'kind': _kind.lower(), 'shape': _shape_str}
        # Detect likely wrong delimiter: 1-col DataFrame whose values contain ; or \t
        if _kind == 'DataFrame' and len(_sh) > 1 and _sh[1] == 1:
            try:
                _col0 = _vo.iloc[:, 0].dropna().astype(str).head(5)
                if len(_col0) > 0:
                    _semi  = _col0.str.contains(';').all()
                    _tab   = _col0.str.contains('\\t').all()
                    if _semi:   _vc['sepHint'] = ';'
                    elif _tab:  _vc['sepHint'] = '\\t'
            except Exception: pass
        _viz_candidates.append(_vc)

    # __dp_viz_hint__: ARIA preamble sets this to force viz-suggestion even
    # when the variable shape hasn't changed (pre-existing variable re-used).
    _hint = _dp_kernel_ns.pop('__dp_viz_hint__', None)
    if _hint and isinstance(_hint, str) and _hint in _dp_kernel_ns:
        _already = any(c['varName'] == _hint for c in _viz_candidates)
        if not _already:
            _hv = _dp_kernel_ns[_hint]
            _hk = type(_hv).__name__
            if _hk in ('DataFrame', 'Series'):
                try:
                    _hsh = list(_hv.shape)
                    _hshape = f'{_hsh[0]:,}\\u884c\\u00d7{_hsh[1]}\\u5217' if len(_hsh) > 1 else f'{_hsh[0]:,}'
                    _viz_candidates.append({'varName': _hint, 'kind': _hk.lower(), 'shape': _hshape})
                except Exception: pass
except Exception:
    pass   # detection errors must not surface to the user

_j.dumps({'stdout': _out.getvalue(), 'stderr': _err.getvalue(), 'error': _exc, 'rich': _rich, 'viz_candidates': _viz_candidates})
`;

async function _runPythonCore(code, context = {}) {
  try {
    const _t0 = Date.now();
    const _queued  = _queue.length;
    const _qSuffix = _queued > 0 ? ` · ${_queued} task${_queued > 1 ? 's' : ''} queued` : '';
    _dispatch('running', `Running Python${_cellSuffix(context)}${_qSuffix}`, undefined, {
      cellIndex: context.cellIndex,
      tip: 'Click to jump to cell output',
      action: 'scroll-to-cell',
    });

    // Pre-flight: warn about Pyodide-specific pitfalls before execution
    const preflight = preflightWarnings(code);

    // Run in Worker — main thread stays unblocked during Python execution
    await _initWorker();
    const raw = await _call('run', { code });
    const d   = JSON.parse(raw);
    const _ms = Date.now() - _t0;
    _dispatch('ready', 'Done', undefined, {
      cellIndex: context.cellIndex,
      elapsed: _ms,
      tip: `Cell ${context.cellIndex ?? '?'} · ${_ms < 1000 ? _ms + ' ms' : (_ms/1000).toFixed(1) + ' s'}`,
      action: 'scroll-to-cell',
    });

    const out = [];
    for (const w of preflight) out.push({ type: 'info', content: w });
    if (d.stdout)              out.push({ type: 'text',  content: d.stdout });
    for (const o of d.rich)    out.push(o);

    if (d.error) {
      const parsed = parseError(d.error, code);
      let body = parsed.message;
      if (parsed.suggestion) body += `\n\n💡 ${parsed.title}: ${parsed.suggestion}`;
      out.push({ type: 'error', content: body });
      // Signal missing-package to the UI layer so it can offer to install.
      // Only fires for import errors on packages not known to be permanently unavailable.
      if (parsed.id === 'import') {
        const pkg = d.error.match(/ModuleNotFoundError: No module named '([^']+)'/)?.[1]?.split('.')[0];
        if (pkg) out.push({ type: 'missing-package', pkg });
      }
    } else if (d.stderr) {
      out.push({ type: 'error', content: d.stderr });
    }

    if (!out.length) out.push({ type: 'info', content: 'Executed (no output).' });

    // Append viz-suggestion cards for new / changed visualisable objects.
    if (Array.isArray(d.viz_candidates)) {
      for (const vc of d.viz_candidates) {
        if (vc?.varName && vc?.kind) out.push({ type: 'viz-suggestion', ...vc });
      }
    }

    // Note: afterKernelMutation is intentionally NOT called here.
    // Firing kernel-mutation on every Python execution (including stats queries,
    // notebook cells, etc.) causes cascading re-renders and visible flicker.
    // kernel-mutation is only dispatched by injectDataFrame() when data actually
    // changes — UI components refresh on-demand after that.

    return out;
  } catch (e) {
    _dispatch('error', e.message, undefined, {
      tip: e.message?.slice(0, 120),
      action: 'scroll-to-cell',
      cellIndex: context?.cellIndex,
    });
    return [{ type: 'error', content: String(e) }];
  }
}

// Public entry-point: enqueues execution so rapid multi-cell clicks are serialised.
async function _runPython(code, context = {}) {
  return _enqueue(() => _runPythonCore(code, context));
}

// ── Other modes ───────────────────────────────────────────

function _runMarkdown(code) {
  if (window.marked) return [{ type: 'html', content: window.marked.parse(code) }];
  return [{ type: 'text', content: code }];
}

function _normalizeLatexMath(src) {
  return src
    .replace(/\$\$([\s\S]*?)\$\$/g, (_, m) => `\\[${m}\\]`)
    .replace(/\$([^$\n]+?)\$/g, (_, m) => `\\(${m}\\)`)
    .replace(/\\begin\{math\}([\s\S]*?)\\end\{math\}/g, (_, m) => `\\(${m}\\)`)
    .replace(/\\begin\{displaymath\}([\s\S]*?)\\end\{displaymath\}/g, (_, m) => `\\[${m}\\]`);
}

function _escHtmlInline(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _latexBodyToHtml(body) {
  const slots = [];
  const protect = tex => { const k = `\x00M${slots.length}\x00`; slots.push(tex); return k; };
  const restore = s => s.replace(/\x00M(\d+)\x00/g, (_, i) => slots[+i]);

  let s = body;

  // ── Protect all math spans first so they survive text transforms ──
  s = s.replace(/\\\[([\s\S]*?)\\\]/g, m => protect(m));
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_, c) => protect(`\\[${c}\\]`));
  for (const e of ['equation', 'equation\\*', 'align', 'align\\*', 'gather', 'gather\\*',
                   'multline', 'multline\\*', 'eqnarray', 'eqnarray\\*']) {
    s = s.replace(new RegExp(`\\\\begin\\{${e}\\}([\\s\\S]*?)\\\\end\\{${e}\\}`, 'g'), m => protect(m));
  }
  s = s.replace(/\\\(([\s\S]*?)\\\)/g, m => protect(m));
  s = s.replace(/\$([^$\n]+?)\$/g, (_, c) => protect(`\\(${c}\\)`));

  // ── Verbatim (before anything else touches braces/content) ──────
  s = s.replace(/\\verb([^a-zA-Z\s])(.*?)\1/g, (_, d, c) => `<code>${_escHtmlInline(c)}</code>`);
  s = s.replace(/\\begin\{verbatim\}([\s\S]*?)\\end\{verbatim\}/g,
    (_, c) => `<pre class="latex-verbatim"><code>${_escHtmlInline(c.trim())}</code></pre>`);

  // ── Named logos & special chars ─────────────────────────────────
  s = s.replace(/\\LaTeX(\{\})?/g, 'LaTeX');
  s = s.replace(/\\TeX(\{\})?/g, 'TeX');
  s = s.replace(/\\BibTeX(\{\})?/g, 'BibTeX');
  s = s.replace(/\\ldots(\{\})?|\\dots(\{\})?/g, '…');
  s = s.replace(/\\textbackslash(\{\})?/g, '\\');
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\&/g, '&amp;');
  s = s.replace(/\\\$/g, '$');
  s = s.replace(/\\#/g, '#');
  s = s.replace(/---/g, '—');
  s = s.replace(/--/g, '–');
  s = s.replace(/``/g, '“');
  s = s.replace(/''/g, '”');

  // ── Inline text formatting ───────────────────────────────────────
  const fmt = (cmd, open, close) => {
    s = s.replace(new RegExp(`\\\\${cmd}\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, 'g'), `${open}$1${close}`);
  };
  fmt('textbf', '<strong>', '</strong>');
  fmt('textit', '<em>', '</em>');
  fmt('emph',   '<em>', '</em>');
  fmt('texttt', '<code>', '</code>');
  fmt('underline', '<u>', '</u>');
  fmt('textrm', '', '');
  fmt('textsc', '', '');
  s = s.replace(/\\footnote\{([^}]+)\}/g, '<sup title="$1">[note]</sup>');
  s = s.replace(/\\href\{([^}]+)\}\{([^}]+)\}/g, '<a href="$1">$2</a>');
  s = s.replace(/\\url\{([^}]+)\}/g, (_, u) => `<a href="${u}">${u}</a>`);

  // ── Sectioning ──────────────────────────────────────────────────
  s = s.replace(/\\section\*?\{([^}]+)\}/g,       '<h2 class="latex-heading">$1</h2>');
  s = s.replace(/\\subsection\*?\{([^}]+)\}/g,    '<h3 class="latex-heading">$1</h3>');
  s = s.replace(/\\subsubsection\*?\{([^}]+)\}/g, '<h4 class="latex-heading">$1</h4>');
  s = s.replace(/\\title\{([^}]+)\}/g,  '<h1 class="latex-title">$1</h1>');
  s = s.replace(/\\maketitle\b/g,       '');
  s = s.replace(/\\author\{[^}]+\}/g,   '');
  s = s.replace(/\\date\{[^}]*\}/g,     '');

  // ── Environments ────────────────────────────────────────────────
  s = s.replace(/\\begin\{quote\}([\s\S]*?)\\end\{quote\}/g,
    (_, c) => `<blockquote class="latex-quote">${c.trim()}</blockquote>`);
  s = s.replace(/\\begin\{quotation\}([\s\S]*?)\\end\{quotation\}/g,
    (_, c) => `<blockquote class="latex-quote">${c.trim()}</blockquote>`);
  s = s.replace(/\\begin\{center\}([\s\S]*?)\\end\{center\}/g,
    (_, c) => `<div class="latex-center">${c.trim()}</div>`);
  s = s.replace(/\\begin\{flushleft\}([\s\S]*?)\\end\{flushleft\}/g,
    (_, c) => `<div style="text-align:left">${c.trim()}</div>`);
  s = s.replace(/\\begin\{flushright\}([\s\S]*?)\\end\{flushright\}/g,
    (_, c) => `<div style="text-align:right">${c.trim()}</div>`);
  s = s.replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g,
    (_, c) => `<div class="latex-abstract"><strong>Abstract.</strong> ${c.trim()}</div>`);

  // Lists
  const listItems = inner => inner.split('\\item').slice(1).map(t => {
    const m = t.match(/^\[([^\]]*)\]([\s\S]*)/);
    return m ? `<li><strong>${m[1]}</strong> ${m[2].trim()}</li>` : `<li>${t.trim()}</li>`;
  }).join('');
  s = s.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g,
    (_, c) => `<ul class="latex-list">${listItems(c)}</ul>`);
  s = s.replace(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/g,
    (_, c) => `<ol class="latex-list">${listItems(c)}</ol>`);
  s = s.replace(/\\begin\{description\}([\s\S]*?)\\end\{description\}/g, (_, c) => {
    const items = c.split('\\item').slice(1).map(t => {
      const m = t.match(/^\[([^\]]*)\]([\s\S]*)/);
      return m ? `<dt><strong>${m[1]}</strong></dt><dd>${m[2].trim()}</dd>` : `<dd>${t.trim()}</dd>`;
    }).join('');
    return `<dl class="latex-list">${items}</dl>`;
  });

  // Theorem-like environments
  for (const [env, title] of [['theorem','Theorem'],['lemma','Lemma'],['proof','Proof'],
      ['definition','Definition'],['corollary','Corollary'],['proposition','Proposition'],
      ['remark','Remark'],['example','Example']]) {
    s = s.replace(new RegExp(`\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`, 'g'),
      (_, c) => `<div class="latex-theorem latex-${env}"><strong>${title}.</strong> ${c.trim()}</div>`);
  }

  // Remaining unknown environments — keep content, drop wrapper tags
  s = s.replace(/\\begin\{[^}]+\}([\s\S]*?)\\end\{[^}]+\}/g, '$1');

  // ── Misc layout commands ─────────────────────────────────────────
  s = s.replace(/\\noindent\s*/g, '');
  s = s.replace(/\\centering\s*/g, '');
  s = s.replace(/\\par\b\s*/g, '\n\n');
  s = s.replace(/\\\\\s*(\[[^\]]*\])?/g, '<br>');
  s = s.replace(/\\(vspace|hspace|vskip|hskip)\*?\{[^}]*\}/g, '');
  s = s.replace(/\\(clearpage|newpage|pagebreak)\b/g, '<hr class="latex-pagebreak">');
  s = s.replace(/\\label\{[^}]*\}/g, '');
  s = s.replace(/\\ref\{([^}]*)\}/g, '[ref]');
  s = s.replace(/\\cite\{([^}]*)\}/g, (_, k) => `[${k}]`);

  // ── Strip remaining unknown commands (keep braced argument) ─────
  s = s.replace(/\\[a-zA-Z]+\{((?:[^{}]|\{[^{}]*\})*)\}/g, '$1');
  s = s.replace(/\\[a-zA-Z]+\*?\s*/g, '');
  s = s.replace(/[{}]/g, '');

  // ── Paragraph split ──────────────────────────────────────────────
  const paras = s.split(/\n\n+/).filter(p => p.trim());
  const html = paras.map(p => {
    const t = p.trim();
    if (/^<(h[1-6]|ul|ol|dl|blockquote|div|pre|hr|table)/.test(t)) return t;
    return `<p class="latex-para">${t.replace(/\n/g, ' ')}</p>`;
  }).join('\n');

  return restore(html);
}

function _runLatex(code) {
  const bodyMatch = code.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/);
  if (bodyMatch) {
    return [{ type: 'html', content: _latexBodyToHtml(bodyMatch[1].trim()) }];
  }
  // Bare math / snippet — normalize math notation and render directly
  const normalized = _normalizeLatexMath(code.trim());
  return [{ type: 'latex', content: /^(\\\[|\\\()/.test(normalized) ? normalized : `\\[${normalized}\\]` }];
}

function _runMathJax(code) {
  const trimmed = code.trim();
  // Raw HTML passthrough: if input is a full HTML document or starts with block-level tags
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    // Extract <body> content if present, otherwise use full code
    const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const content = bodyMatch ? bodyMatch[1].trim() : trimmed;
    return [{ type: 'html', content }];
  }
  // Any img/iframe → always treat as HTML passthrough (even a single tag)
  if (/<(img|iframe)\b/i.test(trimmed)) {
    return [{ type: 'html', content: `<div class="mathjax-html-block">${trimmed}</div>` }];
  }
  // General HTML fragment (≥2 block tags, no LaTeX math) — render as-is
  const tagCount = (trimmed.match(/<[a-z][^>]*>/gi) || []).length;
  if (tagCount >= 2 && !trimmed.includes('\\[') && !trimmed.includes('$$')) {
    return [{ type: 'html', content: `<div class="mathjax-html-block">${trimmed}</div>` }];
  }
  // Pure LaTeX / math — paragraph-wrap as before
  const normalized = _normalizeLatexMath(trimmed);
  const html = normalized
    .split(/\n\n+/)
    .filter(p => p.trim())
    .map(p => `<p class="latex-para">${p.trim().replace(/\n/g, ' ')}</p>`)
    .join('\n');
  return [{ type: 'html', content: html || `<p class="latex-para">${normalized}</p>` }];
}

// ── Kernel mutation hook ─────────────────────────────────────────────────────
// Dispatches 'kernel-mutation' so UI components (right_bar, generative_screen)
// can react without creating circular imports between compiler and UI modules.
// source: 'run'    — user code executed successfully
//         'inject' — a DataFrame was injected via injectDataFrame()
function afterKernelMutation(varName = 'df', source = 'run') {
  document.dispatchEvent(new CustomEvent('kernel-mutation', {
    detail: { varName, source },
  }));
}

// ── Public API ────────────────────────────────────────────

export async function compile(code, mode, context = {}) {
  switch (mode) {
    case 'python':   return _runPython(code, context);
    case 'markdown':
    case 'latex':
    case 'mathjax': {
      // Sync runners: dispatch running/done so status bar reflects the cell
      _dispatch('running', `Running ${LANG_LABEL[mode] ?? mode}${_cellSuffix(context)}`);
      const out = mode === 'markdown' ? _runMarkdown(code)
                : mode === 'latex'    ? _runLatex(code)
                :                       _runMathJax(code);
      _dispatch('ready', 'Done');
      return out;
    }
    default:         return [{ type: 'error', content: `Unknown mode: ${mode}` }];
  }
}

export function preloadPython() {
  // Worker is already started at module load; this is a no-op kept for API compat.
  // _suppressKbs still respected so KBS doesn't flash during background warm-up.
  _suppressKbs = true;
  _initWorker()
    .catch(() => {})
    .finally(() => { _suppressKbs = false; });
}

// ── Restart kernel — clears shared namespace in Worker ────────────────────────
export async function resetKernel() {
  if (_workerReady) {
    await _call('reset');
    _dispatch('ready', 'Kernel restarted — variables cleared');
  }
}

// ── Chart failure diagnosis ───────────────────────────────────────────────────
// Returns { issue, dateCols, numCols } for targeted fix suggestions.
// issue: 'not_found' | 'no_numeric' | 'date_as_text' | 'ok' | 'unknown'
export function diagnoseChart(varName) {
  if (!_pyodide) return { issue: 'not_found' };
  try {
    const raw = _pyodide.runPython(`
import json as _jd
_v = (_dp_kernel_ns if '_dp_kernel_ns' in dir() else {}).get('${varName}')
if _v is None:
    _jd.dumps({'issue': 'not_found', 'dateCols': [], 'numCols': []})
else:
    _num = list(_v.select_dtypes(include='number').columns)
    _date = [c for c in _v.columns if str(_v[c].dtype) == 'object'
             and any(k in str(c).lower() for k in ('date','time','dt','year','month'))]
    if _num:
        _jd.dumps({'issue': 'ok', 'dateCols': _date, 'numCols': _num})
    elif _date:
        _jd.dumps({'issue': 'date_as_text', 'dateCols': _date, 'numCols': []})
    else:
        _jd.dumps({'issue': 'no_numeric', 'dateCols': [], 'numCols': []})
`);
    return JSON.parse(raw);
  } catch (_) {
    return { issue: 'unknown', dateCols: [], numCols: [] };
  }
}

// ── Write file to Pyodide virtual FS ─────────────────────────────────────────
// Pyodide's default cwd is /home/pyodide — files here are accessible via
// relative paths in Python (pd.read_csv("GE.csv"), open("data.json"), etc.).
// Overwrites silently if file already exists (latest data wins).
export function writeToFS(filename, data, fileType) {
  if (!_pyodide || !filename) return;
  const path = `/home/pyodide/${filename}`;
  try {
    const isExcel = fileType === 'xlsx' || fileType === 'xls';
    if (isExcel) {
      let bytes;
      if (typeof data === 'string') {
        // base64-encoded binary (from inject-store isBase64 path)
        const bin = atob(data);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      }
      _pyodide.FS.writeFile(path, bytes);
    } else {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      _pyodide.FS.writeFile(path, text);
    }
  } catch (e) {
    console.warn(`[writeToFS] Failed to write "${filename}" to Pyodide FS:`, e);
  }
}

// ── Inject DataFrame — load file data into the shared kernel as a pandas variable ──
//
// fileType: 'csv' (default) | 'json' | 'xlsx' | 'xls'
//   csv / json → data is a text string
//   xlsx / xls → data is a Uint8Array (raw binary)
//
// Dispatches console.warn (not silent) on any load failure.
async function _injectDataFrameCore(varName, data, fileType, fileName, context) {
  const _displayName = fileName || varName;
  const _queued  = _queue.length;
  const _qSuffix = _queued > 0 ? ` · ${_queued} queued` : '';
  _dispatch('running', `Loading ${fileType.toUpperCase()} "${_displayName}"${_cellSuffix(context)}${_qSuffix}`);

  await _initWorker();
  const { rows } = await _call('inject', { varName, data, fileType, fileName: fileName ?? '' });

  _dispatch('ready', `"${varName}" ready — ${rows.toLocaleString()} rows${_cellSuffix(context)}`);
  afterKernelMutation(varName, 'inject');
  return { varName, rows };
}

export async function injectDataFrame(varName, data, fileType = 'csv', fileName = '', context = {}) {
  return _enqueue(() => _injectDataFrameCore(varName, data, fileType, fileName, context));
}

export async function getPyodide() {
  return _getPyodide();
}

// ── Visualise a kernel variable — generates a matplotlib PNG ─────────────────
// varName: the Python variable name (string, passed via globals, never eval'd)
// Returns a base64-encoded PNG string, or throws on failure.
export async function visualiseVar(varName) {
  const py = await _getPyodide();
  if (!py.runPython('"_dp_kernel_ns" in globals()')) throw new Error('Run the cell first to load data into the kernel');
  await py.loadPackage(['matplotlib'], { messageCallback: () => {} });

  py.globals.set('_dp_viz_varname', varName);
  try {
    const raw = await py.runPythonAsync(`
import matplotlib as _mpl_v
_mpl_v.use('agg')
if not getattr(_mpl_v, '_dp_font_set', False):
    try:
        import os as _os_v, matplotlib.font_manager as _fm_v
        if _os_v.path.exists('/tmp/NotoSansSC.ttf'):
            _fm_v.fontManager.addfont('/tmp/NotoSansSC.ttf')
            _mpl_v.rcParams['font.family'] = 'Noto Sans SC'
    except Exception: pass
    _mpl_v._dp_font_set = True

import matplotlib.pyplot as _plt_v, io as _io_v, base64 as _b64_v, json as _jv

_fig_v, _ax_v = _plt_v.subplots(figsize=(7, 3.8))
_obj_v = _dp_kernel_ns.get(_dp_viz_varname); _obj_v = _obj_v if _obj_v is not None else globals().get(_dp_viz_varname)
if _obj_v is None:
    raise ValueError(f"Variable '{_dp_viz_varname}' not found in kernel namespace")

_type_v = type(_obj_v).__name__
if _type_v == 'DataFrame':
    _num_v = _obj_v.select_dtypes(include='number')
    if not _num_v.empty:
        _num_v.iloc[:, :6].plot(ax=_ax_v, title=_dp_viz_varname)
    else:
        # Don't render a blank axes — raise so JS can show a friendly message instead
        _plt_v.close(_fig_v)
        raise ValueError('__NO_NUMERIC__')
elif _type_v == 'Series':
    _obj_v.plot(ax=_ax_v, title=_dp_viz_varname)
else:
    _flat_v = _obj_v.flatten()[:2000] if hasattr(_obj_v, 'flatten') else _obj_v
    _ax_v.plot(_flat_v)
    _ax_v.set_title(_dp_viz_varname)

_fig_v.tight_layout()
_buf_v = _io_v.BytesIO()
_fig_v.savefig(_buf_v, format='png', dpi=130, bbox_inches='tight')
_buf_v.seek(0)
_plt_v.close(_fig_v)
_jv.dumps({'img': _b64_v.b64encode(_buf_v.read()).decode()})
`);
    return JSON.parse(raw).img;
  } finally {
    py.globals.delete('_dp_viz_varname');
  }
}

// ── Query kernel for DataFrames ───────────────────────────────────────────────
// Returns { [varName]: { rows, cols } } for every DataFrame-like object in the
// shared kernel namespace. Lightweight: no data is copied, just shape lookups.
// Returns {} if Pyodide is not yet loaded (avoids triggering a boot).
export async function queryKernelDataframes() {
  if (!_pyodide) return {};
  try {
    const raw = _pyodide.runPython(`
import json as _jq
_dfs = {}
for _n, _v in (_dp_kernel_ns if '_dp_kernel_ns' in dir() else {}).items():
    if _n.startswith('_'): continue
    try:
        if hasattr(_v, 'shape') and hasattr(_v, 'columns'):
            _dfs[_n] = {'rows': int(_v.shape[0]), 'cols': int(_v.shape[1])}
    except Exception: pass
_jq.dumps(_dfs)
`);
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

// ── Kernel context for AI debug ──────────────────────────────────────────────
// Returns [{varName, shape, columns, dtypes}] for every DataFrame/Series in
// the kernel namespace.  Safe to call even before any cell has run (returns []).
export async function queryKernelContext() {
  if (!_workerReady) return [];
  try {
    return await _call('query');
  } catch (_) {
    return [];
  }
}

// ── DataFrame cleaning helpers ────────────────────────────────────────────────
//
// notifyKernelChanged(varName)
//   Fires 'kernel-mutation' so downstream UI (bottom bar, etc.) refreshes.
//
// previewClean(varName, op)
//   Runs a read-only Python check and returns info about the pending operation.
//   op: 'dropna' | 'drop_dup' | 'date_fmt'
//   Returns: { affected?, total?, candidates?, error? }
//
// applyClean(varName, op, extra?)
//   Applies the operation in-place on _dp_kernel_ns[varName], then calls
//   notifyKernelChanged. extra is used for 'date_fmt' to pass the column list.
//   Returns: { before?, after?, applied?, errors? }
//   On failure throws — caller must handle & display.

// Returns column schema: [{ col, dtype, nullPct, sample }]
export async function getDataFrameSchema(varName) {
  if (!_pyodide) throw new Error('Kernel not ready');
  if (!_pyodide.runPython('"_dp_kernel_ns" in globals()')) throw new Error('KERNEL_NOT_READY');
  _pyodide.globals.set('_dp_schema_var', varName);
  try {
    return JSON.parse(_pyodide.runPython(`
import json as _j
_df = _dp_kernel_ns.get(_dp_schema_var); _df = _df if _df is not None else globals().get(_dp_schema_var)
if _df is None: raise ValueError(f"Variable '{_dp_schema_var}' not found")
import pandas as _pd
_rows = []
for _col in _df.columns:
    _null_pct = round(float(_df[_col].isnull().mean() * 100), 1)
    _sample = str(_df[_col].dropna().iloc[0]) if len(_df[_col].dropna()) > 0 else ''
    _rows.append({'col': str(_col), 'dtype': str(_df[_col].dtype), 'nullPct': _null_pct, 'sample': _sample[:40]})
_j.dumps({'rows': _rows, 'shape': [int(_df.shape[0]), int(_df.shape[1])]})
`));
  } finally {
    _pyodide.globals.delete('_dp_schema_var');
  }
}

export function notifyKernelChanged(varName) {
  afterKernelMutation(varName, 'inject');
}

/** Return up to `n` rows of a DataFrame as a plain JS array-of-objects. */
export async function getDataSample(varName, n = 300) {
  if (!_pyodide) throw new Error('KERNEL_NOT_READY');
  if (!_pyodide.runPython('"_dp_kernel_ns" in globals()')) throw new Error('KERNEL_NOT_READY');
  _pyodide.globals.set('_dp_sample_var', varName);
  _pyodide.globals.set('_dp_sample_n',   n);
  try {
    return JSON.parse(_pyodide.runPython(`
import json as _j
_df = _dp_kernel_ns.get(_dp_sample_var); _df = _df if _df is not None else globals().get(_dp_sample_var)
if _df is None: raise ValueError(f"Variable '{_dp_sample_var}' not found")
_j.dumps(_df.head(int(_dp_sample_n)).to_dict(orient='records'))
`));
  } finally {
    _pyodide.globals.delete('_dp_sample_var');
    _pyodide.globals.delete('_dp_sample_n');
  }
}

export async function previewClean(varName, op) {
  if (!_pyodide) throw new Error('Kernel not ready — run a cell first');
  if (!_pyodide.runPython('"_dp_kernel_ns" in globals()')) throw new Error('KERNEL_NOT_READY');
  _pyodide.globals.set('_dp_clean_var', varName);
  try {
    if (op === 'dropna') {
      return JSON.parse(_pyodide.runPython(`
import json as _j
_df = _dp_kernel_ns.get(_dp_clean_var); _df = _df if _df is not None else globals().get(_dp_clean_var)
if _df is None: raise ValueError(f"Variable '{_dp_clean_var}' not found")
_j.dumps({'affected': int(len(_df) - len(_df.dropna(how='all'))), 'total': int(len(_df))})
`));
    }
    if (op === 'drop_dup') {
      return JSON.parse(_pyodide.runPython(`
import json as _j
_df = _dp_kernel_ns.get(_dp_clean_var); _df = _df if _df is not None else globals().get(_dp_clean_var)
if _df is None: raise ValueError(f"Variable '{_dp_clean_var}' not found")
_j.dumps({'affected': int(_df.duplicated().sum()), 'total': int(len(_df))})
`));
    }
    if (op === 'date_fmt') {
      return JSON.parse(_pyodide.runPython(`
import json as _j, pandas as _pd
_df = _dp_kernel_ns.get(_dp_clean_var); _df = _df if _df is not None else globals().get(_dp_clean_var)
if _df is None: raise ValueError(f"Variable '{_dp_clean_var}' not found")
_cands = []
for _col in _df.columns:
    if str(_df[_col].dtype).startswith('datetime64'):
        _cands.append({'col': _col, 'status': 'datetime'})
    elif _df[_col].dtype == object:
        _sample = _df[_col].dropna().head(20)
        if len(_sample) == 0: continue
        try:
            _pd.to_datetime(_sample, errors='raise')
            _cands.append({'col': _col, 'status': 'parseable'})
        except Exception: pass
_j.dumps({'candidates': _cands, 'total': int(len(_df))})
`));
    }
    throw new Error(`Unknown clean op: ${op}`);
  } finally {
    _pyodide.globals.delete('_dp_clean_var');
  }
}

export async function applyClean(varName, op, extra = null) {
  if (!_pyodide) throw new Error('Python runtime not loaded');
  _pyodide.globals.set('_dp_clean_var', varName);
  try {
    let result;
    if (op === 'dropna') {
      result = JSON.parse(_pyodide.runPython(`
import json as _j
_df = _dp_kernel_ns[_dp_clean_var]
_before = int(len(_df))
_dp_kernel_ns[_dp_clean_var] = _df.dropna(how='all')
_j.dumps({'before': _before, 'after': int(len(_dp_kernel_ns[_dp_clean_var]))})
`));
    } else if (op === 'drop_dup') {
      result = JSON.parse(_pyodide.runPython(`
import json as _j
_df = _dp_kernel_ns[_dp_clean_var]
_before = int(len(_df))
_dp_kernel_ns[_dp_clean_var] = _df.drop_duplicates()
_j.dumps({'before': _before, 'after': int(len(_dp_kernel_ns[_dp_clean_var]))})
`));
    } else if (op === 'date_fmt') {
      // extra: array of column names to process
      if (!Array.isArray(extra) || !extra.length) throw new Error('No date columns provided');
      _pyodide.globals.set('_dp_date_cols', extra);
      result = JSON.parse(_pyodide.runPython(`
import json as _j, pandas as _pd
_df = _dp_kernel_ns[_dp_clean_var].copy()
_applied = []
_errors = []
for _col in _dp_date_cols:
    try:
        if not str(_df[_col].dtype).startswith('datetime64'):
            _df[_col] = _pd.to_datetime(_df[_col], errors='raise')
        _df[_col] = _df[_col].dt.strftime('%Y-%m-%d')
        _applied.append(_col)
    except Exception as _e:
        _errors.append({'col': _col, 'err': str(_e)[:120]})
_dp_kernel_ns[_dp_clean_var] = _df
_j.dumps({'applied': _applied, 'errors': _errors})
`));
      _pyodide.globals.delete('_dp_date_cols');
    } else {
      throw new Error(`Unknown clean op: ${op}`);
    }
    afterKernelMutation(varName, 'inject');
    return result;
  } finally {
    _pyodide.globals.delete('_dp_clean_var');
  }
}

// ── Export DataFrame to various formats ──────────────────────────────────────
//
// format: 'csv' | 'json' | 'xml' | 'xlsx'
//   csv / json / xml → returns the file content as a UTF-8 string
//   xlsx             → returns the file content as a base64-encoded string
//                      (binary can't be passed through the JS↔Python boundary
//                       as a plain string; base64 is the safe transport)
//
// Throws on failure (caller must handle and display the error to the user).

export async function exportDataFrame(varName, format) {
  if (!_pyodide) throw new Error('Python runtime not loaded');
  if (!_pyodide.runPython('"_dp_kernel_ns" in globals()')) throw new Error('KERNEL_NOT_READY');

  // Load format-specific packages on demand — don't assume they were loaded
  // earlier (the user may export without ever having imported the same format).
  // py.loadPackage is idempotent for already-loaded packages.
  // Load pandas + micropip (needed to install xlsxwriter on demand)
  try {
    await _pyodide.loadPackage(['pandas', 'micropip'], { messageCallback: () => {} });
  } catch (e) {
    console.warn(`[exportDataFrame] failed to load packages:`, e);
    throw e;
  }

  _pyodide.globals.set('_dp_export_var',  varName);
  _pyodide.globals.set('_dp_export_fmt',  format);

  try {
    const raw = await _pyodide.runPythonAsync(`
import json as _j, io as _io, base64 as _b64, pandas as _pd, re as _re
_df = _dp_kernel_ns.get(_dp_export_var); _df = _df if _df is not None else globals().get(_dp_export_var)
if _df is None:
    raise ValueError(f"Variable '{_dp_export_var}' not found in kernel namespace")
if not isinstance(_df, _pd.DataFrame):
    raise TypeError(f"'{_dp_export_var}' is not a DataFrame (got {type(_df).__name__})")

_fmt = _dp_export_fmt
if _fmt == 'csv':
    _result = _j.dumps({'content': _df.to_csv(index=False), 'b64': False})
elif _fmt == 'json':
    _result = _j.dumps({'content': _df.to_json(orient='records', force_ascii=False), 'b64': False})
elif _fmt == 'xml':
    # XML tag names must start with a letter/underscore and contain only word chars.
    # Sanitize column names: replace invalid chars with '_', prefix digit-starts with 'col_'.
    def _safe_tag(s):
        s = _re.sub(r'[^\\w.-]', '_', str(s))
        if s and (s[0].isdigit() or s[0] == '-'):
            s = 'col_' + s
        return s or 'col'
    _xml_df = _df.copy()
    _xml_df.columns = [_safe_tag(c) for c in _xml_df.columns]
    import xml.etree.ElementTree as _ET
    _root = _ET.Element('data')
    for _, _row in _xml_df.iterrows():
        _rec = _ET.SubElement(_root, 'row')
        for _col, _val in _row.items():
            _el = _ET.SubElement(_rec, str(_col))
            _el.text = '' if _val is None else str(_val)
    _xml_str = _ET.tostring(_root, encoding='unicode', xml_declaration=False)
    _result = _j.dumps({'content': '<?xml version="1.0" encoding="utf-8"?>\\n' + _xml_str, 'b64': False})
elif _fmt == 'xlsx':
    _buf = _io.BytesIO()
    try:
        _df.to_excel(_buf, index=False, engine='xlsxwriter')
    except ModuleNotFoundError:
        import micropip as _mp  # already loaded via JS loadPackage above
        await _mp.install('xlsxwriter')
        _buf = _io.BytesIO()
        _df.to_excel(_buf, index=False, engine='xlsxwriter')
    _result = _j.dumps({'content': _b64.b64encode(_buf.getvalue()).decode(), 'b64': True})
else:
    raise ValueError(f"Unsupported export format: '{_fmt}'")
_result
`);
    return JSON.parse(raw);   // { content: string, b64: boolean }
  } catch (e) {
    console.warn(`[exportDataFrame] Failed to export "${varName}" as ${format}:`, e);
    throw e;
  } finally {
    _pyodide.globals.delete('_dp_export_var');
    _pyodide.globals.delete('_dp_export_fmt');
  }
}

// ── Install a missing Python package ─────────────────────────────────────────
// import name → Pyodide package name (when they differ)
const _IMPORT_TO_PKG = {
  sklearn:    'scikit-learn',
  PIL:        'Pillow',
  yaml:       'PyYAML',
  bs4:        'beautifulsoup4',
  dateutil:   'python-dateutil',
  Crypto:     'pycryptodome',
  attr:       'attrs',
  serial:     'pyserial',
};

/**
 * Attempts to install a missing package into the running Pyodide kernel.
 * Strategy:
 *   1. py.loadPackage()   — fast, works for Pyodide built-in packages
 *   2. micropip.install() — works for pure-Python PyPI packages
 *   3. honest failure     — C-extension packages not compiled for WASM return { success: false }
 *
 * @param {string} importName  The name as used in `import <name>`
 * @returns {{ success: boolean, error?: string }}
 */
export async function installPackage(importName) {
  const py = await _getPyodide();
  const pkgName = _IMPORT_TO_PKG[importName] ?? importName;

  _dispatch('running', `Loading ${importName}…`);

  // Strategy 1: Pyodide built-in package registry
  try {
    await py.loadPackage(pkgName, { messageCallback: () => {} });
    _dispatch('ready', `${importName} ready`);
    return { success: true };
  } catch (_) { /* fall through */ }

  // Strategy 2: micropip (pure-Python PyPI packages)
  try {
    await py.loadPackage('micropip', { messageCallback: () => {} });
    py.globals.set('_dp_install_pkg', importName);
    await py.runPythonAsync(`
import micropip as _mp
await _mp.install(_dp_install_pkg)
del _mp
`);
    py.globals.delete('_dp_install_pkg');
    _dispatch('ready', `${importName} ready`);
    return { success: true };
  } catch (e) {
    _dispatch('ready', 'Done');
    return {
      success: false,
      error:   `${importName} is not available in the browser — it likely requires native C extensions that can't run in WebAssembly.`,
    };
  }
}
