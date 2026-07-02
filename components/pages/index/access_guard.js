(function() {
  var params = new URLSearchParams(location.search);
  var fromLanding = params.get('from') === 'landing';
  var hasUser = localStorage.getItem('dp-auth-user');
  var guestAccess = sessionStorage.getItem('dp-guest-access') === '1';

  // Allow entry: logged in, coming from landing (post-login), or clicked 免费试用
  if (!fromLanding && !hasUser && !guestAccess) {
    window.location.replace('/landing.html');
    return;
  }

  // Clean one-time flags
  if (fromLanding) history.replaceState({}, '', location.pathname);
  if (guestAccess) sessionStorage.removeItem('dp-guest-access');
})();