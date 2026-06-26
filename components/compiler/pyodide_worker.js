// ── Pyodide Web Worker (module) ───────────────────────────────────────────────
// type:'module' — required by VS Code Live Preview (classic workers blocked).
// Pyodide loaded via fetch + new Function() — no importScripts needed in module workers.
// Holds the single Pyodide instance + _dp_kernel_ns for the entire session.
// Messages: { id, type, payload }
// Replies:  { id, result } | { id, error }

const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/v314.0.0/full/';

let _pyodideLoaded = false;
async function _ensurePyodideScript() {
  if (_pyodideLoaded) return;
  const resp = await fetch(PYODIDE_INDEX + 'pyodide.js');
  if (!resp.ok) throw new Error(`Pyodide fetch failed: ${resp.status}`);
  const text = await resp.text();
  // Execute the UMD script in the Worker's global scope so globalThis.loadPyodide is set.
  // new Function runs in non-strict mode with the correct 'this' via .call(globalThis).
  // eslint-disable-next-line no-new-func
  (new Function(text)).call(globalThis);
  _pyodideLoaded = true;
}

let _py = null;

// ── RUNNER — copy-exact from compiler.js ─────────────────────────────────────
const RUNNER = `
import sys, io, base64, ast, traceback, json as _j
import warnings as _warnings
_warnings.filterwarnings('ignore', category=UserWarning)

try:
    import matplotlib as _mpl
    _mpl.use('agg')
    try:
        import logging as _log
        _log.getLogger('matplotlib').setLevel(_log.ERROR)
    except Exception: pass
    if not getattr(_mpl, '_dp_font_set', False):
        try:
            import os as _os, matplotlib.font_manager as _fm
            if _os.path.exists('/tmp/NotoSansSC.ttf'):
                _fm.fontManager.addfont('/tmp/NotoSansSC.ttf')
                _mpl.rcParams['font.family'] = 'Noto Sans SC'
        except Exception: pass
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

if '_dp_kernel_ns' not in dir():
    _dp_kernel_ns = {'__name__': '__main__'}
_ns = _dp_kernel_ns

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
        if _pre_snap.get(_vn) == (id(_vo), _sh): continue
        if _kind == 'DataFrame':
            _shape_str = f'{_sh[0]:,}\\u884c\\u00d7{_sh[1]}\\u5217' if len(_sh) > 1 else f'{_sh[0]:,}'
        elif _kind == 'Series':
            _shape_str = f'{_sh[0]:,}\\u5143\\u7d20'
        else:
            _shape_str = '\\u00d7'.join(str(d) for d in _sh)
        _vc = {'varName': _vn, 'kind': _kind.lower(), 'shape': _shape_str}
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
    pass

_j.dumps({'stdout': _out.getvalue(), 'stderr': _err.getvalue(), 'error': _exc, 'rich': _rich, 'viz_candidates': _viz_candidates})
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _writeToFS(filename, data, fileType) {
  if (!_py || !filename) return;
  const path = `/home/pyodide/${filename}`;
  try {
    const isExcel = fileType === 'xlsx' || fileType === 'xls';
    if (isExcel) {
      let bytes;
      if (typeof data === 'string') {
        const bin = atob(data);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      }
      _py.FS.writeFile(path, bytes);
    } else {
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      _py.FS.writeFile(path, text);
    }
  } catch (e) {
    console.warn(`[Worker writeToFS] "${filename}":`, e);
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function _handleInit(payload) {
  await _ensurePyodideScript();   // fetch + blob-URL importScripts, CSP-safe
  _py = await loadPyodide({ indexURL: PYODIDE_INDEX, messageCallback: () => {} });

  // CJK font (fetch works in Workers)
  try {
    const base = payload.base ?? '';
    const resp = await fetch(`${base}/assets/fonts/NotoSansSC-Regular.ttf`);
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      _py.FS.writeFile('/tmp/NotoSansSC.ttf', new Uint8Array(buf));
    }
  } catch (_) {}

  // Pre-write inject-store files so pd.read_csv('GE.csv') works immediately
  if (Array.isArray(payload.injectFiles)) {
    for (const e of payload.injectFiles) {
      try { _writeToFS(e.filename, e.data, e.fileType ?? 'csv'); } catch (_) {}
    }
  }

  // Restore saved code files so `import my_analysis` works after page refresh
  if (Array.isArray(payload.codeFiles)) {
    for (const e of payload.codeFiles) {
      try { _writeToFS(e.filename, e.code, 'text'); } catch (_) {}
    }
  }

  // Shared namespace — always present from session start
  _py.runPython('_dp_kernel_ns = {"__name__": "__main__"}');
  return 'ready';
}

async function _handleRun(payload) {
  const { code } = payload;
  await _py.loadPackagesFromImports(code, { messageCallback: () => {} });
  _py.globals.set('_user_code', code);
  const raw = await _py.runPythonAsync(RUNNER);
  return raw; // JSON string — parsed by main thread
}

async function _handleInject(payload) {
  const { varName, data, fileType, fileName } = payload;

  const pkgs = ['pandas'];
  if (fileType === 'xlsx' || fileType === 'xls') pkgs.push('openpyxl');
  if (fileType === 'xml') pkgs.push('lxml');
  await _py.loadPackage(pkgs, { messageCallback: () => {} });

  _py.runPython(`
if '_dp_kernel_ns' not in dir():
    _dp_kernel_ns = {'__name__': '__main__'}
