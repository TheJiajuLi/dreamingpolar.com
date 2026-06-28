export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    if (path === '/' || path === '') {
      return env.ASSETS.fetch(new URL('/landing.html', url.origin));
    }
    if (path === '/app') {
      return env.ASSETS.fetch(new URL('/index.html', url.origin));
    }
    if (path === '/changelog') {
      return env.ASSETS.fetch(new URL('/changelog.html', url.origin));
    }
    if (path.startsWith('/reset-password')) {
      return env.ASSETS.fetch(new URL('/index.html', url.origin));
    }
    return env.ASSETS.fetch(request);
  }
};
