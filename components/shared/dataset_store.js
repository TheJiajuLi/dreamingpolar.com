// ── Dataset Store — lightweight in-memory dataset registry ───────────────────
// Maintains a list of all imported datasets + tracks the active one.
// Quick Analysis import → setDataset() → 'dataset-updated' event
// Switching active → setActiveDataset(name) → 'dataset-updated' event

/** @type {Array<{name,columns,dtypes,rows}>} */
let _datasets = [];
/** @type {number} index into _datasets */
let _activeIdx = -1;

// ── Computed ──────────────────────────────────────────────────────────────────
function _active() { return _activeIdx >= 0 ? _datasets[_activeIdx] : null; }

function _notify(source = 'import') {
  document.dispatchEvent(new CustomEvent('dataset-updated', {
    detail: { dataset: _active(), all: [..._datasets], activeIdx: _activeIdx, source },
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Add (or replace) a dataset and make it active. */
export function setDataset(dataset) {
  if (!dataset) return;
  const existing = _datasets.findIndex(d => d.name === dataset.name);
  if (existing >= 0) {
    _datasets[existing] = dataset;
    _activeIdx = existing;
  } else {
    _datasets.push(dataset);
    _activeIdx = _datasets.length - 1;
  }
  _notify('import');
}

/** Return the active dataset, or null. */
export function getDataset() { return _active(); }

/** Return all datasets. */
export function getAllDatasets() { return [..._datasets]; }

/** Switch the active dataset by name. */
export function setActiveDataset(name) {
  const idx = _datasets.findIndex(d => d.name === name);
  if (idx >= 0 && idx !== _activeIdx) {
    _activeIdx = idx;
    _notify('switch');
  }
}

/** Remove a single dataset by name. Active index is adjusted accordingly. */
export function removeDataset(name) {
  const idx = _datasets.findIndex(d => d.name === name);
  if (idx < 0) return;
  _datasets.splice(idx, 1);
  if (_activeIdx >= _datasets.length) _activeIdx = _datasets.length - 1;
  else if (_activeIdx === idx) _activeIdx = Math.max(0, idx - 1);
  _notify('remove');
}

/** Remove all datasets. */
export function clearDataset() {
  _datasets  = [];
  _activeIdx = -1;
  _notify('clear');
}
