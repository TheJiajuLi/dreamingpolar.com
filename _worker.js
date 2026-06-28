export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    const rewrite = async (target) => {
      const response = await env.ASSETS.fetch(new Request(new URL(target, url.origin)));
      const newResponse = new Response(response.body, response);
      newResponse.headers.set('Cache-Control', 'no-store');
      return newResponse;
    };

    if (path === '/' || path === '')         return rewrite('/landing.html');
    if (path === '/app')                     return rewrite('/index.html');
    if (path === '/changelog')               return rewrite('/changelog.html');
    if (path.startsWith('/reset-password'))  return rewrite('/index.html');
    if (path === '/favicon.ico')             return rewrite('/assets/app_logo/favicon.png');

    return env.ASSETS.fetch(request);
  }
};
