/**
 * multiview.js
 * Manages all functionality for the Multi-View page.
 * Uses Gridstack.js for the draggable and resizable player grid.
 */

import { appState, guideState, UIElements } from './state.js';
import { apiFetch } from './api.js';
import { showNotification, openModal, closeModal, showConfirm } from './ui.js';

let grid;
const players = new Map(); // Stores player instances (mpegts) by widget ID
let activePlayerId = null;
let channelSelectorCallback = null;

const MAX_PLAYERS = 9;

/**
 * Initializes the Multi-View page, sets up the grid and event listeners.
 */
export function initMultiView() {
    if (grid) { // If grid exists, just reload layouts
        loadLayouts();
        return;
    }

    console.log('[MultiView] Initializing for the first time.');
    const options = {
        float: true,
        cellHeight: '8vh',
        margin: 5,
        column: 12,
        alwaysShowResizeHandle: 'mobile',
        // Make items resizable from all handles
        resizable: {
            handles: 'e, se, s, sw, w'
        }
    };
    grid = GridStack.init(options, '#multiview-grid');

    updateGridBackground();
    grid.on('change', updateGridBackground);

    setupMultiViewEventListeners();
    loadLayouts(); // Fetch and display saved layouts on initial load
}

/**
 * Checks if there are any active players on the Multi-View page.
 * @returns {boolean} True if at least one player exists.
 */
export function isMultiViewActive() {
    return players.size > 0;
}

/**
 * Destroys all players, clears the grid, and resets the Multi-View state.
 * Called when navigating away from the page.
 */
export function cleanupMultiView() {
    if (grid) {
        console.log('[MultiView] Cleaning up all players and grid.');
        grid.batchUpdate();
        try {
            grid.getGridItems().forEach(item => {
                const widgetId = item.gridstackNode.id;
                stopAndCleanupPlayer(widgetId);
            });
            grid.removeAll();
        } finally {
            grid.batchUpdate(false);
        }
    }
    players.clear();
    activePlayerId = null;
    channelSelectorCallback = null;
}

/**
 * Adjusts the grid's background pattern size to match the current column layout.
 */
function updateGridBackground() {
    const container = UIElements.multiviewContainer.querySelector('.grid-stack');
    if (!container) return;
    const columnWidth = container.offsetWidth / grid.getColumn();
    container.style.backgroundSize = `${columnWidth}px ${columnWidth}px`;
}


/**
 * Sets up global event listeners for the Multi-View page controls.
 */
function setupMultiViewEventListeners() {
    UIElements.multiviewAddPlayer.addEventListener('click', () => addPlayerWidget());
    UIElements.multiviewRemovePlayer.addEventListener('click', removeLastPlayer);

    // Layout buttons
    UIElements.layoutBtnAuto.addEventListener('click', () => applyPresetLayout('auto'));
    UIElements.layoutBtn2x2.addEventListener('click', () => applyPresetLayout('2x2'));
    UIElements.layoutBtn1x3.addEventListener('click', () => applyPresetLayout('1x3'));

    // Save/Load Layout Buttons
    UIElements.multiviewSaveLayoutBtn.addEventListener('click', () => openModal(UIElements.saveLayoutModal));
    UIElements.multiviewLoadLayoutBtn.addEventListener('click', loadSelectedLayout);
    UIElements.multiviewDeleteLayoutBtn.addEventListener('click', deleteLayout);
    UIElements.saveLayoutForm.addEventListener('submit', saveLayout);
    UIElements.saveLayoutCancelBtn.addEventListener('click', () => closeModal(UIElements.saveLayoutModal));

    // Channel Selector Modal
    UIElements.channelSelectorCancelBtn.addEventListener('click', () => closeModal(UIElements.multiviewChannelSelectorModal));
    UIElements.channelSelectorSearch.addEventListener('input', (e) => populateChannelSelector());
    UIElements.multiviewChannelFilter.addEventListener('change', () => populateChannelSelector());
    UIElements.channelSelectorList.addEventListener('click', (e) => {
        const channelItem = e.target.closest('.channel-item');
        if (channelItem && channelSelectorCallback) {
            const channel = {
                id: channelItem.dataset.id,
                name: channelItem.dataset.name,
                url: channelItem.dataset.url,
                logo: channelItem.dataset.logo,
            };
            channelSelectorCallback(channel);
            closeModal(UIElements.multiviewChannelSelectorModal);
        }
    });
}

