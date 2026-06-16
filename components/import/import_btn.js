import { triggerImport as importPython   } from './import_python/import_python.js';
import { triggerImport as importMarkdown } from './import_markdown/import_markdown.js';
import { triggerImport as importLatex    } from './import_latex/import_latex.js';
import { triggerImport as importMathjax  } from './import_mathjax/import_mathjax.js';

const IMPORTERS = {
  python:   importPython,
  markdown: importMarkdown,
  latex:    importLatex,
  mathjax:  importMathjax,
};

// Arrow pointing down into a document — clearly "import into editor"
const SVG_IMPORT = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="12" y1="18" x2="12" y2="12"/>
  <polyline points="9 15 12 18 15 15"/>
</svg>`;

// ── Toast ─────────────────────────────────────────────────
function showToast(filename) {
  const existing = document.querySelector('.import-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'import-toast';
  toast.textContent = `Imported: ${filename}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('import-toast--out');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400);
  }, 2000);
}

// ── Factory ───────────────────────────────────────────────
// getMode()     → current compiler mode string ('python'|'latex'|'markdown'|'mathjax'|'customise')
// onImport(content, filename, lang) → single-view handler
// onNotebookImport(content, lang)   → notebook handler (customise mode)
export function createImportBtn({ getMode, onImport, onNotebookImport }) {
  const btn = document.createElement('button');
  btn.className = 'sc-btn import-btn';
  btn.title     = 'Import file';
  btn.innerHTML = SVG_IMPORT;

  btn.addEventListener('click', () => {
    const mode = getMode();

    if (mode === 'customise') {
      // Notebook mode: default to python importer, create new cell
      importPython((content, filename) => {
        onNotebookImport?.(content, 'python');
        showToast(filename);
      });
      return;
    }

    const importer = IMPORTERS[mode];
    if (!importer) return;
    importer((content, filename) => {
      onImport(content, filename, mode);
      showToast(filename);
    });
  });

  return btn;
}