`);

  if (fileName) _writeToFS(fileName, data, fileType);

  _py.globals.set('_dp_inject_data', data);
  _py.globals.set('_dp_inject_name', varName);

  let rows = 0;
  try {
    if (fileType === 'csv') {
      _py.runPython(`
import pandas as _pd_inj, io as _io_inj
_dp_kernel_ns[_dp_inject_name] = _pd_inj.read_csv(_io_inj.StringIO(_dp_inject_data))
del _pd_inj, _io_inj
`);
    } else if (fileType === 'json') {
      _py.runPython(`
import pandas as _pd_inj, io as _io_inj
_dp_kernel_ns[_dp_inject_name] = _pd_inj.read_json(_io_inj.StringIO(_dp_inject_data))
del _pd_inj, _io_inj
`);
    } else if (fileType === 'xlsx' || fileType === 'xls') {
      _py.runPython(`
import pandas as _pd_inj, io as _io_inj
_dp_kernel_ns[_dp_inject_name] = _pd_inj.read_excel(
    _io_inj.BytesIO(_dp_inject_data.to_py())
)
del _pd_inj, _io_inj
`);
    } else if (fileType === 'xml') {
      _py.runPython(`
import pandas as _pd_inj, io as _io_inj
_dp_kernel_ns[_dp_inject_name] = _pd_inj.read_xml(_io_inj.StringIO(_dp_inject_data))
del _pd_inj, _io_inj
`);
    } else {
      throw new Error(`Unsupported fileType: ${fileType}`);
    }
    rows = _py.runPython(`len(_dp_kernel_ns[_dp_inject_name])`);
  } finally {
    _py.globals.delete('_dp_inject_data');
    _py.globals.delete('_dp_inject_name');
  }
  return { rows };
}

function _handleQuery() {
  if (!_py) return [];
  try {
    const raw = _py.runPython(`
import json as _jkc
_ctx = []
for _kn, _kv in (_dp_kernel_ns if '_dp_kernel_ns' in dir() else {}).items():
    if _kn.startswith('_'): continue
    try:
        _kt = type(_kv).__name__
        if _kt == 'DataFrame':
            _ctx.append({
                'varName': _kn, 'kind': 'DataFrame', 'shape': list(_kv.shape),
                'columns': list(_kv.columns.astype(str)),
                'dtypes': {str(c): str(_kv[c].dtype) for c in _kv.columns},
            })
        elif _kt == 'Series':
            _ctx.append({
                'varName': _kn, 'kind': 'Series', 'shape': list(_kv.shape),
                'columns': [], 'dtypes': {'values': str(_kv.dtype)},
            })
    except Exception: pass
_jkc.dumps(_ctx)
`);
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function _handleReset() {
  if (!_py) return;
  _py.runPython('_dp_kernel_ns = {"__name__": "__main__"}');
  return 'reset';
}

function _handleWriteFS(payload) {
  const { filename, data, fileType = 'text' } = payload;
  _writeToFS(filename, data, fileType);
  return 'ok';
}

async function _handleVisualise(payload) {
  const { varName } = payload;
  if (!_py) throw new Error('Kernel not ready');

  await _py.loadPackage(['matplotlib'], { messageCallback: () => {} });

  _py.globals.set('_dp_viz_varname', varName);
  try {
    const raw = await _py.runPythonAsync(`
import matplotlib as _mpl_v
_mpl_v.use('agg')
try:
    import logging as _log_v
    _log_v.getLogger('matplotlib').setLevel(_log_v.ERROR)
except Exception: pass
if not getattr(_mpl_v, '_dp_font_set', False):
    try:
        import os as _os_v, matplotlib.font_manager as _fm_v
        if _os_v.path.exists('/tmp/NotoSansSC.ttf'):
            _fm_v.fontManager.addfont('/tmp/NotoSansSC.ttf')
            _mpl_v.rcParams['font.family'] = 'Noto Sans SC'
    except Exception: pass
    _mpl_v.rcParams['mathtext.fontset'] = 'cm'
    _mpl_v._dp_font_set = True

import matplotlib.pyplot as _plt_v, io as _io_v, base64 as _b64_v, json as _jv

_fig_v, _ax_v = _plt_v.subplots(figsize=(7, 3.8))
_ns_v = _dp_kernel_ns if '_dp_kernel_ns' in dir() else {}
_obj_v = _ns_v.get(_dp_viz_varname)
if _obj_v is None:
    raise ValueError(f"Variable '{_dp_viz_varname}' not found in kernel namespace")

_type_v = type(_obj_v).__name__
if _type_v == 'DataFrame':
    _num_v = _obj_v.select_dtypes(include='number')
    if not _num_v.empty:
        _num_v.iloc[:, :6].plot(ax=_ax_v, title=_dp_viz_varname)
    else:
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
    _py.globals.delete('_dp_viz_varname');
  }
}

// ── Message dispatcher ────────────────────────────────────────────────────────
self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    let result;
    switch (type) {
      case 'init':   result = await _handleInit(payload ?? {}); break;
      case 'run':    result = await _handleRun(payload);        break;
      case 'inject': result = await _handleInject(payload);     break;
      case 'query':  result = _handleQuery();                   break;
      case 'reset':   result = _handleReset();                   break;
      case 'writeFS':    result = _handleWriteFS(payload);              break;
      case 'visualise':  result = await _handleVisualise(payload);     break;
      default: throw new Error(`[Worker] Unknown message type: ${type}`);
    }
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: String(e) });
  }
};
