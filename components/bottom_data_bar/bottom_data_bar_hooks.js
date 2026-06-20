import { getDataset } from '../shared/dataset_store.js';

function getAiSlot()       { return document.getElementById('bdb-ai-slot'); }
function getCompilerSlot() { return document.getElementById('bdb-compiler-slot'); }
function getDfSlot()       { return document.getElementById('bdb-df-slot'); }

document.addEventListener('screen-opened', ({ detail: { id } }) => {
  if (id === 'ai-chat')                    getAiSlot()?.removeAttribute('hidden');
  if (id === 'coding' || id === 'terminal') getCompilerSlot()?.removeAttribute('hidden');
});

['screen-closed', 'screen-minimized'].forEach(evt => {
  document.addEventListener(evt, ({ detail: { id } }) => {
    if (id === 'ai-chat')                    getAiSlot()?.setAttribute('hidden', '');
    if (id === 'coding' || id === 'terminal') getCompilerSlot()?.setAttribute('hidden', '');
  });
});

document.addEventListener('compiler-status', ({ detail }) => {
  const slot = getCompilerSlot();
  if (!slot) return;
  const spinning = detail.status === 'loading' || detail.status === 'running';
  slot.className = `bdb-slot bdb-compiler-slot compiler-status-bar ${detail.status}`;
  if (detail.percent != null) slot.style.setProperty('--pct', `${detail.percent}%`);
  const pctLabel = (detail.percent != null && detail.status === 'loading')
    ? `<span class="status-pct">${detail.percent}%</span>` : '';
  slot.innerHTML = spinning
    ? `<span class="status-spinner"><i></i><i></i><i></i></span>${detail.message}${pctLabel}`
    : detail.message;
});

// ── DataFrame stats slot — pure JS, zero Python ───────────────────────────────
// Updates on every dataset-updated event. Never touches kernel-mutation.
function _updateDfSlot() {
  const slot = getDfSlot();
  if (!slot) return;
  const ds = getDataset();
  if (!ds || !ds.rows.length) { slot.setAttribute('hidden', ''); return; }

  let nulls = 0;
  for (const row of ds.rows) {
    for (const col of ds.columns) {
      const v = row[col];
      if (v === null || v === undefined || v === '') nulls++;
    }
  }
  const memMB = (new TextEncoder().encode(JSON.stringify(ds.rows)).length / 1048576).toFixed(1);

  slot.removeAttribute('hidden');
  slot.textContent = `${ds.name}  ${ds.rows.length.toLocaleString()} rows · ${ds.columns.length} cols · ${nulls.toLocaleString()} nulls · ${memMB} MB`;
}

document.addEventListener('dataset-updated', _updateDfSlot);
