export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/favicon.ico') {
      return env.ASSETS.fetch(
        new Request(new URL('/assets/app_logo/favicon.png', url.origin), request)
      );
    }
    if (path === '/app') {
      return env.ASSETS.fetch(
        new Request(new URL('/index.html', url.origin), request)
      );
    }
    if (path === '/changelog') {
      return env.ASSETS.fetch(
        new Request(new URL('/changelog.html', url.origin), request)
      );
    }
    if (path.startsWith('/reset-password')) {
      return env.ASSETS.fetch(
        new Request(new URL('/index.html', url.origin), request)
      );
    }
    if (path === '/' || path === '') {
      return env.ASSETS.fetch(
        new Request(new URL('/landing.html', url.origin), request)
      );
    }
    return env.ASSETS.fetch(request);
  }
};
