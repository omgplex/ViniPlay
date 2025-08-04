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

        // First, destroy all active mpegts player instances to stop streams.
        // We iterate over the players Map directly.
        players.forEach((player, widgetId) => {
            player.pause();
            player.unload();
            player.detachMediaElement();
            player.destroy();
            console.log(`[MultiView] Stream stopped for widget ${widgetId}`);
        });

        // After stopping streams, clear the grid UI entirely.
        grid.removeAll();
    }

    // Finally, reset all state variables related to Multi-View.
    players.clear();
    activePlayerId = null;
    channelSelectorCallback = null;
    console.log('[MultiView] Cleanup complete.');
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
 * @returns {HTMLElement} The added widget element.
 */
function addPlayerWidget(channel = null, layout = {}) {
    if (grid.getGridItems().length >= MAX_PLAYERS) {
        showNotification(`You can add a maximum of ${MAX_PLAYERS} players.`, true);
        return null;
    }

    const widgetId = layout.id || `player-${Date.now()}`;
    const widgetHTML = `
        <div class="player-header">
            <span class="player-header-title">No Channel</span>
            <div class="player-controls">
                <button class="select-channel-btn" title="Select Channel"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg></button>
                <button class="mute-btn" title="Mute"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" id="mute-icon-${widgetId}"><path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75A.75.75 0 009.25 3h-3.5zM14.25 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-3.5z"></path></svg></button>
                <input type="range" min="0" max="1" step="0.05" value="0.5" class="volume-slider">
                <button class="fullscreen-btn" title="Fullscreen"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 8.75A.75.75 0 013.75 8h4.5a.75.75 0 010 1.5h-3.25v3.25a.75.75 0 01-1.5 0V8.75zM11.25 3a.75.75 0 01.75.75v3.25h3.25a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75V3.75A.75.75 0 0111.25 3zM8.75 17a.75.75 0 01-.75-.75v-3.25H4.75a.75.75 0 010-1.5h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-.75.75zM17 11.25a.75.75 0 01-.75.75h-3.25v3.25a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75z"></path></svg></button>
                <button class="stop-btn" title="Stop Channel"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5z"></path></svg></button>
                <button class="remove-widget-btn" title="Remove Player"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" /></svg></button>
            </div>
        </div>
        <div class="player-body">
            <div class="player-placeholder" id="${widgetId}" data-channel-id="">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span>Click to Select Channel</span>
            </div>
            <video class="hidden w-full h-full object-contain" muted></video>
        </div>
    `;

    const newWidgetEl = grid.addWidget({
        id: widgetId,
        content: widgetHTML,
        w: layout.w || 4,
        h: layout.h || 4,
        x: layout.x,
        y: layout.y
    }); 

    const widgetContentEl = newWidgetEl.querySelector('.grid-stack-item-content');
    if (widgetContentEl) {
        attachWidgetEventListeners(widgetContentEl, widgetId);
    }

    if (channel) {
        playChannelInWidget(widgetId, channel, widgetContentEl);
    }
    return newWidgetEl;
}

/**
 * Removes the most recently added player from the grid.
 */
function removeLastPlayer() {
    const items = grid.getGridItems();
    if (items.length > 0) {
        // Sort items by creation time (using timestamp from ID) to be sure
        const sortedItems = items.sort((a, b) => {
            const timeA = parseInt((a.gridstackNode.id || '0').split('-')[1]);
            const timeB = parseInt((b.gridstackNode.id || '0').split('-')[1]);
            return timeA - timeB;
        });
        const lastItem = sortedItems[sortedItems.length - 1];
        if (lastItem) {
            // The widgetId is stored on the player-placeholder now, not gridstackNode directly
            // We need to retrieve it from the DOM element that Gridstack holds
            const playerPlaceholder = lastItem.querySelector('.player-placeholder');
            const widgetId = playerPlaceholder ? playerPlaceholder.id : lastItem.gridstackNode.id; // Fallback if not found
            
            stopAndCleanupPlayer(widgetId);
            grid.removeWidget(lastItem);
            console.log(`[MultiView] Removed last player: ${widgetId}`);
        }
    } else {
        showNotification("No players to remove.", false);
    }
}


/**
 * Applies a predefined layout to the player grid.
 * This function now CLEARS the grid and creates empty players in the specified layout.
 * @param {'auto'|'2x2'|'1x3'} layoutName - The name of the layout to apply.
 */
