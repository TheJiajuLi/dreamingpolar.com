window.BASE = window.location.hostname === 'thejiajuli.github.io' ? '/dreamingpolar.com' : '';
// Sync: apply saved theme before first paint so the veil matches the user's palette.
// Runs during HTML parse — before any element is rendered.
try {
  var _t = localStorage.getItem('theme');
  if (_t) document.documentElement.setAttribute('data-theme', _t);
} catch (_) {}