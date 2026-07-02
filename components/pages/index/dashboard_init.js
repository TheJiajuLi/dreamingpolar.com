import { initDashboard } from '/components/empty_state_dashboard/empty_state_dashboard.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard);
} else {
  initDashboard();
}