// YouTube Sub Only - Background Service Worker

const DEFAULT_SETTINGS = {
  enabled: true,
  channels: [],
  schedule: {
    enabled: false,
    // Rules format: { days: [0-6] (0=Sunday), startTime: "HH:MM", endTime: "HH:MM" }
    rules: []
  }
};

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('settings');
  if (!data.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

// Get current settings
async function getSettings() {
  const data = await chrome.storage.local.get('settings');
  return data.settings || DEFAULT_SETTINGS;
}

// Check if current time matches a schedule rule
function isTimeInRule(rule) {
  const now = new Date();
  const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Check if today is in the rule's days
  if (!rule.days.includes(currentDay)) {
    return false;
  }

  // Parse start and end times
  const [startHour, startMin] = rule.startTime.split(':').map(Number);
  const [endHour, endMin] = rule.endTime.split(':').map(Number);
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  // Check if current time is within the range
  if (endMinutes > startMinutes) {
    // Normal case: e.g., 09:00 - 17:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight case: e.g., 22:00 - 06:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

// Check if blocking is currently active (considering schedule)
async function isBlockingActive() {
  const settings = await getSettings();

  // Master switch is off
  if (!settings.enabled) {
    return false;
  }

  // If schedule is enabled, check if we're in an active time slot
  if (settings.schedule?.enabled && settings.schedule?.rules?.length > 0) {
    // Check if ANY rule matches current time
    const isInSchedule = settings.schedule.rules.some(rule => isTimeInRule(rule));
    return isInSchedule;
  }

  // No schedule or schedule disabled = always active (when master switch is on)
  return true;
}

// Extract channel handle or ID from YouTube URL
function extractChannelFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Handle formats:
    // /@username
    // /channel/UCxxxxxx
    // /c/channelname
    // /user/username

    const patterns = [
      /^\/@([^\/]+)/,           // /@username
      /^\/channel\/([^\/]+)/,   // /channel/UCxxxx
      /^\/c\/([^\/]+)/,         // /c/channelname
      /^\/user\/([^\/]+)/       // /user/username
    ];

    for (const pattern of patterns) {
      const match = pathname.match(pattern);
      if (match) {
        return { type: pattern.source.includes('channel') ? 'id' : 'handle', value: match[1] };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Check if URL is allowed
async function isUrlAllowed(url) {
  const settings = await getSettings();

  try {
    const urlObj = new URL(url);

    // Not YouTube - allow
    if (!urlObj.hostname.includes('youtube.com')) {
      return true;
    }

    const pathname = urlObj.pathname;

    // Always allow extension pages
    if (pathname.startsWith('/youtube-sub-only')) {
      return true;
    }

    // Allow specific YouTube pages that are not content
    const alwaysAllowPaths = [
      '/feed/subscriptions',  // Subscriptions page (only subscribed content)
      '/feed/library',        // Library
      '/feed/history',        // History
      '/playlist',            // Playlists
      '/account',             // Account settings
      '/premium',             // Premium
    ];

    for (const path of alwaysAllowPaths) {
      if (pathname.startsWith(path)) {
        return true;
      }
    }

    // Check if it's a channel page
    const channelInfo = extractChannelFromUrl(url);
    if (channelInfo) {
      return isChannelAllowed(channelInfo, settings.channels);
    }

    // Check if it's a video page - need to check the channel
    if (pathname === '/watch') {
      // We'll handle this via content script or let it through and check
      // For now, we need to fetch video info to determine channel
      // This will be handled by the content script
      return 'check_video';
    }

    // Block homepage, trending, shorts feed, search, etc.
    const blockedPaths = [
      '/',
      '/feed/trending',
      '/feed/explore',
      '/shorts',
      '/results',
      '/gaming',
      '/music',
    ];

    for (const path of blockedPaths) {
      if (pathname === path || (path !== '/' && pathname.startsWith(path))) {
        return false;
      }
    }

    // Default: block unknown paths
    return false;
  } catch {
    return true;
  }
}

// Check if a channel is in the allowed list
function isChannelAllowed(channelInfo, channels) {
  if (!channels || channels.length === 0) {
    return false;
  }

  const { type, value } = channelInfo;
  const valueLower = value.toLowerCase();

  return channels.some(channel => {
    if (type === 'handle') {
      return channel.handle?.toLowerCase() === valueLower ||
             channel.handle?.toLowerCase() === `@${valueLower}` ||
             channel.handle?.toLowerCase().replace('@', '') === valueLower;
    } else {
      return channel.id === value;
    }
  });
}

// Handle navigation
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only main frame
  if (details.frameId !== 0) return;

  const isActive = await isBlockingActive();
  if (!isActive) return;

  const allowed = await isUrlAllowed(details.url);

  if (allowed === false) {
    // Redirect to blocked page
    const blockedUrl = chrome.runtime.getURL('blocked/blocked.html') +
      '?url=' + encodeURIComponent(details.url);

    chrome.tabs.update(details.tabId, { url: blockedUrl });
  }
  // If allowed === 'check_video', let it through - content script will handle
});

// Listen for messages from popup/dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getSettings') {
    getSettings().then(sendResponse);
    return true;
  }

  if (message.type === 'saveSettings') {
    chrome.storage.local.set({ settings: message.settings }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'toggleEnabled') {
    getSettings().then(async (settings) => {
      settings.enabled = message.enabled;
      await chrome.storage.local.set({ settings });
      sendResponse({ success: true, enabled: settings.enabled });
    });
    return true;
  }

  if (message.type === 'addChannel') {
    (async () => {
      try {
        const settings = await getSettings();
        const newHandle = message.channel.handle?.toLowerCase().replace('@', '');
        const newId = message.channel.id;

        const exists = settings.channels.some(c => {
          const existingHandle = c.handle?.toLowerCase().replace('@', '');
          return (newHandle && existingHandle === newHandle) || (newId && c.id === newId);
        });

        if (!exists) {
          settings.channels.push(message.channel);
          await chrome.storage.local.set({ settings });
          console.log('Channel added:', message.channel);
        } else {
          console.log('Channel already exists:', message.channel);
        }

        sendResponse({ success: true, channels: settings.channels });
      } catch (error) {
        console.error('Error adding channel:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (message.type === 'removeChannel') {
    getSettings().then(async (settings) => {
      settings.channels = settings.channels.filter(c =>
        c.handle !== message.handle && c.id !== message.id
      );
      await chrome.storage.local.set({ settings });
      sendResponse({ success: true, channels: settings.channels });
    });
    return true;
  }

  if (message.type === 'isUrlAllowed') {
    isUrlAllowed(message.url).then(sendResponse);
    return true;
  }

  if (message.type === 'isChannelAllowed') {
    (async () => {
      const settings = await getSettings();
      const allowed = isChannelAllowed(message.channelInfo, settings.channels);
      console.log('isChannelAllowed check:', message.channelInfo, 'Result:', allowed);
      sendResponse(allowed);
    })();
    return true;
  }

  if (message.type === 'isBlockingActive') {
    isBlockingActive().then(sendResponse);
    return true;
  }
});

// Update icon based on enabled state
async function updateIcon() {
  const settings = await getSettings();
  const isActive = await isBlockingActive();

  // Could change icon color/badge based on state
  chrome.action.setBadgeText({
    text: isActive ? 'ON' : 'OFF'
  });
  chrome.action.setBadgeBackgroundColor({
    color: isActive ? '#22c55e' : '#6b7280'
  });
}

// Update icon when storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.settings) {
    updateIcon();
  }
});

// Initial icon update
updateIcon();
