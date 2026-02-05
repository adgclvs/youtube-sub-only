// Content script - runs on every YouTube page
// Checks immediately if the current URL is allowed

(async function() {
  // Check if we're on the blocked page already
  if (window.location.href.includes('chrome-extension://')) {
    return;
  }

  // Get channel info from video page
  async function getVideoChannelInfo() {
    // Wait a bit for YouTube to load the data
    await new Promise(resolve => setTimeout(resolve, 500));

    // Try multiple methods to get channel info

    // Method 1: Check the channel link in video description area
    const channelLink = document.querySelector('ytd-video-owner-renderer a.yt-simple-endpoint[href*="/@"], ytd-video-owner-renderer a.yt-simple-endpoint[href*="/channel/"]');
    if (channelLink) {
      const href = channelLink.getAttribute('href');
      const handleMatch = href.match(/\/@([^\/]+)/);
      if (handleMatch) {
        return { type: 'handle', value: handleMatch[1] };
      }
      const channelMatch = href.match(/\/channel\/([^\/]+)/);
      if (channelMatch) {
        return { type: 'id', value: channelMatch[1] };
      }
    }

    // Method 2: Check ytInitialPlayerResponse (embedded in page)
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent;
      if (text && text.includes('ytInitialPlayerResponse')) {
        const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
        if (match) {
          try {
            const data = JSON.parse(match[1]);
            const channelId = data?.videoDetails?.channelId;
            if (channelId) {
              return { type: 'id', value: channelId };
            }
          } catch (e) {
            console.log('Failed to parse ytInitialPlayerResponse');
          }
        }
      }
    }

    // Method 3: Check meta tags
    const channelMeta = document.querySelector('meta[itemprop="channelId"]');
    if (channelMeta) {
      return { type: 'id', value: channelMeta.content };
    }

    return null;
  }

  // Check if current page is allowed
  async function checkCurrentPage() {
    const isActive = await chrome.runtime.sendMessage({ type: 'isBlockingActive' });
    if (!isActive) {
      console.log('YouTube Sub Only - Protection disabled');
      return;
    }

    const url = window.location.href;
    const pathname = new URL(url).pathname;

    // For video pages, we need to check the channel
    if (pathname === '/watch') {
      console.log('YouTube Sub Only - Video page detected, checking channel...');

      const channelInfo = await getVideoChannelInfo();
      console.log('YouTube Sub Only - Channel info:', channelInfo);

      if (channelInfo) {
        const isChannelAllowed = await chrome.runtime.sendMessage({
          type: 'isChannelAllowed',
          channelInfo: channelInfo
        });

        console.log('YouTube Sub Only - Channel allowed:', isChannelAllowed);

        if (!isChannelAllowed) {
          redirectToBlocked(url);
          return;
        }
      } else {
        // Could not determine channel, retry after a delay
        console.log('YouTube Sub Only - Could not determine channel, retrying...');
        setTimeout(checkCurrentPage, 1000);
        return;
      }
    } else {
      // For non-video pages, use the standard URL check
      const allowed = await chrome.runtime.sendMessage({
        type: 'isUrlAllowed',
        url: url
      });

      console.log('YouTube Sub Only - URL check:', url, 'Allowed:', allowed);

      if (allowed === false) {
        redirectToBlocked(url);
        return;
      }
    }
  }

  function redirectToBlocked(url) {
    const blockedUrl = chrome.runtime.getURL('blocked/blocked.html') +
      '?url=' + encodeURIComponent(url);
    window.location.replace(blockedUrl);
  }

  // Initial check
  await checkCurrentPage();

  // Watch for YouTube's SPA navigation
  let lastUrl = window.location.href;

  const checkNavigation = async () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      // Small delay to let YouTube update the page
      setTimeout(checkCurrentPage, 300);
    }
  };

  // Use yt-navigate-finish event (YouTube's custom event for SPA navigation)
  document.addEventListener('yt-navigate-finish', () => {
    console.log('YouTube Sub Only - yt-navigate-finish event');
    lastUrl = window.location.href;
    setTimeout(checkCurrentPage, 300);
  });

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
  window.addEventListener('popstate', () => {
    setTimeout(checkCurrentPage, 300);
  });
})();
