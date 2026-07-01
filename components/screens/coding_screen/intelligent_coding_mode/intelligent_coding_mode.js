const ICM_KEY  = 'dp-icm-enabled';
const _cbs     = new Set();
let   _enabled = localStorage.getItem(ICM_KEY) !== 'false'; // default: on

export function isEnabled()  { return _enabled; }

export function setEnabled(val) {
  if (_enabled === val) return;
  _enabled = !!val;
  try { localStorage.setItem(ICM_KEY, _enabled); } catch (_) {}
  _cbs.forEach(fn => fn(_enabled));
}

export function toggle() { setEnabled(!_enabled); }

export function onChange(fn) {
  _cbs.add(fn);
  return () => _cbs.delete(fn);
}

export function mount(container) {
  const wrap = document.createElement('div');
  wrap.className = 'icm-wrap';
  wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center';

  const btn = document.createElement('button');
  btn.id        = 'icm-btn';
  btn.className = `icm-btn${_enabled ? ' icm-on' : ''}`;
  btn.title     = '';   // suppressed — rich tooltip takes over
  btn.innerHTML = `
    <svg class="icm-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 6h16M4 10h12M4 14h8"/>
      <path d="M15 16l2 2 4-4" stroke-width="2"/>
    </svg>
    <span class="icm-label">ICM</span>
  `;

  // ── Rich feature tooltip ──────────────────────────────────────────────────
  const tip = document.createElement('div');
  tip.className = 'icm-tooltip';
  tip.innerHTML = `
    <div class="icm-tip-title">ICM 智能编码模式</div>
    <div class="icm-tip-divider"></div>
    <div class="icm-tip-row"><span class="icm-tip-check">✓</span><span>语法高亮</span><span class="icm-tip-badge">免费</span></div>
    <div class="icm-tip-row"><span class="icm-tip-check">✓</span><span>Tab 自动补全</span><span class="icm-tip-badge">免费</span></div>
    <div class="icm-tip-row"><span class="icm-tip-check">✓</span><span><kbd>Ctrl+I</kbd> 行内 AI 修改</span><span class="icm-tip-badge">免费</span></div>
    <div class="icm-tip-row"><span class="icm-tip-pro">⚡</span><span>Ghost Text 预测</span><a class="icm-tip-badge icm-tip-badge--pro" href="/pricing.html">Pro</a></div>
    <div class="icm-tip-row"><span class="icm-tip-pro">⚡</span><span>智能错误分析</span><a class="icm-tip-badge icm-tip-badge--pro" href="/pricing.html">Pro · 即将推出</a></div>
  `;
  wrap.appendChild(btn);
  wrap.appendChild(tip);

  btn.addEventListener('click', () => {
    toggle();
    btn.classList.toggle('icm-on', _enabled);
  });

  onChange(on => btn.classList.toggle('icm-on', on));

  container.appendChild(wrap);
  return btn;
}
