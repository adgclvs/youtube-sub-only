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
      // Check both id and channelId fields
      return channel.id === value || channel.channelId === value;
    }
  });
}

// Fetch channel_id and info from a YouTube handle
async function resolveChannelInfo(handle) {
  const cleanHandle = handle.replace('@', '');
  try {
    const response = await fetch(`https://www.youtube.com/@${cleanHandle}`, {
      headers: { 'Accept-Language': 'en' }
    });
    const html = await response.text();

    // Extract channel ID
    let channelId = null;
    const idMatch = html.match(/<meta\s+itemprop="channelId"\s+content="([^"]+)"/) ||
                    html.match(/"channelId":"([^"]+)"/) ||
                    html.match(/channel_id=([^"&]+)/);
    if (idMatch) {
      channelId = idMatch[1];
    }

    // Extract channel name
    let channelName = cleanHandle;
    const nameMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/) ||
                      html.match(/"ownerChannelName":"([^"]+)"/);
    if (nameMatch) {
      channelName = nameMatch[1];
    }

    // Extract avatar
    let avatar = null;
    const avatarMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
    if (avatarMatch) {
      avatar = avatarMatch[1];
    }

    return { channelId, channelName, avatar };
  } catch (error) {
    console.error('Error resolving channel info:', error);
    return { channelId: null, channelName: cleanHandle, avatar: null };
  }
}

// Fetch RSS feed for a channel (regex parsing - DOMParser unavailable in Service Worker)
async function fetchChannelFeed(channelId) {
  try {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
    const response = await fetch(rssUrl);
    const text = await response.text();

    const videos = [];

    // Split by <entry> tags and parse each one
    const entryBlocks = text.split('<entry>').slice(1); // skip first (before first entry)

    for (const block of entryBlocks) {
      const videoIdMatch = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = block.match(/<title>([^<]+)<\/title>/);
      const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
      const authorMatch = block.match(/<author>\s*<name>([^<]+)<\/name>/);
      const thumbnailMatch = block.match(/<media:thumbnail\s+url="([^"]+)"/);

      const videoId = videoIdMatch?.[1];
      const title = titleMatch?.[1];
      const published = publishedMatch?.[1];
      const channelName = authorMatch?.[1];
      const thumbnail = thumbnailMatch?.[1] ||
        (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null);

      if (videoId && title) {
        videos.push({
          videoId,
          title: decodeXmlEntities(title),
          url: `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail,
          channel: channelName ? decodeXmlEntities(channelName) : '',
          channelId,
          published,
          date: published ? new Date(published).toLocaleDateString() : ''
        });
      }
    }

    console.log(`Fetched ${videos.length} videos for channel ${channelId}`);
    return videos;
  } catch (error) {
    console.error('Error fetching feed for', channelId, error);
    return [];
  }
}

// Decode XML entities like &amp; &lt; &gt; &quot; &#39;
function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

// Fetch feeds for all channels
async function fetchAllFeeds() {
  const settings = await getSettings();
  const allVideos = [];

  console.log('Fetching feeds for', settings.channels.length, 'channels');

  for (const channel of settings.channels) {
    console.log('Channel:', channel.name, 'channelId:', channel.channelId);
    if (channel.channelId) {
      const videos = await fetchChannelFeed(channel.channelId);
      allVideos.push(...videos);
    } else {
      console.warn('No channelId for', channel.name, '- trying to resolve...');
      const handle = channel.handle?.replace('@', '') || channel.name;
      const info = await resolveChannelInfo(handle);
      if (info.channelId) {
        // Update channel with resolved info
        channel.channelId = info.channelId;
        if (info.channelName) channel.name = info.channelName;
        if (info.avatar) channel.avatar = info.avatar;
        await chrome.storage.local.set({ settings });

        const videos = await fetchChannelFeed(info.channelId);
        allVideos.push(...videos);
      }
    }
  }

  // Sort by date (newest first)
  allVideos.sort((a, b) => new Date(b.published) - new Date(a.published));

  console.log('Total videos fetched:', allVideos.length);
  return allVideos;
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
        const channel = message.channel;
        const newHandle = channel.handle?.toLowerCase().replace('@', '');
        const newId = channel.id || channel.channelId;

        const exists = settings.channels.some(c => {
          const existingHandle = c.handle?.toLowerCase().replace('@', '');
          return (newHandle && existingHandle === newHandle) || (newId && (c.id === newId || c.channelId === newId));
        });

        if (!exists) {
          // Auto-resolve channel info if we don't have channelId
          if (!channel.channelId && newHandle) {
            console.log('Resolving channel info for:', newHandle);
            const info = await resolveChannelInfo(newHandle);
            if (info.channelId) {
              channel.channelId = info.channelId;
            }
            if (info.channelName && channel.name === newHandle) {
              channel.name = info.channelName;
            }
            if (info.avatar) {
              channel.avatar = info.avatar;
            }
            console.log('Resolved channel info:', info);
          }

          settings.channels.push(channel);
          await chrome.storage.local.set({ settings });
          console.log('Channel added:', channel);
        } else {
          console.log('Channel already exists:', channel);
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

  if (message.type === 'getWatchProgress') {
    chrome.storage.local.get('watchProgress').then(data => {
      sendResponse(data.watchProgress || {});
    });
    return true;
  }

  if (message.type === 'resolveChannelInfo') {
    resolveChannelInfo(message.handle).then(sendResponse);
    return true;
  }

  if (message.type === 'fetchAllFeeds') {
    fetchAllFeeds().then(sendResponse);
    return true;
  }

  if (message.type === 'fetchChannelFeed') {
    fetchChannelFeed(message.channelId).then(sendResponse);
    return true;
  }
});

// Update icon based on enabled state
async function updateIcon() {
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
