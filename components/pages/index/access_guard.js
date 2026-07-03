(function() {
  var params = new URLSearchParams(location.search);
  var fromLanding = params.get('from') === 'landing';
  var hasUser = window.dpAuthStore?.loadUserCache?.() || window.authClient?.getUser?.();
  var guestAccess = sessionStorage.getItem('dp-guest-access') === '1';

  // Allow entry: logged in, coming from landing (post-login), or clicked 免费试用
  if (fromLanding || guestAccess || hasUser) {
    if (fromLanding) history.replaceState({}, '', location.pathname);
    if (guestAccess) sessionStorage.removeItem('dp-guest-access');
    return;
  }

  fetch('https://api.dreamingpolar.com/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(function(res) {
      if (res.ok) return;
      window.location.replace('/landing.html');
    })
    .catch(function() {
      window.location.replace('/landing.html');
    });

})();