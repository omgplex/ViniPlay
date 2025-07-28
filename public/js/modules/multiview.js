/**
 * multiview.js
 * Manages all functionality for the Multi-View page.
 * Uses Gridstack.js for the draggable and resizable player grid.
 */

import { appState, guideState, UIElements } from './state.js';
import { showNotification, openModal, closeModal } from './ui.js';

let grid;
const players = new Map(); // Stores player instances (mpegts) by widget ID
let activePlayerId = null;
let channelSelectorCallback = null;

const MAX_PLAYERS = 6;

/**
 * Initializes the Multi-View page, sets up the grid and event listeners.
 */
export function initMultiView() {
    if (grid) return; // Already initialized

    const options = {
        float: true,
        cellHeight: '8vh',
        margin: 5,
        column: 12,
        alwaysShowResizeHandle: 'mobile',
    };
    grid = GridStack.init(options, '.grid-stack');

    // Make the grid background pattern match the column count
    updateGridBackground();
    grid.on('change', updateGridBackground);

    setupMultiViewEventListeners();
    console.log('[MultiView] Initialized');
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
    UIElements.layoutBtnAuto.addEventListener('click', () => applyLayout('auto'));
    UIElements.layoutBtn2x2.addEventListener('click', () => applyLayout('2x2'));
    UIElements.layoutBtn1x3.addEventListener('click', () => applyLayout('1x3'));

    // Channel Selector Modal
    UIElements.channelSelectorCancelBtn.addEventListener('click', () => closeModal(UIElements.multiviewChannelSelectorModal));
    UIElements.channelSelectorSearch.addEventListener('input', (e) => populateChannelSelector(e.target.value));
    UIElements.channelSelectorList.addEventListener('click', (e) => {
        const channelItem = e.target.closest('.channel-item');
        if (channelItem && channelSelectorCallback) {
            const channel = {
                id: channelItem.dataset.id,
                name: channelItem.dataset.name,
                url: channelItem.dataset.url
            };
            channelSelectorCallback(channel);
            closeModal(UIElements.multiviewChannelSelectorModal);
        }
    });
}

/**
 * Creates and adds a new player widget to the grid.
 */
