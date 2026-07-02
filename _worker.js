export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/community') {
      url.pathname = '/community.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (url.pathname.startsWith('/community/user/')) {
      url.pathname = '/profile.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (url.pathname.startsWith('/community/')) {
      url.pathname = '/tutorial.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (url.pathname === '/write') {
      url.pathname = '/write.html';
      return env.ASSETS.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
};