function applyPresetLayout(layoutName) {
    const numPlayers = grid.getGridItems().length;

    // Special case for 'auto' layout: if the grid is empty, it should just add one player.
    if (layoutName === 'auto' && numPlayers === 0) {
        addPlayerWidget();
        return;
    }

    // The core logic for creating the layout.
    const createLayout = () => {
        cleanupMultiView(); // Clears any existing players and the grid.

        let layout = [];

        if (layoutName === 'auto') {
            // This part only runs if numPlayers > 0 because of the check above.
            let cols, rows;
            if (numPlayers <= 1) { cols = 1; rows = 1; }
            else if (numPlayers === 2) { cols = 2; rows = 1; }
            else if (numPlayers === 3) { cols = 3; rows = 1; }
            else if (numPlayers === 4) { cols = 2; rows = 2; }
            else if (numPlayers >= 5 && numPlayers <= 6) { cols = 3; rows = 2; }
            else { cols = 3; rows = 3; } // For 7-9 players

            const widgetWidth = Math.floor(12 / cols);
            const totalGridHeight = 9;
            const widgetHeight = Math.floor(totalGridHeight / rows);

            for (let i = 0; i < numPlayers; i++) {
                const row = Math.floor(i / cols);
                const col = i % cols;
                layout.push({
                    x: col * widgetWidth,
                    y: row * widgetHeight,
                    w: widgetWidth,
                    h: widgetHeight
                });
            }
        } else if (layoutName === '2x2') {
            layout = [
                {x: 0, y: 0, w: 6, h: 5}, {x: 6, y: 0, w: 6, h: 5},
                {x: 0, y: 5, w: 6, h: 5}, {x: 6, y: 5, w: 6, h: 5}
            ];
        } else if (layoutName === '1x3') {
             // Corrected heights and positions to prevent overlap
             const largeHeight = 9;
             const smallHeight = 3;
             layout = [
                { x: 0, y: 0, w: 8, h: largeHeight },      // Large player
                { x: 8, y: 0, w: 4, h: smallHeight },        // Top small
                { x: 8, y: smallHeight, w: 4, h: smallHeight },    // Middle small
                { x: 8, y: smallHeight * 2, w: 4, h: smallHeight } // Bottom small
             ];
        }

        grid.batchUpdate();
        try {
            layout.forEach(widgetLayout => {
                addPlayerWidget(null, widgetLayout);
            });
        } finally {
            grid.commit();
        }
    };

    // If there are existing players, ask for confirmation before clearing them.
    if (numPlayers > 0) {
        showConfirm(
            `Apply '${layoutName}' Layout?`,
            "This will stop all current streams and apply the new layout with empty players. Are you sure?",
            createLayout // The callback function to run on confirmation
        );
    } else {
        // If the grid is empty, just create the layout directly without confirmation.
        // This handles the user's request for 2x2 and 1x3 on an empty grid.
        createLayout();
    }
}

/**
 * Creates the inner HTML for a new player widget.
 * @param {string} widgetId - The unique ID for this widget.
 * @returns {string} The HTML content string for the widget.
 */
// This function is now correctly placed to return only the inner HTML Gridstack expects
// It was previously misidentified in the user's provided snippet as "deleted"
// but it's essential for creating the player content.
/*
function createPlayerWidgetHTML(widgetId) {
    // This function now returns a simple string, not a DOM element.
    const content = `
        <div class="player-header">
            <span class="player-header-title">No Channel</span>
            <div class="player-controls">
                <button class="select-channel-btn" title="Select Channel"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"></path></svg></button>
                <button class="mute-btn" title="Mute"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" id="mute-icon-${widgetId}"><path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75A.75.75 0 009.25 3h-3.5zM14.25 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-3.5z"></path></svg></button>
                <input type="range" min="0" max="1" step="0.05" value="0.5" class="volume-slider">
                <button class="fullscreen-btn" title="Fullscreen"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 8.75A.75.75 0 013.75 8h4.5a.75.75 0 010 1.5h-3.25v3.25a.75.75 0 01-1.5 0V8.75zM11.25 3a.75.75 0 01.75.75v3.25h3.25a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75V3.75A.75.75 0 0111.25 3zM8.75 17a.75.75 0 01-.75-.75v-3.25H4.75a.75.75 0 010-1.5h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-.75.75zM17 11.25a.75.75 0 01-.75.75h-3.25v3.25a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75z"></path></svg></button>
                <button class="stop-btn" title="Stop Channel"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5z"></path></svg></button>
                <button class="remove-widget-btn" title="Remove Player"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" /></svg></button>
            </div>
        </div>
        <div class="player-body">
            <div class="player-placeholder">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span>Click to Select Channel</span>
            </div>
            <video class="hidden w-full h-full object-contain" muted></video>
        </div>
    `;
    return content;
}
*/ // End of original createPlayerWidgetHTML, which is now replaced by the inlined content above

