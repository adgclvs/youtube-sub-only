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
  const scheduleEnabledToggle = document.getElementById('scheduleEnabledToggle');
  const scheduleRulesContainer = document.getElementById('scheduleRules');
  const addScheduleRuleBtn = document.getElementById('addScheduleRule');

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

    // Update schedule toggle
    if (settings.schedule) {
      scheduleEnabledToggle.checked = settings.schedule.enabled;
    }

    // Update status text
    let statusMessage = '';
    if (!settings.enabled) {
      statusMessage = 'Inactive - YouTube is not filtered';
    } else if (settings.schedule?.enabled && settings.schedule?.rules?.length > 0) {
      statusMessage = 'Active - Scheduled filtering';
    } else {
      statusMessage = 'Active - YouTube is filtered';
    }
    statusText.textContent = statusMessage;

    // Update channels
    renderChannels();

    // Update schedule rules
    renderScheduleRules();
  }

  // Render schedule rules
  function renderScheduleRules() {
    if (!settings.schedule) {
      settings.schedule = { enabled: false, rules: [] };
    }

    const rules = settings.schedule.rules || [];

    if (rules.length === 0) {
      scheduleRulesContainer.innerHTML = '<p class="schedule-empty">No time slots configured. Add one to set when filtering is active.</p>';
      return;
    }

    scheduleRulesContainer.innerHTML = rules.map((rule, index) => `
      <div class="schedule-rule" data-index="${index}">
        <div class="schedule-rule-header">
          <span class="schedule-rule-title">Time Slot ${index + 1}</span>
          <button class="schedule-rule-delete" data-index="${index}">🗑️</button>
        </div>
        <div class="schedule-days">
          ${DAY_NAMES.map((day, dayIndex) => `
            <button class="day-btn ${rule.days.includes(dayIndex) ? 'active' : ''}"
                    data-rule="${index}" data-day="${dayIndex}">
              ${day}
            </button>
          `).join('')}
        </div>
        <div class="schedule-times">
          <div class="time-input-group">
            <label>From</label>
            <input type="time" value="${rule.startTime}" data-rule="${index}" data-field="startTime">
          </div>
          <div class="time-input-group">
            <label>To</label>
            <input type="time" value="${rule.endTime}" data-rule="${index}" data-field="endTime">
          </div>
        </div>
      </div>
    `).join('');

    // Add event listeners for day buttons
    scheduleRulesContainer.querySelectorAll('.day-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ruleIndex = parseInt(btn.dataset.rule);
        const dayIndex = parseInt(btn.dataset.day);
        const rule = settings.schedule.rules[ruleIndex];

        if (rule.days.includes(dayIndex)) {
          rule.days = rule.days.filter(d => d !== dayIndex);
        } else {
          rule.days.push(dayIndex);
          rule.days.sort((a, b) => a - b);
        }

        await saveSettings();
        renderScheduleRules();
      });
    });

    // Add event listeners for time inputs
    scheduleRulesContainer.querySelectorAll('input[type="time"]').forEach(input => {
      input.addEventListener('change', async () => {
        const ruleIndex = parseInt(input.dataset.rule);
        const field = input.dataset.field;
        settings.schedule.rules[ruleIndex][field] = input.value;
        await saveSettings();
      });
    });

    // Add event listeners for delete buttons
    scheduleRulesContainer.querySelectorAll('.schedule-rule-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ruleIndex = parseInt(btn.dataset.index);
        settings.schedule.rules.splice(ruleIndex, 1);
        await saveSettings();
        renderScheduleRules();
      });
    });
  }

  // Add new schedule rule
  async function addScheduleRule() {
    if (!settings.schedule) {
      settings.schedule = { enabled: false, rules: [] };
    }

    settings.schedule.rules.push({
      days: [1, 2, 3, 4, 5], // Monday to Friday by default
      startTime: '09:00',
      endTime: '17:00'
    });

    await saveSettings();
    renderScheduleRules();
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

  // Schedule toggle handler
  scheduleEnabledToggle.addEventListener('change', async () => {
    if (!settings.schedule) {
      settings.schedule = { enabled: false, rules: [] };
    }
    settings.schedule.enabled = scheduleEnabledToggle.checked;
    await saveSettings();
    updateUI();
  });

  // Add schedule rule button
  addScheduleRuleBtn.addEventListener('click', addScheduleRule);

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

    // Show loading state
    confirmAdd.disabled = true;
    confirmAdd.textContent = 'Adding...';

    // Add channel via background script (auto-resolves channelId, name, avatar)
    const channel = {
      name: handle,
      handle: `@${handle}`,
      id: null,
      channelId: null,
      avatar: null,
      addedAt: new Date().toISOString()
    };

    const response = await chrome.runtime.sendMessage({ type: 'addChannel', channel });

    confirmAdd.disabled = false;
    confirmAdd.textContent = 'Add Channel';

    if (response && response.success) {
      settings.channels = response.channels;
      closeModalFn();
      renderChannels();
    }
  });

  // Enter key to add channel
  channelInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      confirmAdd.click();
    }
  });

  // Feed state
  let allVideos = [];
  let activeFilter = 'all';
  const feedFilterList = document.getElementById('feedFilterList');

  // Load feed (latest videos) via background script
  async function loadFeed() {
    if (!settings.channels || settings.channels.length === 0) {
      videosGrid.innerHTML = '';
      feedEmpty.classList.remove('hidden');
      feedLoading.classList.add('hidden');
      renderFeedSidebar();
      return;
    }

    feedEmpty.classList.add('hidden');
    feedLoading.classList.remove('hidden');
    videosGrid.innerHTML = '';

    allVideos = await chrome.runtime.sendMessage({ type: 'fetchAllFeeds' }) || [];

    feedLoading.classList.add('hidden');

    renderFeedSidebar();
    filterAndRenderVideos();
  }

  // Render the channel filter sidebar
  function renderFeedSidebar() {
    let html = `
      <li class="feed-filter-item ${activeFilter === 'all' ? 'active' : ''}" data-channel="all">
        <span class="feed-filter-avatar">All</span>
        <span class="feed-filter-name">All Channels</span>
      </li>
    `;

    if (settings.channels) {
      for (const channel of settings.channels) {
        const id = channel.channelId || channel.handle || channel.name;
        html += `
          <li class="feed-filter-item ${activeFilter === id ? 'active' : ''}" data-channel="${escapeHtml(id)}">
            <span class="feed-filter-avatar">
              ${channel.avatar
                ? `<img src="${channel.avatar}" alt="${escapeHtml(channel.name)}">`
                : escapeHtml(channel.name.charAt(0).toUpperCase())}
            </span>
            <span class="feed-filter-name">${escapeHtml(channel.name)}</span>
          </li>
        `;
      }
    }

    feedFilterList.innerHTML = html;

    // Add click handlers
    feedFilterList.querySelectorAll('.feed-filter-item').forEach(item => {
      item.addEventListener('click', () => {
        activeFilter = item.dataset.channel;
        // Update active class
        feedFilterList.querySelectorAll('.feed-filter-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        filterAndRenderVideos();
      });
    });
  }

  // Filter videos based on selected channel and render
  function filterAndRenderVideos() {
    let filtered = allVideos;

    if (activeFilter !== 'all') {
      filtered = allVideos.filter(v =>
        v.channelId === activeFilter ||
        v.channel === activeFilter
      );
    }

    if (filtered.length === 0) {
      feedEmpty.classList.remove('hidden');
      videosGrid.innerHTML = '';
    } else {
      feedEmpty.classList.add('hidden');
      renderVideos(filtered);
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
