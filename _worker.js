export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/community') {
        return env.ASSETS.fetch('https://assets.local/community.html');
      }
      if (url.pathname.startsWith('/community/user/')) {
        return env.ASSETS.fetch('https://assets.local/profile.html');
      }
      if (url.pathname.startsWith('/community/')) {
        return env.ASSETS.fetch('https://assets.local/tutorial.html');
      }
      if (url.pathname === '/write') {
        return env.ASSETS.fetch('https://assets.local/write.html');
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      return new Response(`Error: ${e.message}`, { status: 500 });
    }
  },
};
