
const _AUTH = 'https://api.dreamingpolar.com';

// ── Modal open/close ───────────────────────────────────────────────────────────
function lpAuthOpen(tab) {
  const overlay = document.getElementById('lp-auth-overlay');
  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('open'));
  lpAuthTab(tab);
}
function lpAuthClose() {
  const overlay = document.getElementById('lp-auth-overlay');
  overlay.classList.remove('open');
  setTimeout(() => { overlay.style.display = 'none'; }, 180);
}
document.getElementById('lp-auth-close').addEventListener('click', lpAuthClose);
document.getElementById('lp-auth-overlay').addEventListener('mousedown', e => {
  if (e.target === document.getElementById('lp-auth-overlay')) lpAuthClose();
});

// ── Tab switching ──────────────────────────────────────────────────────────────
function lpAuthTab(tab) {
  ['login','register','forgot'].forEach(t => {
    document.getElementById('lp-panel-' + t).style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.lp-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  ['lp-login-err','lp-reg-err','lp-forgot-err'].forEach(id => {
    document.getElementById(id).textContent = '';
  });
  document.getElementById('lp-forgot-ok').style.display = 'none';
}
document.querySelectorAll('.lp-tab').forEach(btn => {
  btn.addEventListener('click', () => lpAuthTab(btn.dataset.tab));
});
document.getElementById('lp-to-forgot').addEventListener('click', e => {
  e.preventDefault(); lpAuthTab('forgot');
});
document.getElementById('lp-back-login').addEventListener('click', e => {
  e.preventDefault(); lpAuthTab('login');
});

// ── API helpers ────────────────────────────────────────────────────────────────
async function lpPost(path, body) {
  const r = await fetch(_AUTH + path, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || '请求失败');
  return data;
}

function lpGoApp(userData) {
  try { localStorage.setItem('dp-auth-user', JSON.stringify(userData)); } catch (_) {}
  window.location.replace('/index.html?from=landing');
}

// ── Login ──────────────────────────────────────────────────────────────────────
document.getElementById('lp-login-btn').addEventListener('click', async () => {
  const btn = document.getElementById('lp-login-btn');
  const err = document.getElementById('lp-login-err');
  const email = document.getElementById('lp-login-email').value.trim();
  const pw    = document.getElementById('lp-login-pw').value;
  err.textContent = '';
  if (!email || !pw) { err.textContent = '请填写邮箱和密码'; return; }
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    const data = await lpPost('/auth/login', { email, password: pw });
    lpGoApp(data.user ?? { email });
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = '登录';
  }
});

// ── Register ───────────────────────────────────────────────────────────────────
document.getElementById('lp-reg-btn').addEventListener('click', async () => {
  const btn = document.getElementById('lp-reg-btn');
  const err = document.getElementById('lp-reg-err');
  const name  = document.getElementById('lp-reg-name').value.trim();
  const email = document.getElementById('lp-reg-email').value.trim();
  const pw    = document.getElementById('lp-reg-pw').value;
  err.textContent = '';
  if (!name || !email || !pw) { err.textContent = '请填写所有字段'; return; }
  if (pw.length < 8) { err.textContent = '密码至少 8 位'; return; }
  btn.disabled = true; btn.textContent = '创建中…';
  try {
    await lpPost('/auth/register', { username: name, email, password: pw });
    // Auto login after register
    const data = await lpPost('/auth/login', { email, password: pw });
    lpGoApp(data.user ?? { email, username: name });
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = '创建账号';
  }
});

// ── Forgot password ────────────────────────────────────────────────────────────
document.getElementById('lp-forgot-btn').addEventListener('click', async () => {
  const btn = document.getElementById('lp-forgot-btn');
  const err = document.getElementById('lp-forgot-err');
  const email = document.getElementById('lp-forgot-email').value.trim();
  err.textContent = '';
  if (!email) { err.textContent = '请输入邮箱'; return; }
  btn.disabled = true; btn.textContent = '发送中…';
  try {
    await lpPost('/auth/forgot-password', { email });
    document.getElementById('lp-forgot-ok').style.display = '';
    btn.style.display = 'none';
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = '发送重置链接';
  }
});

// ── Enter key submits the active form ─────────────────────────────────────────
['lp-login-email','lp-login-pw'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('lp-login-btn').click(); }
  });
});
['lp-reg-name','lp-reg-email','lp-reg-pw'].forEach(id => {
  document.getElementById(id)?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('lp-reg-btn').click(); }
  });
});
document.getElementById('lp-forgot-email')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('lp-forgot-btn').click(); }
});

// ── Auto-redirect logged-in users ─────────────────────────────────────────────
(async () => {
  try {
    const cached = localStorage.getItem('dp-auth-user');
    if (cached) {
      const res = await fetch(_AUTH + '/auth/refresh',
        { method: 'POST', credentials: 'include' });
      if (res.ok) { window.location.replace('/index.html?from=landing'); return; }
      else { localStorage.removeItem('dp-auth-user'); }
    }
  } catch (_) {}
})();

// ── Auto-open modal when redirected from other pages ──────────────────────────
(function () {
  const tab = sessionStorage.getItem('lp-open-login');
  if (tab) {
    sessionStorage.removeItem('lp-open-login');
    // Wait for DOM + overlay to be ready
    requestAnimationFrame(() => lpAuthOpen(tab));
  }
})();

// Load releases.json and render
fetch('/content_pages/releases/releases.json')
  .then(r => r.json())
  .then(data => {
    const c = data.current;
    const v0 = data.changelog?.[0] ?? { items: [] };

    document.getElementById('ver').textContent = 'v' + c.app;
    document.getElementById('upd-ver').textContent = 'v' + c.app;
    document.getElementById('upd-date').textContent = c.released;
    document.getElementById('ft-ver').textContent = 'v' + c.app + ' · ' + c.released;

    const TAG = { new: ['t-new','新功能'], improve: ['t-improve','优化'], fix: ['t-fix','修复'] };
    document.getElementById('upd-list').innerHTML = v0.items.slice(0, 3).map(item => {
      const [cls, label] = TAG[item.type] ?? ['t-fix','修复'];
      return `<div class="item"><span class="itag ${cls}">${label}</span><span>${item.text}</span></div>`;
    }).join('');
  })
  .catch(() => {});
