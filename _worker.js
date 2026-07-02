export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/community') {
        return env.ASSETS.fetch(new Request(new URL('/community.html', url), request));
      }
      if (url.pathname.startsWith('/community/user/')) {
        return env.ASSETS.fetch(new Request(new URL('/profile.html', url), request));
      }
      if (url.pathname.startsWith('/community/')) {
        return env.ASSETS.fetch(new Request(new URL('/tutorial.html', url), request));
      }
      if (url.pathname === '/write') {
        return env.ASSETS.fetch(new Request(new URL('/write.html', url), request));
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(
        `Error: ${e.message}\nPathname: ${url.pathname}`,
        { status: 500, headers: { 'content-type': 'text/plain' } }
      );
    }
  },
};
