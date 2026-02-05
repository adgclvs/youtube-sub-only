document.addEventListener('DOMContentLoaded', async () => {
  const enabledToggle = document.getElementById('enabledToggle');
  const toggleStatus = document.getElementById('toggleStatus');
  const channelList = document.getElementById('channelList');
  const channelCount = document.getElementById('channelCount');
  const emptyMessage = document.getElementById('emptyMessage');
  const openDashboard = document.getElementById('openDashboard');
  const addCurrentChannel = document.getElementById('addCurrentChannel');

  // Load settings
  async function loadSettings() {
    const response = await chrome.runtime.sendMessage({ type: 'getSettings' });
    return response;
  }

  // Update toggle UI
  function updateToggleUI(enabled) {
    enabledToggle.checked = enabled;
    toggleStatus.textContent = enabled ? 'ON' : 'OFF';
    toggleStatus.className = `toggle-status ${enabled ? 'active' : 'inactive'}`;
  }

  // Render channels list
  function renderChannels(channels) {
    channelCount.textContent = channels.length;

    if (channels.length === 0) {
      channelList.innerHTML = '';
      emptyMessage.classList.remove('hidden');
      return;
    }

    emptyMessage.classList.add('hidden');
    channelList.innerHTML = channels.map(channel => `
      <li class="channel-item" data-handle="${channel.handle || ''}" data-id="${channel.id || ''}">
        <div class="channel-avatar">
          ${channel.avatar
            ? `<img src="${channel.avatar}" alt="${channel.name}">`
            : channel.name.charAt(0).toUpperCase()}
        </div>
        <div class="channel-info">
          <div class="channel-name">${escapeHtml(channel.name)}</div>
          <div class="channel-handle">${escapeHtml(channel.handle || channel.id)}</div>
        </div>
      </li>
    `).join('');

    // Add click handlers to open channel
    channelList.querySelectorAll('.channel-item').forEach(item => {
      item.addEventListener('click', () => {
        const handle = item.dataset.handle;
        const id = item.dataset.id;
        let url;
        if (handle) {
          url = `https://www.youtube.com/${handle.startsWith('@') ? '' : '@'}${handle}`;
        } else if (id) {
          url = `https://www.youtube.com/channel/${id}`;
        }
        if (url) {
          chrome.tabs.create({ url });
        }
      });
    });
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Check if current tab is a YouTube channel page
  async function checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return null;

      const url = new URL(tab.url);
      if (!url.hostname.includes('youtube.com')) return null;

      const patterns = [
        { regex: /^\/@([^\/]+)/, type: 'handle' },
        { regex: /^\/channel\/([^\/]+)/, type: 'id' },
        { regex: /^\/c\/([^\/]+)/, type: 'handle' },
        { regex: /^\/user\/([^\/]+)/, type: 'handle' }
      ];

      for (const { regex, type } of patterns) {
        const match = url.pathname.match(regex);
        if (match) {
          return { type, value: match[1], url: tab.url };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  // Initialize
  const settings = await loadSettings();
  updateToggleUI(settings.enabled);
  renderChannels(settings.channels);

  // Check if we can add current channel
  const currentChannel = await checkCurrentTab();
  if (currentChannel) {
    const isAlreadyAdded = settings.channels.some(c =>
      (currentChannel.type === 'handle' && (c.handle === currentChannel.value || c.handle === `@${currentChannel.value}`)) ||
      (currentChannel.type === 'id' && c.id === currentChannel.value)
    );

    if (!isAlreadyAdded) {
      addCurrentChannel.disabled = false;
      addCurrentChannel.textContent = `Add @${currentChannel.value}`;
    } else {
      addCurrentChannel.textContent = 'Already added';
    }
  }

  // Toggle handler
  enabledToggle.addEventListener('change', async () => {
    const enabled = enabledToggle.checked;
    await chrome.runtime.sendMessage({ type: 'toggleEnabled', enabled });
    updateToggleUI(enabled);
  });

  // Open dashboard
  openDashboard.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  // Add current channel
  addCurrentChannel.addEventListener('click', async () => {
    if (!currentChannel) {
      console.error('No current channel detected');
      return;
    }

    if (addCurrentChannel.disabled) {
      console.log('Button is disabled');
      return;
    }

    // Disable button immediately to prevent double clicks
    addCurrentChannel.disabled = true;
    addCurrentChannel.textContent = 'Adding...';

    try {
      const channel = {
        name: currentChannel.value.replace('@', ''),
        handle: currentChannel.value.startsWith('@') ? currentChannel.value : `@${currentChannel.value}`,
        id: currentChannel.type === 'id' ? currentChannel.value : null,
        avatar: null,
        addedAt: new Date().toISOString()
      };

      console.log('Adding channel:', channel);

      const response = await chrome.runtime.sendMessage({ type: 'addChannel', channel });
      console.log('Response:', response);

      if (response && response.success) {
        renderChannels(response.channels);
        addCurrentChannel.textContent = 'Added!';
      } else {
        // Re-enable if failed
        addCurrentChannel.disabled = false;
        addCurrentChannel.textContent = `Add @${currentChannel.value}`;
        console.error('Failed to add channel:', response);
      }
    } catch (error) {
      console.error('Error adding channel:', error);
      // Re-enable on error
      addCurrentChannel.disabled = false;
      addCurrentChannel.textContent = `Add @${currentChannel.value}`;
    }
  });
});
