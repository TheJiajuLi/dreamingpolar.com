// ── ARIA Live Dashboard ────────────────────────────────────────────────────────
// Right-side real-time metrics panel for the ARIA screen.
// Animations: kernel numbers jitter every 1200ms, token chips randomise.

function _sparklineSVG() {
  const raw  = [0.45,0.52,0.48,0.61,0.55,0.72,0.68,0.79,0.85,0.82,0.88,0.92];
  const pts  = raw.map((v, i) => `${(i / (raw.length - 1)) * 196 + 2},${26 - v * 22}`).join(' ');
  const area = `2,26 ${pts} 198,26`;
  return `<svg width="200" height="28" viewBox="0 0 200 28" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${area}" fill="url(#sg)"/>
    <polyline points="${pts}" stroke="#6366f1" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
    <circle cx="198" cy="${26 - 0.92 * 22}" r="2.5" fill="#6366f1"/>
  </svg>`;
}

export function createDashboard() {
  const dash = document.createElement('aside');
  dash.className = 'gen-dashboard';

  dash.innerHTML = `
    <div class="dash-section">
      <div class="dash-title">KERNEL STATUS</div>
      <div class="dash-row"><span>Python</span><span class="dash-val dash-green">● Active</span></div>
      <div class="dash-row"><span>Memory</span><span class="dash-val" id="d-mem">142.3 MB</span></div>
      <div class="dash-row"><span>Variables</span><span class="dash-val" id="d-vars">12</span></div>
      <div class="dash-row"><span>Exec time</span><span class="dash-val" id="d-exec">48 ms</span></div>
    </div>

    <div class="dash-sep"></div>

    <div class="dash-section">
      <div class="dash-title">DATAFRAME · df</div>
      <div class="dash-row"><span>Rows</span><span class="dash-val dash-blue">2,847</span></div>
      <div class="dash-row"><span>Columns</span><span class="dash-val dash-blue">8</span></div>
      <div class="dash-row"><span>Nulls</span><span class="dash-val dash-green">0</span></div>
      <div class="dash-row"><span>Memory</span><span class="dash-val">1.7 MB</span></div>
      <div class="dash-bar-wrap"><div class="dash-bar" id="d-df-bar" style="width:34%;background:#6366f1"></div></div>
    </div>

    <div class="dash-sep"></div>

    <div class="dash-section">
      <div class="dash-title">REVENUE · LIVE</div>
      <div class="dash-sparkline">${_sparklineSVG()}</div>
      <div class="dash-row"><span>Total</span><span class="dash-val dash-green">$1.55M</span></div>
      <div class="dash-row"><span>vs last mo</span><span class="dash-val dash-green">+12.4%</span></div>
    </div>

    <div class="dash-sep"></div>

    <div class="dash-section">
      <div class="dash-title">AI CONTEXT</div>
      <div class="dash-row"><span>Tokens used</span><span class="dash-val dash-orange" id="d-tok">4,325</span></div>
      <div class="dash-bar-wrap"><div class="dash-bar" id="d-tok-bar" style="width:43%;background:#f97316"></div></div>
      <div class="dash-chips" id="d-chips"></div>
    </div>

    <div class="dash-sep"></div>

    <div class="dash-section">
      <div class="dash-title">MODEL</div>
      <div class="dash-row"><span>Engine</span><span class="dash-val dash-blue dash-mono">claude-sonnet</span></div>
      <div class="dash-row"><span>Latency</span><span class="dash-val dash-green" id="d-lat">316 ms</span></div>
      <div class="dash-row"><span>Mode</span><span class="dash-val dash-cyan">ICM</span></div>
    </div>

    <div class="dash-sep"></div>

    <div class="dash-section">
      <div class="dash-title">LANG ROUTER</div>
      <div class="dash-row"><span>Detected</span><span class="dash-val dash-blue" id="d-lang">Python</span></div>
      <div class="dash-row"><span>Confidence</span><span class="dash-val dash-green" id="d-conf">99%</span></div>
      <div class="dash-row"><span>Executor</span><span class="dash-val dash-cyan" id="d-exec2">Pyodide</span></div>
      <div class="dash-bar-wrap"><div class="dash-bar" id="d-lang-bar" style="width:99%;background:#818cf8"></div></div>
    </div>
  `;

  // ── Token chips ───────────────────────────────────────────
  const chipWords = ['df','revenue','product','top5','date','region','groupby','sum','sort','bar'];
  const chipsEl = dash.querySelector('#d-chips');
  const chipEls = chipWords.map(w => {
    const c = document.createElement('span');
    c.className   = 'dash-chip';
    c.textContent = w;
    chipsEl.appendChild(c);
    return c;
  });
  // Initial highlight
  [1, 3, 4, 8].forEach(i => chipEls[i]?.classList.add('dash-chip--on'));

  // ── Live animation ────────────────────────────────────────
  const $ = id => dash.querySelector(`#${id}`);
  let mem = 142.3, vars = 12, execMs = 48, tokens = 4325, lat = 316;

  const _ri = (base, d) => Math.round(base + (Math.random() - 0.5) * d * 2);
  const _rf = (base, d) => Math.max(0, base + (Math.random() - 0.5) * d * 2);

  const _tick = setInterval(() => {
    mem     = Math.max(60, _rf(mem, 4));
    vars    = Math.max(1, _ri(vars, 1));
    execMs  = Math.max(8, _ri(execMs, 10));
    tokens  = Math.max(100, _ri(tokens, 20));
    lat     = Math.max(40, _ri(lat, 25));

    const mEl = $('d-mem');   if (mEl)  mEl.textContent  = mem.toFixed(1) + ' MB';
    const vEl = $('d-vars');  if (vEl)  vEl.textContent  = vars;
    const eEl = $('d-exec');  if (eEl)  eEl.textContent  = execMs + ' ms';
    const tEl = $('d-tok');   if (tEl)  tEl.textContent  = tokens.toLocaleString();
    const lEl = $('d-lat');   if (lEl)  lEl.textContent  = lat + ' ms';
    const tb  = $('d-tok-bar');
    if (tb) tb.style.width = Math.min(100, (tokens / 10000) * 100) + '%';

    // Randomise 3-4 chip highlights
    const active = new Set();
    while (active.size < 3 + Math.floor(Math.random() * 2)) {
      active.add(Math.floor(Math.random() * chipEls.length));
    }
    chipEls.forEach((el, i) => el.classList.toggle('dash-chip--on', active.has(i)));
  }, 1200);

  dash._cleanup = () => clearInterval(_tick);
  return dash;
}

export function updateLangRouter({ lang = 'Python', confidence = 99, executor = 'Pyodide', color = '#818cf8' } = {}) {
  const get = id => document.getElementById(id);
  const lEl = get('d-lang');   if (lEl)  lEl.textContent = lang;
  const cEl = get('d-conf');   if (cEl)  cEl.textContent = confidence + '%';
  const eEl = get('d-exec2');  if (eEl)  eEl.textContent = executor;
  const bEl = get('d-lang-bar');
  if (bEl) { bEl.style.width = confidence + '%'; bEl.style.background = color; }
}