/**
 * Creates and adds a new player widget to the grid.
 * @param {object|null} channel - Optional channel to auto-load.
 * @param {object|null} layout - Optional layout data for the widget.
 */
function addPlayerWidget(channel = null, layout = {}) {
    if (grid.getGridItems().length >= MAX_PLAYERS) {
        showNotification(`You can add a maximum of ${MAX_PLAYERS} players.`, true);
        return;
    }

    const widgetId = `player-${Date.now()}`;
    const widgetContent = createPlayerWidgetHTML(widgetId);
    
    // Add widget with provided or default layout
    const widgetOptions = {
        id: widgetId,
        w: layout.w || 4,
        h: layout.h || 3,
        x: layout.x, // Let Gridstack handle positioning if x/y are null
        y: layout.y
    };
    const newWidgetEl = grid.addWidget(widgetContent, widgetOptions);

    if (channel) {
        // Find the actual DOM element for the new widget to pass to play function
        const widgetContainer = newWidgetEl.querySelector('.grid-stack-item-content');
        playChannelInWidget(widgetId, channel, widgetContainer);
    }
}


/**
 * Removes the most recently added player from the grid.
 */
function removeLastPlayer() {
    const items = grid.getGridItems();
    if (items.length > 0) {
        const lastItem = items[items.length - 1];
        stopAndCleanupPlayer(lastItem.gridstackNode.id);
        grid.removeWidget(lastItem);
    }
}

/**
 * Applies a predefined layout to the player grid.
 * @param {'auto'|'2x2'|'1x3'} layoutName - The name of the layout to apply.
 */
function applyPresetLayout(layoutName) {
    const items = grid.getGridItems();
    if (items.length === 0) return;

    grid.batchUpdate();
    try {
        if (layoutName === 'auto') {
            grid.compact(); // Gridstack's default packing algorithm
        } else if (layoutName === '2x2') {
            if (items.length > 4) showNotification("2x2 layout works best with up to 4 players.", false);
            const layout = [
                {x: 0, y: 0, w: 6, h: 4}, {x: 6, y: 0, w: 6, h: 4},
                {x: 0, y: 4, w: 6, h: 4}, {x: 6, y: 4, w: 6, h: 4}
            ];
            items.forEach((item, i) => {
                if(layout[i]) grid.update(item, layout[i]);
            });
        } else if (layoutName === '1x3') {
             if (items.length !== 4) {
                 showNotification("This layout requires exactly 4 players.", true);
                 return;
             }
             const layout = [
                {x: 0, y: 0, w: 8, h: 8}, // Large player
                {x: 8, y: 0, w: 4, h: 3}, {x: 8, y: 3, w: 4, h: 3}, {x: 8, y: 6, w: 4, h: 2.7}
             ];
             items.forEach((item, i) => {
                 if(layout[i]) grid.update(item, layout[i]);
             });
        }
    } finally {
        grid.batchUpdate(false);
    }
}

/**
 * Creates the inner HTML for a new player widget.
 * @param {string} widgetId - The unique ID for this widget.
 * @returns {string} The HTML content for the widget.
 */
function createPlayerWidgetHTML(widgetId) {
    const content = `
        <div class="grid-stack-item-content" id="${widgetId}" data-channel-id="">
            <div class="player-header">
                <span class="player-header-title">No Channel</span>
                <div class="player-controls">
                    <button class="select-channel-btn" title="Select Channel"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg></button>
                    <button class="mute-btn" title="Mute"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9.953 2.903a.75.75 0 00-1.06 0L3.463 8.33a.75.75 0 00-.22.53v2.28a.75.75 0 00.75.75h2.28a.75.75 0 00.53-.22l5.43-5.43a.75.75 0 000-1.06zM11.03 2.904a.75.75 0 00-1.06 1.06l4.24 4.24a.75.75 0 001.06-1.06l-4.24-4.24zM10 5.06l-4.24 4.24v.45h2.28l4.24-4.24v-.45h-2.28z"></path><path d="M14.5 10a4.5 4.5 0 01-8.6 2.006a.75.75 0 10-1.3-.75a6 6 0 0011.19 1.488A.75.75 0 1014.5 10z"></path></svg></button>
                    <input type="range" min="0" max="1" step="0.05" value="0.5" class="volume-slider">
                    <button class="fullscreen-btn" title="Fullscreen"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 8.75A.75.75 0 013.75 8h4.5a.75.75 0 010 1.5h-3.25v3.25a.75.75 0 01-1.5 0V8.75zM11.25 3a.75.75 0 01.75.75v3.25h3.25a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75V3.75A.75.75 0 0111.25 3zM8.75 17a.75.75 0 01-.75-.75v-3.25H4.75a.75.75 0 010-1.5h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-.75.75zM17 11.25a.75.75 0 01-.75.75h-3.25v3.25a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75z"></path></svg></button>
                    <button class="close-btn" title="Close Player"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"></path></svg></button>
                </div>
            </div>
            <div class="player-body">
                <div class="player-placeholder">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span>Click to Select Channel</span>
                </div>
                <video class="hidden w-full h-full object-contain" muted></video>
            </div>
        </div>
    `;

    // Create a temporary DOM element to attach event listeners
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    attachWidgetEventListeners(tempDiv, widgetId);

    // Return the element itself for Gridstack to use
    return tempDiv.firstElementChild;
}

