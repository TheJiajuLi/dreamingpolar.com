// ── Dataset Store — lightweight in-memory dataset registry ───────────────────
// No Pyodide, no Python. Stores parsed CSV/Excel as plain JS objects.
// Used by Quick Analysis (generative_screen) so charts and ARIA chat
// have data without waiting for the Python kernel.
//
// Quick Analysis import → setDataset() → 'dataset-updated' event
// Quick Analysis charts  → getDataset()
// Quick Analysis ARIA    → getDataset()
//
// Power Notebook import  → injectDataFrame() in compiler.js (separate path)

/** @type {{ name: string, columns: string[], dtypes: Object, rows: Object[] }|null} */
let _dataset = null;

/**
 * Store a new dataset and notify listeners.
 * @param {{ name, columns, dtypes, rows }} dataset
 */
export function setDataset(dataset) {
  _dataset = dataset ?? null;
  document.dispatchEvent(new CustomEvent('dataset-updated', {
    detail: _dataset,
  }));
}

/** Return the current dataset, or null if nothing has been imported yet. */
export function getDataset() {
  return _dataset;
}

/** Clear the stored dataset. */
export function clearDataset() {
  _dataset = null;
  document.dispatchEvent(new CustomEvent('dataset-updated', { detail: null }));
}