/**
 * Attaches event listeners to the controls within a player widget.
 * @param {HTMLElement} widgetContentEl - The widget's .grid-stack-item-content element.
 * @param {string} widgetId - The unique ID of the widget (now assigned to player-placeholder).
 */
function attachWidgetEventListeners(widgetContentEl, widgetId) {
    const playerPlaceholderEl = widgetContentEl.querySelector(`.player-placeholder[id="${widgetId}"]`);
    const videoEl = widgetContentEl.querySelector('video');
    const gridStackItem = widgetContentEl.closest('.grid-stack-item');

    const openSelector = () => {
        channelSelectorCallback = (channel) => playChannelInWidget(widgetId, channel, widgetContentEl);
        populateChannelSelector();
        openModal(UIElements.multiviewChannelSelectorModal);
    };

    widgetContentEl.querySelector('.select-channel-btn').addEventListener('click', openSelector);
    if (playerPlaceholderEl) {
        playerPlaceholderEl.addEventListener('click', openSelector);
    }

    widgetContentEl.querySelector('.stop-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        stopAndCleanupPlayer(widgetId, true);
    });

    widgetContentEl.querySelector('.remove-widget-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        stopAndCleanupPlayer(widgetId, true);
        if (gridStackItem) {
            grid.removeWidget(gridStackItem);
        }
    });
    
    widgetContentEl.querySelector('.mute-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        videoEl.muted = !videoEl.muted;
        const muteIcon = document.getElementById(`mute-icon-${widgetId}`);
        if (muteIcon) {
            muteIcon.innerHTML = videoEl.muted
                ? `<path fill-rule="evenodd" d="M10 1a.75.75 0 00-1.06.04L4.854 5.146A.75.75 0 004.5 5.5v9a.75.75 0 00.22.53l5.43 5.43a.75.75 0 001.28-.53V1.5A.75.75 0 0010 1zM8.5 6.54v6.92L5.25 10.21V5.79L8.5 6.54zM12.5 5a.75.75 0 01.75.75v8.5a.75.75 0 01-1.5 0v-8.5a.75.75 0 01.75-.75zM15.5 5a.75.75 0 01.75.75v8.5a.75.75 0 01-1.5 0v-8.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />`
                : `<path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75A.75.75 0 009.25 3h-3.5zM14.25 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-3.5z"></path>`;
        }
    });

    widgetContentEl.querySelector('.volume-slider').addEventListener('input', (e) => {
        e.stopPropagation();
        videoEl.volume = parseFloat(e.target.value);
        if (videoEl.volume > 0) videoEl.muted = false;
    });

    widgetContentEl.querySelector('.fullscreen-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (videoEl.requestFullscreen) {
            videoEl.requestFullscreen();
        }
    });

    widgetContentEl.addEventListener('click', () => {
        setActivePlayer(widgetId);
    });
}

/**
 * Sets the currently active player, highlighting it and handling audio.
 * @param {string} widgetId - The ID of the player-placeholder to set as active.
 */
function setActivePlayer(widgetId) {
    if (activePlayerId === widgetId) return;

    const oldActivePlaceholder = document.getElementById(activePlayerId);
    const oldActiveWidgetContent = oldActivePlaceholder ? oldActivePlaceholder.closest('.grid-stack-item-content') : null;
    
    if (oldActiveWidgetContent) {
        oldActiveWidgetContent.classList.remove('active-player');
        const oldVideo = oldActiveWidgetContent.querySelector('video');
        if (oldVideo) oldVideo.muted = true;
    }
    
    const newActivePlaceholder = document.getElementById(widgetId);
    const newActiveWidgetContent = newActivePlaceholder ? newActivePlaceholder.closest('.grid-stack-item-content') : null;

    if (newActiveWidgetContent) {
        newActiveWidgetContent.classList.add('active-player');
        const videoEl = newActiveWidgetContent.querySelector('video');
        if (videoEl) {
            videoEl.muted = false;
        }
    }
    activePlayerId = widgetId;
}

