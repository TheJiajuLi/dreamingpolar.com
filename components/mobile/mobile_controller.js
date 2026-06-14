/* Mobile tab-bar controller
   Runs only on ≤768px screens.
   Opens all panels so their internal JS initialises,
   then uses CSS (mob-visible) to show one at a time. */

const TABS = [
  { id: 'content',   screenId: 'content-screen',   icon: '◈',  label: 'Content' },
  { id: 'coding',    screenId: 'coding-screen',     icon: '⌨',  label: 'Code'    },
  { id: 'compiling', screenId: 'compiling-screen',  icon: '⚡', label: 'Output'  },
  { id: 'ai-chat',   screenId: 'ai-chat-screen',    icon: '✦',  label: 'AI'      },
];

function isMobile() { return window.innerWidth <= 768; }

function init() {
  if (!isMobile()) return;

  let active = 0;

  /* ── Force all screens open so their JS initialises ── */
  requestAnimationFrame(() => requestAnimationFrame(() => {
    TABS.forEach(({ id }) => {
      const state = window.screenController?.getState(id);
      if (state === 'closed' || state === null) {
        window.screenController?.open(id);
      }
    });
    showPanel(0);

    /* ── Intercept header buttons: override desktop open/close with tab switch ── */
    // Capture phase on document fires before any listener on the buttons themselves
    document.addEventListener('click', _headerIntercept, true);
  }));

  /* ── Build tab bar ──────────────────────────────────── */
  const bar = document.createElement('div');
  bar.className = 'mob-tab-bar';

  const tabEls = TABS.map(({ id, icon, label }, i) => {
    let btn;
    btn = document.createElement('button');
    if (id === 'ai-chat') {
      btn.className = 'mob-tab';
      btn.id        = 'ai-header-btn';
      btn.setAttribute('aria-label', 'AI Chat');
      btn.innerHTML = `<span class="mob-tab-icon"><img src="/assets/buttons/ai.png" alt="" class="ai-header-icon"></span><span>AI Chat</span>`;
    } else {
      btn.className = 'mob-tab' + (i === 0 ? ' active' : '');
      btn.setAttribute('aria-label', label);
      btn.innerHTML = `<span class="mob-tab-icon">${icon}</span><span>${label}</span>`;
    }
    btn.addEventListener('click', () => switchTo(i));
    bar.appendChild(btn);
    return btn;
  });

  document.body.appendChild(bar);

  /* ── Panel switch ───────────────────────────────────── */
  function showPanel(idx) {
    TABS.forEach(({ screenId }, i) => {
      document.getElementById(screenId)?.classList.toggle('mob-visible', i === idx);
    });
    tabEls.forEach((el, i) => el.classList.toggle('active', i === idx));
  }

  function switchTo(idx) {
    if (idx === active) return;
    active = idx;
    // If the terminal is maximised, collapse it before switching screens
    const termPanel = document.getElementById('terminal-panel');
    if (termPanel?.classList.contains('terminal--max')) {
      termPanel.classList.remove('terminal--max');
      const maxBtn = termPanel.querySelector('.term-max-btn');
      if (maxBtn) maxBtn.textContent = '⤢';
    }
    showPanel(idx);
    document.dispatchEvent(new CustomEvent('mob-close-nav'));
  }

  /* ── Header button intercepts ───────────────────────── */
  /* All header nav btns are hidden on mobile via CSS — intercept is a no-op kept for safety */
  function _headerIntercept(e) { }

  /* ── Auto-switch to Output tab when code runs ──────── */
  document.addEventListener('compile-result', () => switchTo(2));

  /* ── Auto-switch to Content tab when a nav item is tapped ── */
  document.addEventListener('mob-switch-to-content', () => switchTo(0));

  /* ── Tear down if resized to desktop ────────────────── */
  window.matchMedia('(max-width: 768px)').addEventListener('change', e => {
    if (!e.matches) {
      document.removeEventListener('click', _headerIntercept, true);
      TABS.forEach(({ screenId }) =>
        document.getElementById(screenId)?.classList.remove('mob-visible')
      );
      bar.remove();
    }
  });
}

// ── iOS keyboard: keep tab bar above the virtual keyboard ─────
// When the iOS keyboard opens, `visualViewport.height` shrinks while
// `window.innerHeight` stays the same. The difference is the keyboard
// height. Writing it to --keyboard-h lets the tab bar float above it.
if (window.visualViewport) {
  const updateKeyboardH = () => {
    if (window.innerWidth > 768) return;
    const kh = Math.max(0, window.innerHeight - window.visualViewport.height);
    document.documentElement.style.setProperty('--keyboard-h', kh + 'px');
  };
  window.visualViewport.addEventListener('resize', updateKeyboardH);
  window.visualViewport.addEventListener('scroll', updateKeyboardH);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
