/**
 * multiview.js
 * Manages all functionality for the Multi-View page.
 * Uses Gridstack.js for the draggable and resizable player grid.
 */

import { appState, guideState, UIElements } from './state.js';
import { apiFetch, stopStream } from './api.js';
import { showNotification, openModal, closeModal, showConfirm } from './ui.js';
import { ICONS } from './icons.js';

let grid;
const players = new Map();
const playerUrls = new Map();
let activePlayerId = null;
let channelSelectorCallback = null;
let lastLayoutBeforeHide = null; // To store layout when tab is hidden

const MAX_PLAYERS = 9;

/**
 * NEW: A less aggressive cleanup function specifically for when the tab is hidden.
 * It pauses players and stops server streams without destroying the player instances,
 * which can cause race conditions with the browser's media suspension.
 */
async function pauseAndClearAllPlayers() {
    // 1. Save the layout for potential restoration
    if (grid) {
        const gridItems = grid.getGridItems();
        lastLayoutBeforeHide = gridItems.map(item => {
            const node = item.gridstackNode;
            const placeholder = item.querySelector('.player-placeholder');
            return {
                x: node.x,
                y: node.y,
                w: node.w,
                h: node.h,
                id: placeholder?.id || node.id,
                channelId: placeholder?.dataset.channelId || null
            };
        });
    }

    // 2. Stop server-side streams and pause client-side players
    const stopPromises = [];
    for (const [widgetId, player] of players.entries()) {
        // Stop the server-side ffmpeg process
        if (playerUrls.has(widgetId)) {
            const originalUrl = playerUrls.get(widgetId);
            console.log(`[MultiView] Tab Hide: Sending stop request for widget ${widgetId}, URL: ${originalUrl}`);
            stopPromises.push(stopStream(originalUrl));
        }

        // Safely detach and pause the client-side player
        try {
            player.pause();
            player.detachMediaElement();
        } catch (e) {
            console.warn(`[MultiView] Tab Hide: Error pausing player for widget ${widgetId}. It might already be detached.`, e);
        }
    }
    
    // Wait for all server stop requests to be sent
    await Promise.all(stopPromises);
    console.log('[MultiView] Tab Hide: All server streams have been requested to stop.');

    // 3. Clear the state and UI
    players.clear();
    playerUrls.clear();
    activePlayerId = null;
    if (grid) {
        grid.removeAll(); // This removes the widgets from the view
    }
}


/**
 * Handles the visibility change of the tab to prevent crashes.
 */
const handleVisibilityChange = async () => {
    if (document.hidden) {
        if (isMultiViewActive()) {
            console.log('[MultiView] Tab hidden. Pausing all streams and cleaning up UI.');
            // Use the new, safer cleanup for tab switching.
            await pauseAndClearAllPlayers(); 
        }
    } else {
        if (lastLayoutBeforeHide) {
            console.log('[MultiView] Tab visible. Offering to restore previous session.');
            showConfirm(
                'Restore Session?',
                'Would you like to restore your previous Multi-View session?',
                () => {
                    if (lastLayoutBeforeHide) {
                        grid.batchUpdate();
                        try {
                            lastLayoutBeforeHide.forEach(widgetData => {
                                const channel = widgetData.channelId ? guideState.channels.find(c => c.id === widgetData.channelId) : null;
                                addPlayerWidget(channel, widgetData);
                            });
                        } finally {
                            grid.commit();
                            lastLayoutBeforeHide = null; // Clear after restoring
                        }
                    }
                },
                () => {
                    lastLayoutBeforeHide = null; // Clear if user cancels
                }
            );
        }
    }
};


/**
 * Initializes the Multi-View page, sets up the grid and event listeners.
 */