function addPlayerWidget() {
    if (grid.getGridItems().length >= MAX_PLAYERS) {
        showNotification(`You can add a maximum of ${MAX_PLAYERS} players.`, true);
        return;
    }

    const widgetId = `player-${Date.now()}`;
    const widgetContent = createPlayerWidgetHTML(widgetId);
    
    // Add with auto-positioning
    grid.addWidget(widgetContent, { w: 4, h: 3 });
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
function applyLayout(layoutName) {
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
        <div class="grid-stack-item-content" id="${widgetId}">
            <div class="player-header">
                <span class="player-header-title">No Channel Selected</span>
                <div class="player-controls">
                    <button class="select-channel-btn" title="Select Channel"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg></button>
                    <button class="mute-btn" title="Mute"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M7.42 8.76a.75.75 0 00-1.06-1.06L5.62 8.44A6.012 6.012 0 004 10a.75.75 0 001.5 0 4.512 4.512 0 011.2-2.92L5.64 8.14a.75.75 0 00-1.06-1.06L3.47 8.19A7.512 7.512 0 002.5 10a.75.75 0 101.5 0 6.01 6.01 0 011.08-3.32l-1.4-1.4a.75.75 0 00-1.06 1.06L8.94 12.56a.75.75 0 001.06 1.06l4.24-4.24a.75.75 0 00-1.06-1.06L7.42 8.76z"></path><path d="M10.25 5.25a.75.75 0 00-1.5 0v.135a7.48 7.48 0 00-2.83.743l.54 1.44a6 6 0 012.29-.61V5.25zM13 5.25a.75.75 0 00-1.5 0v3.45l-1.23-1.23A4.5 4.5 0 0114.5 10a.75.75 0 001.5 0 6 6 0 00-3-5.347V5.25z"></path></svg></button>
                    <input type="range" min="0" max="1" step="0.05" value="0.5" class="volume-slider">
                    <button class="fullscreen-btn" title="Fullscreen"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 8.75A.75.75 0 013.75 8h4.5a.75.75 0 010 1.5h-3.25v3.25a.75.75 0 01-1.5 0V8.75zM11.25 3a.75.75 0 01.75.75v3.25h3.25a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75V3.75A.75.75 0 0111.25 3zM8.75 17a.75.75 0 01-.75-.75v-3.25H4.75a.75.75 0 010-1.5h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-.75.75zM17 11.25a.75.75 0 01-.75.75h-3.25v3.25a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75z"></path></svg></button>
                    <button class="close-btn" title="Close Player"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"></path></svg></button>
                </div>
            </div>
            <div class="player-body">
                <div class="player-placeholder">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span>No Channel</span>
                </div>
                <video class="hidden w-full h-full" muted></video>
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
    const titleEl = widgetEl.querySelector('.player-header-title');

    widgetEl.querySelector('.select-channel-btn').addEventListener('click', () => {
        channelSelectorCallback = (channel) => playChannelInWidget(widgetId, channel);
        populateChannelSelector();
        openModal(UIElements.multiviewChannelSelectorModal);
    });

    widgetEl.querySelector('.close-btn').addEventListener('click', () => {
        stopAndCleanupPlayer(widgetId);
        grid.removeWidget(widgetEl.closest('.grid-stack-item'));
    });
    
    widgetEl.querySelector('.mute-btn').addEventListener('click', (e) => {
        videoEl.muted = !videoEl.muted;
        e.currentTarget.innerHTML = videoEl.muted 
            ? '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M7.42 8.76a.75.75 0 00-1.06-1.06L5.62 8.44A6.012 6.012 0 004 10a.75.75 0 001.5 0 4.512 4.512 0 011.2-2.92L5.64 8.14a.75.75 0 00-1.06-1.06L3.47 8.19A7.512 7.512 0 002.5 10a.75.75 0 101.5 0 6.01 6.01 0 011.08-3.32l-1.4-1.4a.75.75 0 00-1.06 1.06L8.94 12.56a.75.75 0 001.06 1.06l4.24-4.24a.75.75 0 00-1.06-1.06L7.42 8.76z"></path><path d="M10.25 5.25a.75.75 0 00-1.5 0v.135a7.48 7.48 0 00-2.83.743l.54 1.44a6 6 0 012.29-.61V5.25zM13 5.25a.75.75 0 00-1.5 0v3.45l-1.23-1.23A4.5 4.5 0 0114.5 10a.75.75 0 001.5 0 6 6 0 00-3-5.347V5.25z"></path></svg>'
            : '<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M9.953 2.903a.75.75 0 00-1.06 0L3.463 8.33a.75.75 0 00-.22.53v2.28a.75.75 0 00.75.75h2.28a.75.75 0 00.53-.22l5.43-5.43a.75.75 0 000-1.06zM11.03 2.904a.75.75 0 00-1.06 1.06l4.24 4.24a.75.75 0 001.06-1.06l-4.24-4.24zM10 5.06l-4.24 4.24v.45h2.28l4.24-4.24v-.45h-2.28z"></path><path d="M14.5 10a4.5 4.5 0 01-8.6 2.006a.75.75 0 10-1.3-.75a6 6 0 0011.19 1.488A.75.75 0 1014.5 10z"></path></svg>';
    });

    widgetEl.querySelector('.volume-slider').addEventListener('input', (e) => {
        videoEl.volume = parseFloat(e.target.value);
        if (videoEl.volume > 0) videoEl.muted = false;
    });
    
    widgetEl.querySelector('.fullscreen-btn').addEventListener('click', () => {
        if (videoEl.requestFullscreen) {
            videoEl.requestFullscreen();
        }
    });

    // Active player handling
    widgetEl.addEventListener('click', () => {
        setActivePlayer(widgetId);
    });
}

/**
 * Sets the currently active player, highlighting it and unmuting its audio.
 * @param {string} widgetId - The ID of the widget to set as active.
 */
function setActivePlayer(widgetId) {
    if (activePlayerId === widgetId) return;

    // Deactivate previous player
    if (activePlayerId) {
        const oldActive = document.getElementById(activePlayerId);
        if (oldActive) oldActive.classList.remove('active-player');
    }
    
    // Activate new player
    const newActive = document.getElementById(widgetId);
    if (newActive) {
        newActive.classList.add('active-player');
        const videoEl = newActive.querySelector('video');
        if (videoEl) {
            // Unmute the active player, and mute others
            document.querySelectorAll('#page-multiview video').forEach(v => {
                v.muted = (v !== videoEl);
            });
        }
    }
    activePlayerId = widgetId;
}

/**
 * Starts playing a selected channel in a specific player widget.
 * @param {string} widgetId - The ID of the target widget.
 * @param {object} channel - The channel object with id, name, and url.
 */
function playChannelInWidget(widgetId, channel) {
    const widgetEl = document.getElementById(widgetId);
    if (!widgetEl) return;

    stopAndCleanupPlayer(widgetId); // Stop previous stream if any

    const videoEl = widgetEl.querySelector('video');
    const placeholderEl = widgetEl.querySelector('.player-placeholder');
    const titleEl = widgetEl.querySelector('.player-header-title');

    titleEl.textContent = channel.name;
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

        // Set this as the active player
        setActivePlayer(widgetId);

    } else {
        showNotification('Your browser does not support Media Source Extensions (MSE).', true);
    }
}

