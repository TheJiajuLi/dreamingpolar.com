export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    const serveFile = (filename) => {
      const newUrl = new URL(request.url);
      newUrl.pathname = filename;
      return fetch(new Request(newUrl.toString(), {
        method: request.method,
        headers: request.headers,
      }));
    };

    if (url.pathname === '/community') {
      return serveFile('/community.html');
    }
    if (url.pathname.startsWith('/community/user/')) {
      return serveFile('/profile.html');
    }
    if (url.pathname.startsWith('/community/')) {
      return serveFile('/tutorial.html');
    }
    if (url.pathname === '/write') {
      return serveFile('/write.html');
    }
    return fetch(request);
  },
};