export function initMultiView() {
    // Add the visibility change listener when the page is active.
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (grid) {
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
        resizable: { handles: 'e, se, s, sw, w' }
    };
    grid = GridStack.init(options, '#multiview-grid');

    updateGridBackground();
    grid.on('change', updateGridBackground);

    setupMultiViewEventListeners();
    loadLayouts();
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
 */
export async function cleanupMultiView() {
    // Remove the visibility change listener when leaving the page.
    document.removeEventListener('visibilitychange', handleVisibilityChange);

    if (grid) {
        console.log('[MultiView] Cleaning up all players and grid.');
        const stopPromises = Array.from(players.keys()).map(widgetId => stopAndCleanupPlayer(widgetId, true));
        await Promise.all(stopPromises);
        console.log('[MultiView] All streams have been stopped and players cleaned up.');
        grid.removeAll();
    }
    players.clear();
    playerUrls.clear();
    activePlayerId = null;
    channelSelectorCallback = null;
    lastLayoutBeforeHide = null; // A full cleanup should clear this
    console.log('[MultiView] Cleanup complete.');
}

/**
 * Adjusts the grid's background pattern size.
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
    UIElements.layoutBtnAuto.addEventListener('click', () => applyPresetLayout('auto'));
    UIElements.layoutBtn2x2.addEventListener('click', () => applyPresetLayout('2x2'));
    UIElements.layoutBtn1x3.addEventListener('click', () => applyPresetLayout('1x3'));
    UIElements.multiviewSaveLayoutBtn.addEventListener('click', () => openModal(UIElements.saveLayoutModal));
    UIElements.multiviewLoadLayoutBtn.addEventListener('click', loadSelectedLayout);
    UIElements.multiviewDeleteLayoutBtn.addEventListener('click', deleteLayout);
    UIElements.saveLayoutForm.addEventListener('submit', saveLayout);
    UIElements.saveLayoutCancelBtn.addEventListener('click', () => closeModal(UIElements.saveLayoutModal));
}

/**
 * Handles the channel selection logic for the Multi-View page.
 * @param {HTMLElement} channelItem - The clicked channel item element.
 */
export function handleMultiViewChannelClick(channelItem) {
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
                <button class="select-channel-btn" title="Select Channel">${ICONS.selectChannel}</button>
                <button class="mute-btn" title="Mute">${ICONS.unmute}</button>
                <input type="range" min="0" max="1" step="0.05" value="0.5" class="volume-slider">
                <button class="fullscreen-btn" title="Fullscreen">${ICONS.fullscreen}</button>
                <button class="stop-btn" title="Stop Channel">${ICONS.stop}</button>
                <button class="remove-widget-btn" title="Remove Player">${ICONS.removeWidget}</button>
            </div>
        </div>
        <div class="player-body">
            <div class="player-placeholder" id="${widgetId}" data-channel-id="">
                ${ICONS.placeholderPlay}
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
async function removeLastPlayer() {
    const items = grid.getGridItems();
    if (items.length > 0) {
        const sortedItems = items.sort((a, b) => {
            const timeA = parseInt((a.gridstackNode.id || '0').split('-')[1]);
            const timeB = parseInt((b.gridstackNode.id || '0').split('-')[1]);
            return timeA - timeB;
        });
        const lastItem = sortedItems[sortedItems.length - 1];
        if (lastItem) {
            const playerPlaceholder = lastItem.querySelector('.player-placeholder');
            const widgetId = playerPlaceholder ? playerPlaceholder.id : lastItem.gridstackNode.id;
            
            await stopAndCleanupPlayer(widgetId);
            grid.removeWidget(lastItem);
            console.log(`[MultiView] Removed last player: ${widgetId}`);
        }
    } else {
        showNotification("No players to remove.", false);
    }
}


/**
 * Applies a predefined layout to the player grid.
 * @param {'auto'|'2x2'|'1x3'} layoutName - The name of the layout to apply.
 */
function applyPresetLayout(layoutName) {
    const numPlayers = grid.getGridItems().length;

    if (layoutName === 'auto' && numPlayers === 0) {
        addPlayerWidget();
        return;
    }

    const createLayout = async () => {
        await cleanupMultiView();

        let layout = [];

        if (layoutName === 'auto') {
            let cols, rows;
            if (numPlayers <= 1) { cols = 1; rows = 1; }
            else if (numPlayers === 2) { cols = 2; rows = 1; }
            else if (numPlayers === 3) { cols = 3; rows = 1; }
            else if (numPlayers === 4) { cols = 2; rows = 2; }
            else if (numPlayers >= 5 && numPlayers <= 6) { cols = 3; rows = 2; }
            else { cols = 3; rows = 3; }

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
             const largeHeight = 9;
             const smallHeight = 3;
             layout = [
                { x: 0, y: 0, w: 8, h: largeHeight },
                { x: 8, y: 0, w: 4, h: smallHeight },
                { x: 8, y: smallHeight, w: 4, h: smallHeight },
                { x: 8, y: smallHeight * 2, w: 4, h: smallHeight }
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

    if (numPlayers > 0) {
        showConfirm(
            `Apply '${layoutName}' Layout?`,
            "This will stop all current streams and apply the new layout with empty players. Are you sure?",
            createLayout
        );
    } else {
        createLayout();
    }
}

/**
 * Attaches event listeners to the controls within a player widget.
 * @param {HTMLElement} widgetContentEl - The widget's .grid-stack-item-content element.
 * @param {string} widgetId - The unique ID of the widget.
 */
function attachWidgetEventListeners(widgetContentEl, widgetId) {
    const playerPlaceholderEl = widgetContentEl.querySelector(`.player-placeholder[id="${widgetId}"]`);
    const videoEl = widgetContentEl.querySelector('video');
    const gridStackItem = widgetContentEl.closest('.grid-stack-item');

    const openSelector = () => {
        if (document.body.dataset.channelSelectorContext) {
            delete document.body.dataset.channelSelectorContext;
        }
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
    
    const muteBtn = widgetContentEl.querySelector('.mute-btn');
    muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        videoEl.muted = !videoEl.muted;
        muteBtn.innerHTML = videoEl.muted ? ICONS.mute : ICONS.unmute;
    });

    widgetContentEl.querySelector('.volume-slider').addEventListener('input', (e) => {
        e.stopPropagation();
        videoEl.volume = parseFloat(e.target.value);
        if (videoEl.volume > 0) {
            videoEl.muted = false;
            muteBtn.innerHTML = ICONS.unmute;
        }
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
 * @param {string} widgetId - The ID of the player to set as active.
 */
function setActivePlayer(widgetId) {
    if (activePlayerId === widgetId) return;

    const oldActivePlaceholder = document.getElementById(activePlayerId);
    const oldActiveWidgetContent = oldActivePlaceholder ? oldActivePlaceholder.closest('.grid-stack-item-content') : null;
    
    if (oldActiveWidgetContent) {
        oldActiveWidgetContent.classList.remove('active-player');
        const oldVideo = oldActiveWidgetContent.querySelector('video');
        if (oldVideo) oldVideo.muted = true;
        const oldMuteBtn = oldActiveWidgetContent.querySelector('.mute-btn');
        if (oldMuteBtn) oldMuteBtn.innerHTML = ICONS.mute;
    }
    
    const newActivePlaceholder = document.getElementById(widgetId);
    const newActiveWidgetContent = newActivePlaceholder ? newActivePlaceholder.closest('.grid-stack-item-content') : null;

    if (newActiveWidgetContent) {
        newActiveWidgetContent.classList.add('active-player');
        const videoEl = newActiveWidgetContent.querySelector('video');
        if (videoEl) {
            videoEl.muted = false;
            const newMuteBtn = newActiveWidgetContent.querySelector('.mute-btn');
            if (newMuteBtn) newMuteBtn.innerHTML = ICONS.unmute;
        }
    }
    activePlayerId = widgetId;
}

/**
 * Starts playing a selected channel in a specific player widget.
 * @param {string} widgetId - The ID of the target player.
 * @param {object} channel - The channel object with id, name, and url.
 * @param {HTMLElement} gridstackItemContentEl - The player widget's content container.
 */
function playChannelInWidget(widgetId, channel, gridstackItemContentEl) {
    if (!gridstackItemContentEl) return;

    stopAndCleanupPlayer(widgetId, false);

    const videoEl = gridstackItemContentEl.querySelector('video');
    const playerPlaceholderEl = gridstackItemContentEl.querySelector(`.player-placeholder[id="${widgetId}"]`);
    const titleEl = gridstackItemContentEl.querySelector('.player-header-title');

    titleEl.textContent = channel.name;
    if (playerPlaceholderEl) {
        playerPlaceholderEl.dataset.channelId = channel.id;
    }

    playerUrls.set(widgetId, channel.url);
    console.log(`[MultiView] Stored URL for widget ${widgetId}: ${channel.url}`);


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
 * @param {string} widgetId - The ID of the player.
 * @param {boolean} resetUI - If true, resets the widget's UI to the placeholder state.
 */
async function stopAndCleanupPlayer(widgetId, resetUI = true) {
    if (playerUrls.has(widgetId)) {
        const originalUrl = playerUrls.get(widgetId);
        console.log(`[MultiView] Sending stop request for widget ${widgetId}, URL: ${originalUrl}`);
        await stopStream(originalUrl);
        playerUrls.delete(widgetId);
    }

    if (players.has(widgetId)) {
        const player = players.get(widgetId);
        try {
            player.pause();
            player.unload();
            player.detachMediaElement();
            player.destroy();
        } catch (e) {
            console.warn(`[MultiView] Error during full cleanup of player for widget ${widgetId}:`, e.message);
        }
        players.delete(widgetId);
        console.log(`[MultiView] Client-side player destroyed for widget ${widgetId}`);
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
                playerPlaceholderEl.dataset.channelId = '';
            }
            widgetContentEl.querySelector('.player-header-title').textContent = 'No Channel';
        }
    }
}


/**
 * Populates the channel selector modal.
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
 * Fetches saved layouts from the server.
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
 * Populates the 'Saved Layouts' dropdown.
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
 * Saves the current grid layout.
 * @param {Event} e - The form submission event.
 */
async function saveLayout(e) {
    e.preventDefault();
    const name = UIElements.saveLayoutName.value.trim();
    if (!name) {
        showNotification('Layout name cannot be empty.', true);
        return;
    }

    const gridItems = grid.getGridItems();
    if (gridItems.length === 0) {
        showNotification("Cannot save an empty layout.", true);
        return;
    }

    const layoutData = gridItems.map(item => {
        const node = item.gridstackNode;
        const placeholder = item.querySelector('.player-placeholder');
        return {
            x: node.x,
            y: node.y,
            w: node.w,
            h: node.h,
            id: placeholder?.id || node.id,
            channelId: placeholder?.dataset.channelId || null
        };
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
        loadLayouts();
    }
}


/**
 * Loads a selected layout from the dropdown.
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
        async () => {
            await cleanupMultiView();
            grid.batchUpdate();
            try {
                layout.layout_data.forEach(widgetData => {
                    const channel = widgetData.channelId ? guideState.channels.find(c => c.id === widgetData.channelId) : null;
                    addPlayerWidget(channel, widgetData);
                });
            } finally {
                grid.commit();
            }
        }
    );
}


/**
 * Deletes the currently selected layout.
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
