document.addEventListener('DOMContentLoaded', () => {
  const blockedUrlEl = document.getElementById('blockedUrl');
  const openDashboard = document.getElementById('openDashboard');

  // Get blocked URL from query params
  const params = new URLSearchParams(window.location.search);
  const blockedUrl = params.get('url');

  if (blockedUrl) {
    blockedUrlEl.textContent = blockedUrl;
  } else {
    blockedUrlEl.textContent = 'Unknown URL';
  }

  // Open dashboard
  openDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });
});
