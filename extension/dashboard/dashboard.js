document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const navItems = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.section');
  const enabledToggle = document.getElementById('enabledToggle');
  const settingsEnabledToggle = document.getElementById('settingsEnabledToggle');
  const statusText = document.getElementById('statusText');
  const channelsGrid = document.getElementById('channelsGrid');
  const emptyState = document.getElementById('emptyState');
  const addChannelBtn = document.getElementById('addChannelBtn');
  const emptyAddBtn = document.getElementById('emptyAddBtn');
  const addChannelModal = document.getElementById('addChannelModal');
  const closeModal = document.getElementById('closeModal');
  const cancelAdd = document.getElementById('cancelAdd');
  const confirmAdd = document.getElementById('confirmAdd');
  const channelInput = document.getElementById('channelInput');
  const videosGrid = document.getElementById('videosGrid');
  const feedEmpty = document.getElementById('feedEmpty');
  const feedLoading = document.getElementById('feedLoading');
  const refreshFeed = document.getElementById('refreshFeed');
  const exportData = document.getElementById('exportData');
  const importData = document.getElementById('importData');
  const importFile = document.getElementById('importFile');

  let settings = null;

  // Load settings
  async function loadSettings() {
    const response = await chrome.runtime.sendMessage({ type: 'getSettings' });
    settings = response;
    return response;
  }

  // Save settings
  async function saveSettings() {
    await chrome.runtime.sendMessage({ type: 'saveSettings', settings });
  }

  // Update UI based on settings
  function updateUI() {
    // Update toggles
    enabledToggle.checked = settings.enabled;
    settingsEnabledToggle.checked = settings.enabled;

    // Update status text
    statusText.textContent = settings.enabled
      ? 'Active - YouTube is filtered'
      : 'Inactive - YouTube is not filtered';

    // Update channels
    renderChannels();
  }

  // Navigation
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = item.dataset.section;

      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === `${sectionId}Section`) {
          section.classList.add('active');
        }
      });

      // Load feed when switching to feed section
      if (sectionId === 'feed') {
        loadFeed();
      }
    });
  });

  // Toggle handlers
  enabledToggle.addEventListener('change', async () => {
    settings.enabled = enabledToggle.checked;
    await saveSettings();
    updateUI();
  });

  settingsEnabledToggle.addEventListener('change', async () => {
    settings.enabled = settingsEnabledToggle.checked;
    await saveSettings();
    updateUI();
  });

  // Render channels
  function renderChannels() {
    if (!settings.channels || settings.channels.length === 0) {
      channelsGrid.innerHTML = '';
      emptyState.classList.remove('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    channelsGrid.innerHTML = settings.channels.map((channel, index) => `
      <div class="channel-card" data-index="${index}">
        <div class="channel-card-header">
          <div class="channel-avatar">
            ${channel.avatar
              ? `<img src="${channel.avatar}" alt="${escapeHtml(channel.name)}">`
              : escapeHtml(channel.name.charAt(0).toUpperCase())}
          </div>
          <div class="channel-details">
            <div class="channel-name">${escapeHtml(channel.name)}</div>
            <div class="channel-handle">${escapeHtml(channel.handle || channel.id)}</div>
          </div>
        </div>
        <div class="channel-card-actions">
          <button class="btn btn-secondary visit-channel" data-handle="${escapeHtml(channel.handle || '')}" data-id="${escapeHtml(channel.id || '')}">
            Visit Channel
          </button>
          <button class="btn btn-danger remove-channel" data-index="${index}">
            🗑️
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners
    channelsGrid.querySelectorAll('.visit-channel').forEach(btn => {
      btn.addEventListener('click', () => {
        const handle = btn.dataset.handle;
        const id = btn.dataset.id;
        let url;
        if (handle) {
          url = `https://www.youtube.com/${handle.startsWith('@') ? '' : '@'}${handle}`;
        } else if (id) {
          url = `https://www.youtube.com/channel/${id}`;
        }
        if (url) {
          window.open(url, '_blank');
        }
      });
    });

    channelsGrid.querySelectorAll('.remove-channel').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.dataset.index);
        settings.channels.splice(index, 1);
        await saveSettings();
        renderChannels();
      });
    });
  }

  // Modal handlers
  function openModal() {
    addChannelModal.classList.remove('hidden');
    channelInput.value = '';
    channelInput.focus();
  }

  function closeModalFn() {
    addChannelModal.classList.add('hidden');
  }

  addChannelBtn.addEventListener('click', openModal);
  emptyAddBtn.addEventListener('click', openModal);
  closeModal.addEventListener('click', closeModalFn);
  cancelAdd.addEventListener('click', closeModalFn);

  addChannelModal.querySelector('.modal-backdrop').addEventListener('click', closeModalFn);

  // Add channel
  confirmAdd.addEventListener('click', async () => {
    const input = channelInput.value.trim();
    if (!input) return;

    // Parse input
    let handle = input;

    // Extract from URL if provided
    const urlPatterns = [
      /youtube\.com\/@([^\/\?]+)/,
      /youtube\.com\/channel\/([^\/\?]+)/,
      /youtube\.com\/c\/([^\/\?]+)/,
      /youtube\.com\/user\/([^\/\?]+)/
    ];

    for (const pattern of urlPatterns) {
      const match = input.match(pattern);
      if (match) {
        handle = match[1];
        break;
      }
    }

    // Clean up handle
    handle = handle.replace(/^@/, '');

    // Check if already exists
    const exists = settings.channels.some(c =>
      c.handle?.replace('@', '').toLowerCase() === handle.toLowerCase() ||
      c.id === handle
    );

    if (exists) {
      alert('This channel is already in your list');
      return;
    }

    // Add channel
    const channel = {
      name: handle,
      handle: `@${handle}`,
      id: null,
      avatar: null,
      addedAt: new Date().toISOString()
    };

    settings.channels.push(channel);
    await saveSettings();

    closeModalFn();
    renderChannels();

    // Try to fetch channel info in background
    fetchChannelInfo(handle, settings.channels.length - 1);
  });

  // Enter key to add channel
  channelInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      confirmAdd.click();
    }
  });

  // Fetch channel info (avatar, real name) - best effort
  async function fetchChannelInfo(handle, index) {
    try {
      // Use YouTube RSS feed to get channel info
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?user=${handle}`;
      // Note: This might not work for all channels due to CORS
      // In a real extension, you'd use background fetch or YouTube API
    } catch (e) {
      console.log('Could not fetch channel info:', e);
    }
  }

  // Load feed (latest videos)
  async function loadFeed() {
    if (!settings.channels || settings.channels.length === 0) {
      videosGrid.innerHTML = '';
      feedEmpty.classList.remove('hidden');
      feedLoading.classList.add('hidden');
      return;
    }

    feedEmpty.classList.add('hidden');
    feedLoading.classList.remove('hidden');
    videosGrid.innerHTML = '';

    const videos = [];

    // Fetch RSS feeds for each channel
    for (const channel of settings.channels) {
      try {
        const handle = channel.handle?.replace('@', '') || channel.name;
        // YouTube RSS feed URL
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?user=${handle}`;

        // Note: Due to CORS, we'll need to use a proxy or background fetch
        // For now, we'll show a message
        // In production, you'd fetch this in the background script
      } catch (e) {
        console.log('Error fetching feed for', channel.name, e);
      }
    }

    feedLoading.classList.add('hidden');

    if (videos.length === 0) {
      // Show manual message since RSS fetching has CORS limitations
      videosGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-icon">🔗</div>
          <h3>Visit your channels directly</h3>
          <p>Click on a channel in the Channels tab to see their latest videos</p>
          <p style="color: var(--text-muted); font-size: 12px; margin-top: 16px;">
            Note: Direct feed loading will be available in a future update with YouTube API integration
          </p>
        </div>
      `;
    } else {
      renderVideos(videos);
    }
  }

  // Render videos
  function renderVideos(videos) {
    videosGrid.innerHTML = videos.map(video => `
      <a href="${video.url}" target="_blank" class="video-card">
        <div class="video-thumbnail">
          <img src="${video.thumbnail}" alt="${escapeHtml(video.title)}">
        </div>
        <div class="video-info">
          <div class="video-title">${escapeHtml(video.title)}</div>
          <div class="video-meta">
            <span class="video-channel">${escapeHtml(video.channel)}</span>
            <span>•</span>
            <span class="video-date">${video.date}</span>
          </div>
        </div>
      </a>
    `).join('');
  }

  refreshFeed.addEventListener('click', loadFeed);

  // Export/Import
  exportData.addEventListener('click', () => {
    const data = JSON.stringify(settings.channels, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'youtube-sub-only-channels.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  importData.addEventListener('click', () => {
    importFile.click();
  });

  importFile.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const channels = JSON.parse(text);

      if (!Array.isArray(channels)) {
        throw new Error('Invalid format');
      }

      // Merge with existing channels
      for (const channel of channels) {
        const exists = settings.channels.some(c =>
          c.handle === channel.handle || c.id === channel.id
        );
        if (!exists && (channel.handle || channel.id)) {
          settings.channels.push({
            name: channel.name || channel.handle || channel.id,
            handle: channel.handle,
            id: channel.id,
            avatar: channel.avatar,
            addedAt: channel.addedAt || new Date().toISOString()
          });
        }
      }

      await saveSettings();
      renderChannels();
      alert(`Imported ${channels.length} channels`);
    } catch (err) {
      alert('Error importing file: ' + err.message);
    }

    importFile.value = '';
  });

  // Escape HTML
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize
  await loadSettings();
  updateUI();
});