/**
 * Stops the stream and cleans up resources for a specific player widget.
 * @param {string} widgetId - The ID of the widget to clean up.
 */
function stopAndCleanupPlayer(widgetId) {
    if (players.has(widgetId)) {
        players.get(widgetId).destroy();
        players.delete(widgetId);
    }

    const widgetEl = document.getElementById(widgetId);
    if (widgetEl) {
        const videoEl = widgetEl.querySelector('video');
        videoEl.src = "";
        videoEl.removeAttribute('src');
        videoEl.load();
        videoEl.classList.add('hidden');
        widgetEl.querySelector('.player-placeholder').classList.remove('hidden');
        widgetEl.querySelector('.player-header-title').textContent = 'No Channel Selected';
    }
}

/**
 * Populates the channel selector modal with available channels.
 * @param {string} [searchTerm=''] - An optional search term to filter channels.
 */
function populateChannelSelector(searchTerm = '') {
    const listEl = UIElements.channelSelectorList;
    if (!listEl) return;
    
    let filteredChannels = guideState.channels;
    if (searchTerm.trim()) {
        const lowerSearch = searchTerm.toLowerCase();
        filteredChannels = guideState.channels.filter(c => 
            c.name.toLowerCase().includes(lowerSearch) || 
            (c.group && c.group.toLowerCase().includes(lowerSearch))
        );
    }
    
    if (filteredChannels.length === 0) {
        listEl.innerHTML = `<p class="text-center text-gray-500 p-4">No channels found.</p>`;
        return;
    }

    listEl.innerHTML = filteredChannels.map(channel => `
        <div class="channel-item flex items-center p-2 rounded-md hover:bg-gray-700 cursor-pointer" 
             data-id="${channel.id}" data-name="${channel.displayName || channel.name}" data-url="${channel.url}">
            <img src="${channel.logo}" onerror="this.onerror=null; this.src='https://placehold.co/40x40/1f2937/d1d5db?text=?';" class="w-10 h-10 object-contain mr-3 rounded-md bg-gray-700 flex-shrink-0">
            <div class="overflow-hidden">
                <p class="font-semibold text-white text-sm truncate">${channel.displayName || channel.name}</p>
                <p class="text-gray-400 text-xs truncate">${channel.group || 'Uncategorized'}</p>
            </div>
        </div>
    `).join('');
}
