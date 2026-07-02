export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    const rewrite = (path) => {
      const newUrl = new URL(path, url.origin);
      return fetch(new Request(newUrl, request));
    };

    if (url.pathname === '/community') {
      return rewrite('/community.html');
    }
    if (url.pathname.startsWith('/community/')) {
      return rewrite('/profile.html');
    }
    if (url.pathname === '/write') {
      return rewrite('/write.html');
    }
    return fetch(request);
  },
};