/**
 * Attaches event listeners to the controls within a player widget.
 * @param {HTMLElement} widgetEl - The widget's root element.
 * @param {string} widgetId - The unique ID of the widget.
 */
function attachWidgetEventListeners(widgetEl, widgetId) {
    const videoEl = widgetEl.querySelector('video');
    const container = widgetEl.querySelector('.grid-stack-item-content');

    const openSelector = () => {
        channelSelectorCallback = (channel) => playChannelInWidget(widgetId, channel, container);
        populateChannelSelector();
        openModal(UIElements.multiviewChannelSelectorModal);
    };

    widgetEl.querySelector('.select-channel-btn').addEventListener('click', openSelector);
    widgetEl.querySelector('.player-placeholder').addEventListener('click', openSelector);

    widgetEl.querySelector('.close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        stopAndCleanupPlayer(widgetId);
        // The widget element to remove is the parent .grid-stack-item
        grid.removeWidget(widgetEl);
    });
    
    widgetEl.querySelector('.mute-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        videoEl.muted = !videoEl.muted;
        e.currentTarget.innerHTML = videoEl.muted 
            ? `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9.953 2.903a.75.75 0 00-1.06 0L3.463 8.33a.75.75 0 00-.22.53v2.28a.75.75 0 00.75.75h2.28a.75.75 0 00.53-.22l5.43-5.43a.75.75 0 000-1.06zM11.03 2.904a.75.75 0 00-1.06 1.06l4.24 4.24a.75.75 0 001.06-1.06l-4.24-4.24zM10 5.06l-4.24 4.24v.45h2.28l4.24-4.24v-.45h-2.28z"></path><path d="M14.5 10a4.5 4.5 0 01-8.6 2.006a.75.75 0 10-1.3-.75a6 6 0 0011.19 1.488A.75.75 0 1014.5 10z"></path></svg>`
            : `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75A.75.75 0 009.25 3h-3.5zM14.25 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-3.5z"></path></svg>`;
    });

    widgetEl.querySelector('.volume-slider').addEventListener('input', (e) => {
        e.stopPropagation();
        videoEl.volume = parseFloat(e.target.value);
        if (videoEl.volume > 0) videoEl.muted = false;
    });
    
    widgetEl.querySelector('.fullscreen-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (videoEl.requestFullscreen) {
            videoEl.requestFullscreen();
        }
    });

    // Active player handling
    container.addEventListener('click', () => {
        setActivePlayer(widgetId);
    });
}

/**
 * Sets the currently active player, highlighting it and handling audio.
 * @param {string} widgetId - The ID of the widget to set as active.
 */
function setActivePlayer(widgetId) {
    if (activePlayerId === widgetId) return;

    // Deactivate previous player
    if (activePlayerId) {
        const oldActive = document.getElementById(activePlayerId);
        if (oldActive) {
            oldActive.classList.remove('active-player');
            const oldVideo = oldActive.querySelector('video');
            if (oldVideo) oldVideo.muted = true;
        }
    }
    
    // Activate new player
    const newActive = document.getElementById(widgetId);
    if (newActive) {
        newActive.classList.add('active-player');
        const videoEl = newActive.querySelector('video');
        if (videoEl) {
            videoEl.muted = false;
        }
    }
    activePlayerId = widgetId;
}

