export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/reset-password')) {
      const indexUrl = new URL('/index.html', url.origin);
      return env.ASSETS.fetch(indexUrl);
    }
    return env.ASSETS.fetch(request);
  }
};
