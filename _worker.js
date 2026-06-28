export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // /app → main app (index.html)
    if (path === '/app' || path.startsWith('/app/')) {
      return env.ASSETS.fetch(new URL('/index.html', url.origin));
    }

    // /changelog → changelog page
    if (path === '/changelog') {
      return env.ASSETS.fetch(new URL('/changelog.html', url.origin));
    }

    // /reset-password → app handles token via URL param
    if (path.startsWith('/reset-password')) {
      return env.ASSETS.fetch(new URL('/index.html', url.origin));
    }

    // / → landing page for unauthenticated visitors
    if (path === '/' || path === '') {
      return env.ASSETS.fetch(new URL('/landing.html', url.origin));
    }

    // All other paths (static assets, content_pages, etc.) → pass through
    return env.ASSETS.fetch(request);
  }
};
