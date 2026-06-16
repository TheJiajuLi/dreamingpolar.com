// ── Mobile hooks ──────────────────────────────────────────────────────────────
// Runs only in mobile contexts. Bridges mobile_controller events to other
// component state that wouldn't otherwise know about tab switches.

// ── Sync navigation-button open state on tab switch ─────────────────────────────────
// When the user switches to a non-content tab the nav inside the content screen
// is hidden by CSS (mob-visible toggled), but navigation_screen.js only tracks
// its own _isOpen flag via DOM events. We bridge the gap here.
//
// mob-close-nav fires after showPanel() has already toggled mob-visible, so
// checking content-screen.mob-visible tells us whether we switched TO content
// (leave nav alone) or AWAY from it (reset navigation-button open state).

document.addEventListener('mob-close-nav', () => {
  const contentScreen = document.getElementById('content-screen');
  // If content is now visible we switched TO it — nav state stays as-is.
  if (contentScreen?.classList.contains('mob-visible')) return;

  const menuBtn = document.getElementById('navigation-button');
  if (!menuBtn || menuBtn.getAttribute('aria-expanded') !== 'true') return;

  // Let navigation_screen.js's own handler do the cleanup (resets _isOpen,
  // removes .active, updates aria-expanded).
  document.dispatchEvent(new CustomEvent('content-nav-closed'));
});
