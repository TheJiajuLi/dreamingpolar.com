// ── Pyodide Error Handling ────────────────────────────────────────────────────
//
//  Classifies, enriches, and pre-screens Python errors specific to the
//  Pyodide (browser) environment. Three exports are used by compiler.js:
//
//    parseError(raw, code)   → structured error object with a friendly hint
//    formatTraceback(raw)    → cleaned traceback (strips internal Pyodide frames)
//    preflightWarnings(code) → array of warnings before execution begins

// ── Packages known to be unavailable in Pyodide ───────────────────────────────

const UNAVAILABLE = new Map([
  ['tkinter',        'tkinter is GUI-only — no display in the browser. Use matplotlib for plots.'],
  ['pygame',         'pygame requires a display and cannot run in the browser.'],
  ['PyQt5',          'PyQt5 needs a desktop environment — not available in Pyodide.'],
  ['PyQt6',          'PyQt6 needs a desktop environment — not available in Pyodide.'],
  ['wx',             'wxPython needs a desktop environment — not available in Pyodide.'],
  ['requests',       'requests does not work in Pyodide. Use pyodide.http.open_url(url).read_text() for HTTP fetches.'],
  ['urllib3',        'urllib3 is not available. Use pyodide.http.open_url() instead.'],
  ['httpx',          'httpx is not available. Use pyodide.http.open_url() instead.'],
  ['aiohttp',        'aiohttp is not available in Pyodide.'],
  ['flask',          'Flask is a server framework — it cannot run inside a browser tab.'],
  ['django',         'Django is a server framework — it cannot run inside a browser tab.'],
  ['fastapi',        'FastAPI is a server framework — it cannot run inside a browser tab.'],
  ['cv2',            'OpenCV (cv2) is not bundled here. For image processing try Pillow (PIL).'],
  ['torch',          'PyTorch is too large for browser Pyodide. Use numpy/scipy for numerical work.'],
  ['tensorflow',     'TensorFlow is not available in Pyodide. Use numpy/scipy instead.'],
  ['keras',          'Keras/TensorFlow is not available in Pyodide.'],
  ['psycopg2',       'psycopg2 requires a database server — cannot run in the browser.'],
  ['pymysql',        'pymysql requires a database server — cannot run in the browser.'],
  ['multiprocessing','multiprocessing is not available in Pyodide (no OS process spawning in browsers).'],
  ['subprocess',     'subprocess cannot run in the browser — there is no OS to spawn processes.'],
  ['ctypes',         'ctypes is not available in the Pyodide/Emscripten environment.'],
  ['socket',         'Raw socket networking is restricted in browser environments.'],
]);

// ── Error pattern table ────────────────────────────────────────────────────────
//  Each entry: { id, match (regex on traceback), title, hint (string | fn(match) | null) }
//  hint: null → no 💡 suggestion appended; just the raw traceback (see compiler.js)

