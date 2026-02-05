document.addEventListener('DOMContentLoaded', () => {
  const blockedUrlEl = document.getElementById('blockedUrl');
  const openDashboard = document.getElementById('openDashboard');
  const goToSubscriptions = document.getElementById('goToSubscriptions');
  const disableOnce = document.getElementById('disableOnce');

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

  // Go to subscriptions (allowed by default)
  goToSubscriptions.addEventListener('click', () => {
    window.location.href = 'https://www.youtube.com/feed/subscriptions';
  });

  // Disable protection temporarily
  disableOnce.addEventListener('click', async () => {
    if (confirm('This will disable protection for this session. Are you sure?')) {
      await chrome.runtime.sendMessage({ type: 'toggleEnabled', enabled: false });

      // Redirect to original URL
      if (blockedUrl) {
        window.location.href = blockedUrl;
      } else {
        window.location.href = 'https://www.youtube.com';
      }
    }
  });
});
