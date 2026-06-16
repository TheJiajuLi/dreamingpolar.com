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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupPageHeader);
} else {
  setupPageHeader();
}
