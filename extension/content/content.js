// Content script - runs on every YouTube page
// Checks immediately if the current URL is allowed

(async function() {
  // Check if we're on the blocked page already
  if (window.location.href.includes('chrome-extension://')) {
    return;
  }

  // Ask background script if blocking is active
  const isActive = await chrome.runtime.sendMessage({ type: 'isBlockingActive' });
  if (!isActive) {
    return;
  }

  // Ask background script if this URL is allowed
  const allowed = await chrome.runtime.sendMessage({
    type: 'isUrlAllowed',
    url: window.location.href
  });

  console.log('YouTube Sub Only - URL check:', window.location.href, 'Allowed:', allowed);

  if (allowed === false) {
    // Redirect to blocked page
    const blockedUrl = chrome.runtime.getURL('blocked/blocked.html') +
      '?url=' + encodeURIComponent(window.location.href);
    window.location.replace(blockedUrl);
  }

  // Also watch for YouTube's SPA navigation (they use History API)
  let lastUrl = window.location.href;

  const checkNavigation = async () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;

      const stillActive = await chrome.runtime.sendMessage({ type: 'isBlockingActive' });
      if (!stillActive) return;

      const nowAllowed = await chrome.runtime.sendMessage({
        type: 'isUrlAllowed',
        url: window.location.href
      });

      console.log('YouTube Sub Only - SPA navigation:', window.location.href, 'Allowed:', nowAllowed);

      if (nowAllowed === false) {
        const blockedUrl = chrome.runtime.getURL('blocked/blocked.html') +
          '?url=' + encodeURIComponent(window.location.href);
        window.location.replace(blockedUrl);
      }
    }
  };

  // Use yt-navigate-finish event (YouTube's custom event for SPA navigation)
  document.addEventListener('yt-navigate-finish', checkNavigation);

  // Fallback: observe DOM changes once body is available
  const setupObserver = () => {
    if (document.body) {
      const observer = new MutationObserver(checkNavigation);
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      requestAnimationFrame(setupObserver);
    }
  };
  setupObserver();

  // Also listen for popstate (back/forward navigation)
  window.addEventListener('popstate', async () => {
    const stillActive = await chrome.runtime.sendMessage({ type: 'isBlockingActive' });
    if (!stillActive) return;

    const nowAllowed = await chrome.runtime.sendMessage({
      type: 'isUrlAllowed',
      url: window.location.href
    });

    if (nowAllowed === false) {
      const blockedUrl = chrome.runtime.getURL('blocked/blocked.html') +
        '?url=' + encodeURIComponent(window.location.href);
      window.location.replace(blockedUrl);
    }
  });
})();
