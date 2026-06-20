const bar = document.createElement('footer');
bar.id = 'bottom-data-bar';
bar.innerHTML = `
  <div class="bdb-slot bdb-ai-slot" id="bdb-ai-slot" hidden>
    Daily quota remains: <span id="bdb-ai-tokens">—</span> tokens
  </div>
  <div class="bdb-slot bdb-compiler-slot compiler-status-bar" id="bdb-compiler-slot">
    Idle — Python loads on first run.
  </div>
  <div class="bdb-slot bdb-df-slot" id="bdb-df-slot" hidden></div>
`;

function init() {
  const hero = document.querySelector('main.hero');
  hero?.appendChild(bar);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
