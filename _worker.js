export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const staticExts = ['.png','.ico','.svg','.jpg','.jpeg','.webp','.css','.js','.woff','.woff2'];
    if (staticExts.some(ext => url.pathname.endsWith(ext))) {
      return fetch(request);
    }
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
    if (url.pathname === '/tutorial') {
      return Response.redirect(url.origin + '/tutorial.html' + url.search, 302);
    }
    if (url.pathname === '/mobile') {
      return Response.redirect(url.origin + '/mobile.html', 302);
    }
    return fetch(request);
  },
};