/**
 * Starts playing a selected channel in a specific player widget.
 * @param {string} widgetId - The ID of the target widget.
 * @param {object} channel - The channel object with id, name, and url.
 * @param {HTMLElement} widgetEl - The player widget container element.
 */
function playChannelInWidget(widgetId, channel, widgetEl) {
    if (!widgetEl) return;

    stopAndCleanupPlayer(widgetId); // Stop previous stream if any

    const videoEl = widgetEl.querySelector('video');
    const placeholderEl = widgetEl.querySelector('.player-placeholder');
    const titleEl = widgetEl.querySelector('.player-header-title');

    titleEl.textContent = channel.name;
    widgetEl.dataset.channelId = channel.id; // Store channel id
    widgetEl.dataset.channelLogo = channel.logo; // Store logo
    widgetEl.dataset.channelName = channel.name; // Store name
    videoEl.classList.remove('hidden');
    placeholderEl.classList.add('hidden');

    const profileId = guideState.settings.activeStreamProfileId;
    const userAgentId = guideState.settings.activeUserAgentId;
    const profile = (guideState.settings.streamProfiles || []).find(p => p.id === profileId);

    if (!profile) {
        showNotification("Active stream profile not found.", true);
        return;
    }

    const streamUrlToPlay = profile.command === 'redirect' 
        ? channel.url 
        : `/stream?url=${encodeURIComponent(channel.url)}&profileId=${profileId}&userAgentId=${userAgentId}`;

    if (mpegts.isSupported()) {
        const player = mpegts.createPlayer({
            type: 'mse',
            isLive: true,
            url: streamUrlToPlay
        });
        
        players.set(widgetId, player);
        player.attachMediaElement(videoEl);
        player.load();
        player.play().catch(err => {
            console.error(`[MultiView] MPEGTS Player Error for ${widgetId}:`, err);
            showNotification(`Could not play stream: ${channel.name}`, true);
            stopAndCleanupPlayer(widgetId);
        });

        setActivePlayer(widgetId);

    } else {
        showNotification('Your browser does not support Media Source Extensions (MSE).', true);
    }
}

/**
 * Stops the stream and cleans up resources for a specific player widget.
 */
function stopAndCleanupPlayer(widgetId) {
    if (players.has(widgetId)) {
        const player = players.get(widgetId);
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
        players.delete(widgetId);
        console.log(`[MultiView] Player destroyed for widget ${widgetId}`);
    }

    const widgetEl = document.getElementById(widgetId);
    if (widgetEl) {
        const videoEl = widgetEl.querySelector('video');
        videoEl.src = "";
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.classList.add('hidden');
        widgetEl.querySelector('.player-placeholder').classList.remove('hidden');
        widgetEl.querySelector('.player-header-title').textContent = 'No Channel';
        widgetEl.dataset.channelId = ''; // Clear stored data
        widgetEl.dataset.channelLogo = '';
        widgetEl.dataset.channelName = '';
    }
}

/**
 * Populates the channel selector modal with available channels based on the selected filter.
 */
function populateChannelSelector() {
    const listEl = UIElements.channelSelectorList;
    const filter = UIElements.multiviewChannelFilter.value;
    const searchTerm = UIElements.channelSelectorSearch.value.trim().toLowerCase();
    if (!listEl) return;
    
    let channelsToDisplay = [];

    // Apply filter first
    if (filter === 'favorites') {
        const favoriteIds = new Set(guideState.settings.favorites || []);
        channelsToDisplay = guideState.channels.filter(ch => favoriteIds.has(ch.id));
    } else if (filter === 'recents') {
        const recentIds = guideState.settings.recentChannels || [];
        channelsToDisplay = recentIds.map(id => guideState.channels.find(ch => ch.id === id)).filter(Boolean); // .filter(Boolean) removes any undefined if a channel was deleted
    } else {
        channelsToDisplay = [...guideState.channels]; // All channels
    }
    
    // Then apply search term
    if (searchTerm) {
        channelsToDisplay = channelsToDisplay.filter(c => 
            (c.displayName || c.name).toLowerCase().includes(searchTerm) || 
            (c.group && c.group.toLowerCase().includes(searchTerm))
        );
    }
    
    if (channelsToDisplay.length === 0) {
        listEl.innerHTML = `<p class="text-center text-gray-500 p-4">No channels found.</p>`;
        return;
    }

    listEl.innerHTML = channelsToDisplay.map(channel => `
        <div class="channel-item flex items-center p-2 rounded-md hover:bg-gray-700 cursor-pointer" 
             data-id="${channel.id}" 
             data-name="${channel.displayName || channel.name}" 
             data-url="${channel.url}"
             data-logo="${channel.logo}">
            <img src="${channel.logo}" onerror="this.onerror=null; this.src='https://placehold.co/40x40/1f2937/d1d5db?text=?';" class="w-10 h-10 object-contain mr-3 rounded-md bg-gray-700 flex-shrink-0">
            <div class="overflow-hidden">
                <p class="font-semibold text-white text-sm truncate">${channel.displayName || channel.name}</p>
                <p class="text-gray-400 text-xs truncate">${channel.group || 'Uncategorized'}</p>
            </div>
        </div>
    `).join('');
}