/**
 * Starts playing a selected channel in a specific player widget.
 * @param {string} widgetId - The ID of the target player-placeholder.
 * @param {object} channel - The channel object with id, name, and url.
 * @param {HTMLElement} gridstackItemContentEl - The player widget's actual content container (.grid-stack-item-content).
 */
function playChannelInWidget(widgetId, channel, gridstackItemContentEl) {
    if (!gridstackItemContentEl) return;

    stopAndCleanupPlayer(widgetId, false);

    const videoEl = gridstackItemContentEl.querySelector('video');
    const playerPlaceholderEl = gridstackItemContentEl.querySelector(`.player-placeholder[id="${widgetId}"]`);
    const titleEl = gridstackItemContentEl.querySelector('.player-header-title');

    titleEl.textContent = channel.name;
    gridstackItemContentEl.dataset.channelId = channel.id;
    gridstackItemContentEl.dataset.channelLogo = channel.logo;
    gridstackItemContentEl.dataset.channelName = channel.name;

    videoEl.classList.remove('hidden');
    if (playerPlaceholderEl) {
        playerPlaceholderEl.classList.add('hidden');
    }

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
            stopAndCleanupPlayer(widgetId, true);
        });

        setActivePlayer(widgetId);

    } else {
        showNotification('Your browser does not support Media Source Extensions (MSE).', true);
    }
}

/**
 * Stops the stream and cleans up resources for a specific player widget.
 * @param {string} widgetId - The ID of the player-placeholder.
 * @param {boolean} resetUI - If true, resets the widget's UI to the placeholder state.
 */
function stopAndCleanupPlayer(widgetId, resetUI = true) {
    if (players.has(widgetId)) {
        const player = players.get(widgetId);
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
        players.delete(widgetId);
        console.log(`[MultiView] Player destroyed for widget ${widgetId}`);
    }

    if (resetUI) {
        const playerPlaceholderEl = document.getElementById(widgetId);
        const widgetContentEl = playerPlaceholderEl ? playerPlaceholderEl.closest('.grid-stack-item-content') : null;

        if (widgetContentEl) {
            const videoEl = widgetContentEl.querySelector('video');
            
            videoEl.src = "";
            videoEl.removeAttribute('src');
            videoEl.load();
            videoEl.classList.add('hidden');
            
            if (playerPlaceholderEl) {
                playerPlaceholderEl.classList.remove('hidden');
            }
            widgetContentEl.querySelector('.player-header-title').textContent = 'No Channel';
            
            widgetContentEl.dataset.channelId = '';
            widgetContentEl.dataset.channelLogo = '';
            widgetContentEl.dataset.channelName = '';
        }
    }
}


/**
 * Populates the channel selector modal with available channels based on the selected filter.
 */
export function populateChannelSelector() {
    const listEl = UIElements.channelSelectorList;
    const filter = UIElements.multiviewChannelFilter.value;
    const searchTerm = UIElements.channelSelectorSearch.value.trim().toLowerCase();
    if (!listEl) return;
    
    let channelsToDisplay = [];

    if (filter === 'favorites') {
        const favoriteIds = new Set(guideState.settings.favorites || []);
        channelsToDisplay = guideState.channels.filter(ch => favoriteIds.has(ch.id));
    } else if (filter === 'recents') {
        const recentIds = guideState.settings.recentChannels || [];
        channelsToDisplay = recentIds.map(id => guideState.channels.find(ch => ch.id === id)).filter(Boolean);
    } else {
        channelsToDisplay = [...guideState.channels];
    }
    
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

    const layoutData = grid.save(false).map(w => ({
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        id: w.el.querySelector('.player-placeholder')?.id || w.id
    }));

    const res = await apiFetch('/api/multiview/layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, layout_data: layoutData }),
    });

    if (res && res.ok) {
        showNotification('Layout saved successfully!');
        closeModal(UIElements.saveLayoutModal);
        UIElements.saveLayoutForm.reset();
        loadLayouts();
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
    
    showConfirm(
        `Load '${layout.name}'?`,
        "This will stop all current streams and load the selected layout. Are you sure?",
        () => {
            cleanupMultiView();
            grid.batchUpdate();
            try {
                layout.layout_data.forEach(widgetData => {
                    addPlayerWidget(null, widgetData);
                });
            } finally {
                grid.commit();
            }
        }
    );
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
            loadLayouts();
        }
    });
}
