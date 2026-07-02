// Handle ?token= reset-password link (fallback if auth_client loads late)
const _rt = new URLSearchParams(location.search).get('token');
if (_rt) {
  // auth_client.js sets window.authClient — wait for it via DOMContentLoaded
  // then call showResetPassword; guard in _buildResetPage prevents double render
  const _show = () => window.authClient?.showResetPassword(_rt);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _show);
  } else {
    _show();
  }
}