// ── Content Router ─────────────────────────────────────────────────────────────
// Given a language tag, returns the single primary action for a code block.
// All screens (generative, terminal AI cards, future notebook cells) import
// from here so routing logic lives in exactly one place.

const PYTHON_LANGS  = new Set(['python', 'py', 'python3', '']);
const LATEX_LANGS   = new Set(['latex', 'tex', 'mathjax']);
const HTML_LANGS    = new Set(['html', 'htm']);
const MD_LANGS      = new Set(['markdown', 'md']);
// Server-side languages: cannot run in browser — show Copy + notice instead
const SERVER_LANGS  = new Set(['r', 'rscript', 'ruby', 'rust', 'go', 'java', 'c', 'cpp', 'c++', 'swift', 'kotlin']);

/**
 * Returns { label, handler, renderMode } for the primary action button.
 *
 * handler values:
 *   'runInKernel'      → compile(code, 'python') via notebook_kernel
 *   'renderPreview'    → renderBlocks(code, mode) for latex/html/md
 *   'insertFullBlock'  → paste rawContent into active editor, no execution
 *   'copyToClipboard'  → write to clipboard only
 *
 * renderMode is only set when handler === 'renderPreview'.
 */
export function getPrimaryAction(lang = '') {
  const l = lang.toLowerCase().trim();

  if (PYTHON_LANGS.has(l)) {
    return { label: '▶ Run',      handler: 'runInKernel',     renderMode: null };
  }
  if (LATEX_LANGS.has(l)) {
    return { label: '⟳ Render',   handler: 'renderPreview',   renderMode: 'mathjax' };
  }
  if (HTML_LANGS.has(l)) {
    return { label: '⟳ Preview',  handler: 'renderPreview',   renderMode: 'html' };
  }
  if (MD_LANGS.has(l)) {
    return { label: '⟳ Preview',  handler: 'renderPreview',   renderMode: 'markdown' };
  }
  if (SERVER_LANGS.has(l)) {
    // Cannot run in browser — copy only, with a notice shown by the code block UI
    return { label: '⎘ Copy',     handler: 'copyToClipboard', renderMode: null, serverOnly: true, serverHint: `${lang.toUpperCase()} · run in RStudio or server kernel` };
  }

  // Unknown / plain text → safe default: just insert
  return { label: '↓ Insert',    handler: 'insertFullBlock',  renderMode: null };
}

/** Returns the executor name for the Lang Router dashboard display. */
export function getExecutorLabel(lang = '') {
  const l = lang.toLowerCase().trim();
  if (PYTHON_LANGS.has(l))  return 'Pyodide';
  if (LATEX_LANGS.has(l))   return 'MathJax';
  if (HTML_LANGS.has(l))    return 'iframe sandbox';
  if (MD_LANGS.has(l))      return 'marked.js';
  if (SERVER_LANGS.has(l))  return 'Server (未接入)';
  return 'insert';
}

/**
 * Returns true if this language should be executed in the kernel (not just rendered).
 */
export function isExecutable(lang = '') {
  return PYTHON_LANGS.has(lang.toLowerCase().trim());
}

/**
 * Returns true if this language should be rendered inline (MathJax / HTML / Markdown).
 */
export function isRenderable(lang = '') {
  const l = lang.toLowerCase().trim();
  return LATEX_LANGS.has(l) || HTML_LANGS.has(l) || MD_LANGS.has(l);
}
