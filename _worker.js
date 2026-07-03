export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/community') {
      return Response.redirect(url.origin + '/community.html', 302);
    }
    if (url.pathname.startsWith('/community/user/')) {
      const username = url.pathname.split('/community/user/')[1];
      return Response.redirect(url.origin + '/profile.html?username=' + username, 302);
    }
    if (url.pathname.startsWith('/community/')) {
      const id = url.pathname.split('/community/')[1];
      return Response.redirect(url.origin + '/tutorial.html?id=' + id, 302);
    }
    if (url.pathname === '/write') {
      return Response.redirect(url.origin + '/write.html', 302);
    }
    if (url.pathname === '/mobile') {
      return Response.redirect(url.origin + '/mobile.html', 302);
    }
    return env.ASSETS.fetch(request);
  },
};
