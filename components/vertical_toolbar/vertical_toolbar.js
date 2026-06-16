const MQ = window.matchMedia('(max-width: 768px)');

function placeMenuBtn() {
  const btn = document.getElementById('navigation-button');
  if (!btn) return;

  if (MQ.matches) {
    const header = document.querySelector('header.page-header');
    if (header && !header.contains(btn)) {
      header.insertBefore(btn, header.firstChild);
    }
  } else {
    const vtTop = document.querySelector('#vertical-toolbar .vt-top');
    if (vtTop && !vtTop.contains(btn)) {
      vtTop.insertBefore(btn, vtTop.firstChild);
    }
  }
}

MQ.addEventListener('change', placeMenuBtn);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', placeMenuBtn);
} else {
  placeMenuBtn();
}
