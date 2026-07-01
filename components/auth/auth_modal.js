// ── Dreaming Polar — Shared Auth Modal ───────────────────────────────────────
// Injects the login/register/forgot-password modal into any page.
// Usage:  <script type="module" src="/components/auth/auth_modal.js"></script>
// API:    window.dpAuthModal.open('login' | 'register')

const _AUTH = 'https://api.dreamingpolar.com';

// ── Inject CSS ────────────────────────────────────────────────────────────────
const _css = `
#dp-auth-overlay{
  position:fixed;inset:0;background:rgba(15,23,42,.45);
  display:flex;align-items:center;justify-content:center;
  z-index:9000;backdrop-filter:blur(4px);
  opacity:0;transition:opacity .18s;pointer-events:none;
}
#dp-auth-overlay.open{opacity:1;pointer-events:auto}
#dp-auth-modal{
  background:#fff;border-radius:14px;padding:32px 28px 28px;
  width:100%;max-width:380px;position:relative;
  box-shadow:0 20px 60px rgba(15,23,42,.18),0 4px 16px rgba(15,23,42,.1);
  transform:translateY(8px);transition:transform .18s;
}
#dp-auth-overlay.open #dp-auth-modal{transform:translateY(0)}
.dp-auth-close{
  position:absolute;top:14px;right:14px;
  width:28px;height:28px;border:none;border-radius:50%;
  background:rgba(0,0,0,.06);color:#64748b;font-size:14px;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  transition:background .12s;
}
.dp-auth-close:hover{background:rgba(0,0,0,.1)}
.dp-auth-logo{display:flex;align-items:center;gap:8px;margin-bottom:22px}
.dp-auth-logo img{height:22px;width:auto}
.dp-auth-tabs{display:flex;gap:0;border-bottom:1px solid #e2e8f0;margin-bottom:22px}
.dp-tab{
  padding:8px 20px;border:none;background:none;font-size:.88rem;
  color:#64748b;cursor:pointer;font-family:inherit;
  border-bottom:2px solid transparent;margin-bottom:-1px;
  transition:color .12s,border-color .12s;
}
.dp-tab.active{color:#6366f1;border-bottom-color:#6366f1;font-weight:600}
.dp-auth-field{
  width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;
  font-size:.9rem;font-family:inherit;outline:none;box-sizing:border-box;
  transition:border-color .15s;margin-bottom:10px;
}
.dp-auth-field:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
.dp-auth-submit{
  width:100%;padding:11px;border:none;border-radius:8px;
  background:#6366f1;color:#fff;font-size:.93rem;font-weight:600;
  cursor:pointer;font-family:inherit;margin-top:4px;
  transition:opacity .15s;
}
.dp-auth-submit:hover{opacity:.86}
.dp-auth-submit:disabled{opacity:.5;cursor:not-allowed}
.dp-auth-err{font-size:.8rem;color:#ef4444;min-height:18px;margin-bottom:6px}
.dp-auth-note{font-size:.8rem;color:#64748b;text-align:center;margin-top:12px}
.dp-auth-note a{color:#6366f1;cursor:pointer}
.dp-auth-note a:hover{text-decoration:underline}
.dp-auth-success{
  font-size:.86rem;color:#16a34a;background:rgba(22,163,74,.08);
  border:1px solid rgba(22,163,74,.2);border-radius:8px;
  padding:10px 14px;margin-top:10px;display:none;
}
`;
const _style = document.createElement('style');
_style.textContent = _css;
document.head.appendChild(_style);

// ── Inject HTML ───────────────────────────────────────────────────────────────
const _overlay = document.createElement('div');
_overlay.id = 'dp-auth-overlay';
_overlay.innerHTML = `
<div id="dp-auth-modal">
  <button class="dp-auth-close" id="dp-auth-close" aria-label="关闭">✕</button>
  <div class="dp-auth-logo">
    <img src="/assets/home_page/imgs/dp_logo.png" alt="Dreaming Polar">
  </div>
  <div class="dp-auth-tabs">
    <button class="dp-tab active" data-tab="login">登录</button>
    <button class="dp-tab" data-tab="register">注册</button>
  </div>

  <!-- 登录 -->
  <div id="dp-panel-login">
    <div class="dp-auth-err" id="dp-login-err"></div>
    <input class="dp-auth-field" id="dp-login-email" type="email" placeholder="邮箱" autocomplete="email">
    <input class="dp-auth-field" id="dp-login-pw" type="password" placeholder="密码" autocomplete="current-password">
    <button class="dp-auth-submit" id="dp-login-btn">登录</button>
    <div class="dp-auth-note"><a id="dp-to-forgot">忘记密码？</a></div>
  </div>

  <!-- 注册 -->
  <div id="dp-panel-register" style="display:none">
    <div class="dp-auth-err" id="dp-reg-err"></div>
    <input class="dp-auth-field" id="dp-reg-name" type="text" placeholder="昵称" autocomplete="username">
    <input class="dp-auth-field" id="dp-reg-email" type="email" placeholder="邮箱" autocomplete="email">
    <input class="dp-auth-field" id="dp-reg-pw" type="password" placeholder="密码（至少 8 位）" autocomplete="new-password">
    <button class="dp-auth-submit" id="dp-reg-btn">创建账号</button>
  </div>

  <!-- 忘记密码 -->
  <div id="dp-panel-forgot" style="display:none">
    <p style="font-size:.86rem;color:#64748b;margin-bottom:12px">输入注册邮箱，我们发送重置链接</p>
    <div class="dp-auth-err" id="dp-forgot-err"></div>
    <input class="dp-auth-field" id="dp-forgot-email" type="email" placeholder="邮箱">
    <button class="dp-auth-submit" id="dp-forgot-btn">发送重置链接</button>
    <div class="dp-auth-success" id="dp-forgot-ok">✓ 重置链接已发送，请查收邮件</div>
    <div class="dp-auth-note" style="margin-top:10px"><a id="dp-back-login">← 返回登录</a></div>
  </div>
</div>`;
document.body.appendChild(_overlay);

