// ── Page Header ───────────────────────────────────────────────────────────────
//
//  Owns the <header class="page-header"> element.
//  Other components (fullscreen_toggle, font_switcher, pwa_install, etc.)
//  should import getPageHeader() instead of querying the DOM themselves.

let _header = null;

export function getPageHeader() {
  return _header ?? (_header = document.querySelector('header.page-header'));
}

function setupPageHeader() {
  _header = document.querySelector('header.page-header');
  // Remove legacy AI header button (created by an older script no longer in use)
  document.getElementById('ai-header-btn')?.remove();
  // Also observe for late-mounted instances
  const _obs = new MutationObserver(() => {
    const btn = document.getElementById('ai-header-btn');
    if (btn) { btn.remove(); }
  });
  if (_header) _obs.observe(_header, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPageHeader);
} else {
  setupPageHeader();
}
