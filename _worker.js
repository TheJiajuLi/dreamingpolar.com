export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/community') {
      return Response.redirect(url.origin + '/community.html', 302);
    }
    if (url.pathname.startsWith('/community/user/')) {
      return Response.redirect(url.origin + '/profile.html', 302);
    }
    if (url.pathname.startsWith('/community/')) {
      return Response.redirect(url.origin + '/tutorial.html', 302);
    }
    if (url.pathname === '/write') {
      return Response.redirect(url.origin + '/write.html', 302);
    }
    return env.ASSETS.fetch(request);
  },
};