// ── Helpers ───────────────────────────────────────────────────────────────────
function _q(id) { return document.getElementById(id); }

async function _post(path, body) {
  const r = await fetch(_AUTH + path, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || '请求失败');
  return data;
}

// ── Nav update after login ────────────────────────────────────────────────────
function _updateNav(user) {
  const navBtns = document.querySelector('.nav-btns');
  if (!navBtns) return;
  const name = user?.username || user?.email || '我的账户';
  navBtns.innerHTML = `<span style="font-size:.86rem;color:var(--t,#102040);padding:7px 4px">👋 ${name}</span>`;
}

// ── On login success ──────────────────────────────────────────────────────────
function _onLoginSuccess(userData) {
  try { localStorage.setItem('dp-auth-user', JSON.stringify(userData)); } catch (_) {}
  _updateNav(userData);
  _close();
  document.dispatchEvent(new CustomEvent('dp-auth-login', { detail: { user: userData } }));
}

// ── Open / Close ──────────────────────────────────────────────────────────────
function _open(tab = 'login') {
  _overlay.style.display = 'flex';
  requestAnimationFrame(() => _overlay.classList.add('open'));
  _tab(tab);
}

function _close() {
  _overlay.classList.remove('open');
  setTimeout(() => { _overlay.style.display = 'none'; }, 180);
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function _tab(tab) {
  ['login', 'register', 'forgot'].forEach(t => {
    _q('dp-panel-' + t).style.display = t === tab ? '' : 'none';
  });
  _overlay.querySelectorAll('.dp-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  ['dp-login-err', 'dp-reg-err', 'dp-forgot-err'].forEach(id => {
    _q(id).textContent = '';
  });
  _q('dp-forgot-ok').style.display = 'none';
}

// ── Wire events ───────────────────────────────────────────────────────────────
_q('dp-auth-close').addEventListener('click', _close);
_overlay.addEventListener('mousedown', e => { if (e.target === _overlay) _close(); });

_overlay.querySelectorAll('.dp-tab').forEach(btn => {
  btn.addEventListener('click', () => _tab(btn.dataset.tab));
});
_q('dp-to-forgot').addEventListener('click', e => { e.preventDefault(); _tab('forgot'); });
_q('dp-back-login').addEventListener('click', e => { e.preventDefault(); _tab('login'); });

// Login
_q('dp-login-btn').addEventListener('click', async () => {
  const btn   = _q('dp-login-btn');
  const err   = _q('dp-login-err');
  const email = _q('dp-login-email').value.trim();
  const pw    = _q('dp-login-pw').value;
  err.textContent = '';
  if (!email || !pw) { err.textContent = '请填写邮箱和密码'; return; }
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    const data = await _post('/auth/login', { email, password: pw });
    _onLoginSuccess(data.user ?? { email });
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = '登录';
  }
});

// Register
_q('dp-reg-btn').addEventListener('click', async () => {
  const btn   = _q('dp-reg-btn');
  const err   = _q('dp-reg-err');
  const name  = _q('dp-reg-name').value.trim();
  const email = _q('dp-reg-email').value.trim();
  const pw    = _q('dp-reg-pw').value;
  err.textContent = '';
  if (!name || !email || !pw) { err.textContent = '请填写所有字段'; return; }
  if (pw.length < 8) { err.textContent = '密码至少 8 位'; return; }
  btn.disabled = true; btn.textContent = '创建中…';
  try {
    await _post('/auth/register', { username: name, email, password: pw });
    const data = await _post('/auth/login', { email, password: pw });
    _onLoginSuccess(data.user ?? { email, username: name });
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = '创建账号';
  }
});

// Forgot password
_q('dp-forgot-btn').addEventListener('click', async () => {
  const btn   = _q('dp-forgot-btn');
  const err   = _q('dp-forgot-err');
  const email = _q('dp-forgot-email').value.trim();
  err.textContent = '';
  if (!email) { err.textContent = '请输入邮箱'; return; }
  btn.disabled = true; btn.textContent = '发送中…';
  try {
    await _post('/auth/forgot-password', { email });
    _q('dp-forgot-ok').style.display = '';
    btn.style.display = 'none';
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = '发送重置链接';
  }
});

// Enter key submits active form
['dp-login-email', 'dp-login-pw'].forEach(id => {
  _q(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _q('dp-login-btn').click(); }
  });
});
['dp-reg-name', 'dp-reg-email', 'dp-reg-pw'].forEach(id => {
  _q(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); _q('dp-reg-btn').click(); }
  });
});
_q('dp-forgot-email').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); _q('dp-forgot-btn').click(); }
});

// ── Restore logged-in state on page load ──────────────────────────────────────
(async () => {
  try {
    const cached = localStorage.getItem('dp-auth-user');
    if (cached) {
      const res = await fetch(_AUTH + '/auth/refresh', { method: 'POST', credentials: 'include' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        _updateNav(JSON.parse(cached));
        if (data.accessToken) {
          // Store refreshed token if auth_client is loaded
          if (window.authClient?.silentRefresh) await window.authClient.silentRefresh().catch(() => {});
        }
        return;
      }
      localStorage.removeItem('dp-auth-user');
    }
  } catch (_) {}
})();

// ── Public API ────────────────────────────────────────────────────────────────
window.dpAuthModal = { open: _open, close: _close };
