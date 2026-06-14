function setupHeroLoader() {
  document.getElementById('dp-veil')?.remove();

  const hero = document.querySelector('main.hero');
  if (!hero) return;

  const loader = document.createElement('div');
  loader.className = 'hero-loader';
  loader.innerHTML = `<img src="${window.BASE}/assets/home_page/imgs/dp_logo.png" alt="" class="hero-loader-splash" width="543" height="160" fetchpriority="high">`;
  hero.appendChild(loader);

  function dismiss() {
    loader.classList.add('hero-loader--out');
    loader.addEventListener('transitionend', () => loader.remove(), { once: true });
    setTimeout(() => loader.remove(), 500);
  }

  setTimeout(dismiss, 1200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupHeroLoader);
} else {
  setupHeroLoader();
}