const PATTERNS = [
  // IndentationError / TabError 是真的跟缩进有关，缩进提示准确，保留。
  {
    id: 'indentation',
    match: /^(IndentationError|TabError):(.*)/m,
    title: 'Indentation Error',
    hint: 'Check indentation — Python requires consistent spaces/tabs (don\'t mix them).',
  },
  // 纯 SyntaxError 成因五花八门（用了 new/缺冒号/括号不匹配/中文标点…），
  // 一律套"检查缩进"会误导。这里不给提示（hint: null → 不追加 💡 那行），
  // 直接透传原始 traceback（已含 SyntaxError 行号和 ^ 箭头），让用户自己看
  // 真正的报错位置。
  {
    id: 'syntax',
    match: /^SyntaxError:(.*)/m,
    title: 'Syntax Error',
    hint: null,
  },
  {
    id: 'name',
    match: /^NameError: name '(\S+)' is not defined/m,
    title: 'Name Not Defined',
    hint: m => `'${m[1]}' was used before being assigned. Check for typos or a missing import/assignment above.`,
  },
  {
    id: 'type',
    match: /^TypeError:(.*)/m,
    title: 'Type Error',
    hint: 'An operation received the wrong type. Check that function arguments and operators are used on compatible types.',
  },
  {
    id: 'index',
    match: /^IndexError:(.*)/m,
    title: 'Index Out of Range',
    hint: 'Tried to access a list/array index that does not exist. Check loop ranges and list lengths.',
  },
  {
    id: 'key',
    match: /^KeyError:(.*)/m,
    title: 'Key Error',
    hint: 'A dict key was not found. Use `.get(key, default)` to avoid this, or check `.keys()` first.',
  },
  {
    id: 'attribute',
    match: /^AttributeError: '(\S+)' object has no attribute '(\S+)'/m,
    title: 'Attribute Error',
    hint: m => `'${m[1]}' objects have no attribute '${m[2]}'. Check spelling and the object's type.`,
  },
  {
    id: 'value',
    match: /^ValueError:(.*)/m,
    title: 'Value Error',
    hint: 'A value was the right type but not valid for this operation (e.g., wrong shape, empty sequence, bad conversion).',
  },
  {
    id: 'zero_div',
    match: /^ZeroDivisionError/m,
    title: 'Division by Zero',
    hint: 'Guard with `if denominator != 0:` before dividing, or use numpy\'s `np.divide(..., where=denominator!=0)`.',
  },
  {
    id: 'recursion',
    match: /^RecursionError/m,
    title: 'Recursion Limit Exceeded',
    hint: 'Pyodide\'s recursion limit is lower than desktop Python. Consider an iterative approach, or add `import sys; sys.setrecursionlimit(N)` at the top.',
  },
  {
    id: 'memory',
    match: /^MemoryError/m,
    title: 'Out of Memory',
    hint: 'The browser tab ran out of memory. Try smaller data sizes or a more memory-efficient algorithm (e.g., generators instead of lists).',
  },
  {
    id: 'overflow',
    match: /^OverflowError/m,
    title: 'Overflow Error',
    hint: 'A numeric result exceeded the representable range. Use Python\'s arbitrary-precision integers or clip values before the operation.',
  },
  {
    id: 'stop_iter',
    match: /^StopIteration/m,
    title: 'StopIteration',
    hint: 'An iterator ran out of values. Use a `for` loop instead of manual `next()`, or catch `StopIteration`.',
  },
  {
    id: 'runtime',
    match: /^RuntimeError:(.*)/m,
    title: 'Runtime Error',
    hint: 'A generic runtime error. Read the message for details — common causes are dictionary size changes during iteration or invalid states.',
  },
  {
    id: 'os_error',
    match: /^(OSError|FileNotFoundError|PermissionError):(.*)/m,
    title: 'File / OS Error',
    hint: 'Pyodide has a virtual filesystem at /tmp. Write files there with open(\'/tmp/file.txt\', \'w\'). No access to the real host filesystem.',
  },
  {
    id: 'convert',
    match: /ConversionError|Cannot convert|jsarray|JsException/i,
    title: 'Pyodide Conversion Error',
    hint: 'A Python object could not be converted to a JavaScript value. Call .tolist() on numpy arrays or .to_dict() on DataFrames before passing them across the boundary.',
  },
  {
    id: 'timeout',
    match: /timeout|timed out/i,
    title: 'Timeout',
    hint: 'The operation took too long. Pyodide runs on the browser\'s main thread — avoid infinite loops or extremely heavy computations.',
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Clean up Pyodide's verbose traceback — strips internal runtime frames
 * and relabels exec'd code paths so only the user-relevant lines remain.
 * @param {string} raw
 * @returns {string}
 */
export function formatTraceback(raw) {
  if (!raw) return '';
  return raw
    .split('\n')
    .filter(line =>
      !line.includes('/lib/python') &&
      !line.includes('/lib/python3') &&
      !line.includes('<pyodide>') &&
      !line.includes('_pyodide/') &&
      !line.includes('pyodide/') &&
      !line.includes('emscripten') &&
      !line.includes('runPythonAsync')
    )
    .map(line => line.replace('File "<exec>"', 'File "<your code>"'))
    .join('\n')
    .trim();
}

/**
 * Classify and enrich a raw Python traceback.
 * @param {string} raw   - d.error from the RUNNER
 * @param {string} [code] - user source (for context)
 * @returns {{ id: string, title: string, message: string, suggestion: string|null, raw: string }}
 */
export function parseError(raw, code = '') {
  if (!raw) return null;

  // ── Unavailable package (ModuleNotFoundError) ──────────────
  const modMatch = raw.match(/ModuleNotFoundError: No module named '([^']+)'/);
  if (modMatch) {
    const pkg  = modMatch[1].split('.')[0];
    const note = UNAVAILABLE.get(pkg);
    return {
      id:         'import',
      title:      `Module Not Found: ${pkg}`,
      message:    formatTraceback(raw),
      suggestion: note
        ?? `'${pkg}' is not in this Pyodide build. Supported packages: numpy, scipy, sympy, matplotlib, pandas, Pillow, networkx, and more — see pyodide.org/packages.`,
      raw,
    };
  }

  // ── Pattern matching ────────────────────────────────────────
  for (const p of PATTERNS) {
    const m = raw.match(p.match);
    if (m) {
      return {
        id:         p.id,
        title:      p.title,
        message:    formatTraceback(raw),
        suggestion: typeof p.hint === 'function' ? p.hint(m) : p.hint,
        raw,
      };
    }
  }

  // ── Generic fallback ────────────────────────────────────────
  const firstLine = raw.split('\n').find(l => l.trim() && !l.startsWith(' ')) ?? '';
  return {
    id:         'unknown',
    title:      firstLine || 'Runtime Error',
    message:    formatTraceback(raw),
    suggestion: null,
    raw,
  };
}

/**
 * Pre-flight check run BEFORE executing code.
 * Returns an array of user-visible warning strings for Pyodide-specific pitfalls.
 * Does not block execution — caller may show these alongside output.
 * @param {string} code
 * @returns {string[]}
 */
export function preflightWarnings(code) {
  const warnings = [];

  // Unavailable package imports
  const importRe = /^\s*(?:import|from)\s+([\w.]+)/gm;
  const seen = new Set();
  let m;
  while ((m = importRe.exec(code)) !== null) {
    const pkg = m[1].split('.')[0];
    if (!seen.has(pkg)) {
      seen.add(pkg);
      const note = UNAVAILABLE.get(pkg);
      if (note) warnings.push(`⚠ ${note}`);
    }
  }

  // Infinite loop without break
  if (/while\s+True\s*:/m.test(code) && !/\bbreak\b/.test(code)) {
    warnings.push('⚠ `while True:` detected without a `break` — this may freeze the browser tab.');
  }

  // Very large numpy allocation
  const allocRe = /np\.(?:zeros|ones|empty|full|random\.\w+)\(\s*\(?\s*(\d[\d_]*)/g;
  while ((m = allocRe.exec(code)) !== null) {
    const n = parseInt(m[1].replace(/_/g, ''));
    if (n > 50_000_000) {
      warnings.push(`⚠ Large array allocation (~${(n / 1e6).toFixed(0)}M elements) — may exhaust browser memory.`);
      break;
    }
  }

  // sys.exit() — does nothing useful in Pyodide
  if (/\bsys\.exit\s*\(/.test(code)) {
    warnings.push('⚠ `sys.exit()` raises SystemExit in Pyodide and will appear as an error. Remove it for browser execution.');
  }

  return warnings;
}
