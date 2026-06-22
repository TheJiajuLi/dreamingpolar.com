export function createClearCellsBtn() {
  const btn = document.createElement('button');
  btn.className = 'sc-btn sc-btn--danger';
  btn.id        = 'cds-clear-cells-btn';
  btn.title     = 'Clear all cells';
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;
  btn.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('clear-active-code'))
  );
  return btn;
}
