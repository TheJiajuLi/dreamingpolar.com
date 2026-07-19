export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ext = url.pathname.split('.').pop()?.toLowerCase();
    const staticExts = ['png','ico','svg','jpg','jpeg','webp','gif','css','js','woff','woff2','ttf','json','map'];
    if (staticExts.includes(ext)) {
      return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
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
      return Response.redirect(url.origin + '/write.html' + url.search, 302);
    }
    if (url.pathname === '/tutorial') {
      return Response.redirect(url.origin + '/tutorial.html' + url.search, 302);
    }
    const tutMatch = url.pathname.match(/^\/tutorial\/([^/]+)$/);
    if (tutMatch) {
      const id = tutMatch[1];
      try {
        const res = await fetch(
          'https://api.dreamingpolar.com/tutorial/' + id + '/preview',
          {
            headers: {
              'User-Agent': request.headers.get('User-Agent') || '',
              'Accept': 'text/html,*/*',
            },
          }
        );
        if (res.ok) return res;
      } catch (_) {}
    }
    if (url.pathname === '/mobile') {
      return Response.redirect(url.origin + '/mobile.html', 302);
    }
    if (url.pathname === '/privacy') {
      return Response.redirect(url.origin + '/privacy.html', 302);
    }
    if (url.pathname === '/terms') {
      return Response.redirect(url.origin + '/terms.html', 302);
    }
    if (url.pathname.startsWith('/notebook/embed/')) {
      const assetReq = new Request(url.origin + '/notebook_embed.html');
      return env.ASSETS ? env.ASSETS.fetch(assetReq) : fetch(assetReq);
    }
    return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
  },
};