// --- Layout Management ---

/**
 * Fetches saved layouts from the server and populates the dropdown.
 */
async function loadLayouts() {
    const res = await apiFetch('/api/multiview/layouts');
    if (!res || !res.ok) {
        showNotification('Could not load saved layouts.', true);
        return;
    }
    const layouts = await res.json();
    guideState.settings.multiviewLayouts = layouts;
    populateLayoutsDropdown();
}

/**
 * Populates the 'Saved Layouts' dropdown menu.
 */
function populateLayoutsDropdown() {
    const select = UIElements.savedLayoutsSelect;
    select.innerHTML = '<option value="" disabled selected>Select a layout</option>';
    (guideState.settings.multiviewLayouts || []).forEach(layout => {
        const option = document.createElement('option');
        option.value = layout.id;
        option.textContent = layout.name;
        select.appendChild(option);
    });
}

/**
 * Saves the current grid layout to the server.
 * @param {Event} e - The form submission event.
 */
async function saveLayout(e) {
    e.preventDefault();
    const name = UIElements.saveLayoutName.value.trim();
    if (!name) {
        showNotification('Layout name cannot be empty.', true);
        return;
    }

    const layoutData = grid.save(false); // false = don't save content
    // We need to add the channel ID to each widget's data
    layoutData.forEach(widget => {
        const el = document.getElementById(widget.id);
        if (el) {
            widget.channelId = el.dataset.channelId;
            widget.channelName = el.dataset.channelName;
            widget.channelLogo = el.dataset.channelLogo;
        }
    });

    const res = await apiFetch('/api/multiview/layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, layout_data: layoutData }),
    });

    if (res && res.ok) {
        showNotification('Layout saved successfully!');
        closeModal(UIElements.saveLayoutModal);
        UIElements.saveLayoutForm.reset();
        loadLayouts(); // Refresh the list of layouts
    }
}

/**
 * Loads a selected layout from the dropdown onto the grid.
 */
function loadSelectedLayout() {
    const layoutId = UIElements.savedLayoutsSelect.value;
    if (!layoutId) return;

    const layout = guideState.settings.multiviewLayouts.find(l => l.id == layoutId);
    if (!layout) {
        showNotification('Selected layout not found.', true);
        return;
    }
    
    // Clear current grid
    cleanupMultiView();

    grid.batchUpdate();
    try {
        grid.load(layout.layout_data, true); // true = add new widgets
        // After loading the grid structure, find the channel for each widget and play it
        layout.layout_data.forEach(widgetData => {
            const channel = guideState.channels.find(c => c.id === widgetData.channelId);
            if(channel) {
                const widgetEl = document.getElementById(widgetData.id);
                if(widgetEl) {
                    playChannelInWidget(widgetData.id, channel, widgetEl);
                }
            }
        });

    } finally {
        grid.batchUpdate(false);
    }
}

/**
 * Deletes the currently selected layout from the server.
 */
async function deleteLayout() {
    const layoutId = UIElements.savedLayoutsSelect.value;
    if (!layoutId) {
        showNotification('Please select a layout to delete.', true);
        return;
    }
    
    showConfirm('Delete Layout?', 'Are you sure you want to delete this saved layout?', async () => {
        const res = await apiFetch(`/api/multiview/layouts/${layoutId}`, { method: 'DELETE' });
        if (res && res.ok) {
            showNotification('Layout deleted successfully.');
            loadLayouts(); // Refresh dropdown
        }
    });
}
