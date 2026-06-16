function getAiSlot()       { return document.getElementById('bdb-ai-slot'); }
function getCompilerSlot() { return document.getElementById('bdb-compiler-slot'); }

document.addEventListener('screen-opened', ({ detail: { id } }) => {
  if (id === 'ai-chat') getAiSlot()?.removeAttribute('hidden');
  if (id === 'coding')  getCompilerSlot()?.removeAttribute('hidden');
});

['screen-closed', 'screen-minimized'].forEach(evt => {
  document.addEventListener(evt, ({ detail: { id } }) => {
    if (id === 'ai-chat') getAiSlot()?.setAttribute('hidden', '');
    if (id === 'coding')  getCompilerSlot()?.setAttribute('hidden', '');
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
