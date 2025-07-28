/**
 * multiViewPlayer.js
 * Manages multi-channel video playback, layout, and controls.
 */

import { UIElements, appState, guideState } from './state.js';
import { showNotification } from './ui.js';
import { makePlayerResizable } from './ui.js'; // Re-using adapted resize function

// Sample channels for demonstration. In a real scenario, you'd integrate with your M3U data.
const SAMPLE_CHANNELS = [
    { name: "Sample Channel 1 (BBC)", url: "https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8" },
    { name: "Sample Channel 2 (Al Jazeera)", url: "https://live-hls-web-aljazeera.akamaized.net/hls/live/2026858/aljazeera_ar/index.m3u8" },
    { name: "Sample Channel 3 (NASA TV)", url: "https://nasa-i.akamaihd.net/hls/live/253381/NASA-NTV1-Public/master_f_SUBS_v_U.m3u8" },
    { name: "Sample Channel 4 (France 24)", url: "https://static.france24.com/live/F24_EN_LIVE_HLS/live_hls.m3u8" },
    { name: "Sample Channel 5 (Open Source)", url: "https://dge04f7f573f0.cloudfront.net/out/v1/a29e847c0b0a430b80f805a5d21a57e3/index.m3u8" },
    { name: "Sample Channel 6 (Big Buck Bunny)", url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
];

let nextSampleChannelIndex = 0; // To cycle through sample channels

/**
 * Represents a single multi-view player slot.
 * Stores its DOM elements, mpegts.js instance, and current channel data.
 */
class MultiPlayerSlot {
    constructor(id, containerEl, videoEl, channelNameEl, volumeSliderEl, volumeToggleBtn, fullscreenBtn, closeBtn, changeChannelBtn) {
        this.id = id;
        this.containerEl = containerEl;
        this.videoEl = videoEl;
        this.channelNameEl = channelNameEl;
        this.volumeSliderEl = volumeSliderEl;
        this.volumeToggleBtn = volumeToggleBtn;
        this.fullscreenBtn = fullscreenBtn;
        this.closeBtn = closeBtn;
        this.changeChannelBtn = changeChannelBtn;

        this.player = null; // mpegts.js instance
        this.currentChannel = null;
        this.isMuted = false; // Track mute state for toggle button

        this.setupEventListeners();
        // Restore previous volume if saved
        const savedVolume = localStorage.getItem(`multiPlayerVolume_${this.id}`);
        if (savedVolume !== null) {
            this.videoEl.volume = parseFloat(savedVolume);
            this.volumeSliderEl.value = savedVolume;
            this.updateMuteButtonIcon(); // Set initial mute icon based on volume
        } else {
            this.videoEl.volume = 0.5; // Default volume
            this.volumeSliderEl.value = 0.5;
        }
    }

    setupEventListeners() {
        this.volumeSliderEl.addEventListener('input', () => this.setVolume(this.volumeSliderEl.value));
        this.volumeToggleBtn.addEventListener('click', () => this.toggleMute());
        this.fullscreenBtn.addEventListener('click', () => this.toggleFullScreen());
        this.closeBtn.addEventListener('click', () => this.stopAndClose());
        this.changeChannelBtn.addEventListener('click', () => this.promptChangeChannel());

        this.videoEl.addEventListener('volumechange', () => {
            localStorage.setItem(`multiPlayerVolume_${this.id}`, this.videoEl.volume);
            this.updateMuteButtonIcon();
        });

        // Add event listener for when the player slot is clicked to make it active
        this.containerEl.addEventListener('click', () => setActivePlayerSlot(this.id));
    }

    setVolume(volume) {
        this.videoEl.volume = parseFloat(volume);
        this.isMuted = this.videoEl.volume === 0;
        this.videoEl.muted = this.isMuted; // Ensure HTMLMediaElement.muted also reflects
        this.updateMuteButtonIcon();
    }

    toggleMute() {
        if (this.videoEl.muted) {
            this.videoEl.muted = false;
            // Restore previous volume if it was explicitly muted via the button, otherwise set to 0.5
            this.videoEl.volume = parseFloat(localStorage.getItem(`multiPlayerVolume_${this.id}`) || 0.5);
            if (this.videoEl.volume === 0) { // If restored volume is still 0, set a default audible level
                this.videoEl.volume = 0.5;
            }
        } else {
            this.videoEl.muted = true;
        }
        this.isMuted = this.videoEl.muted;
        this.updateMuteButtonIcon();
    }

    updateMuteButtonIcon() {
        // SVG for unmuted
        const unmutedSvg = `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.616 5.38a1 1 0 010 1.415 4.004 4.004 0 000 5.657 1 1 0 01-1.414 1.414 6.004 6.004 0 010-8.486 1 1 0 011.414 1.415z" clip-rule="evenodd"></path></svg>`;
        // SVG for muted
        const mutedSvg = `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM13.293 7.293a1 1 0 011.414 0L17 9.586l1.293-1.293a1 1 0 111.414 1.414L18.414 11l1.293 1.293a1 1 0 01-1.414 1.414L17 12.414l-1.293 1.293a1 1 0 01-1.414-1.414L15.586 11l-1.293-1.293a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>`;

        if (this.videoEl.muted || this.videoEl.volume === 0) {
            this.volumeToggleBtn.innerHTML = mutedSvg;
        } else {
            this.volumeToggleBtn.innerHTML = unmutedSvg;
        }
    }

    toggleFullScreen() {
        if (this.videoEl.requestFullscreen) {
            this.videoEl.requestFullscreen();
        } else if (this.videoEl.webkitRequestFullscreen) { /* Safari */
            this.videoEl.webkitRequestFullscreen();
        } else if (this.videoEl.msRequestFullscreen) { /* IE11 */
            this.videoEl.msRequestFullscreen();
        } else {
            showNotification("Fullscreen not supported by your browser.", false);
        }
    }

    async playChannel(url, name) {
        if (this.player) {
            this.player.destroy();
        }

        this.currentChannel = { url, name };
        this.channelNameEl.textContent = name;

        if (!mpegts.isSupported()) {
            showNotification('Your browser does not support Media Source Extensions (MSE).', true);
            return;
        }

        // For this mock, we'll use a direct stream URL.
        // In a real implementation, you'd construct the stream URL with profile/user agent
        // as done in the existing player.js for the single player:
        // const profileId = guideState.settings.activeStreamProfileId;
        // const userAgentId = guideState.settings.activeUserAgentId;
        // const profile = (guideState.settings.streamProfiles || []).find(p => p.id === profileId);
        // const streamUrlToPlay = profile.command === 'redirect' ? url : `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;
        const streamUrlToPlay = url; // Simplified for mock for easier testing

        this.player = mpegts.createPlayer({
            type: 'mse',
            isLive: true,
            url: streamUrlToPlay
        });

        this.player.attachMediaElement(this.videoEl);
        this.player.load();

        try {
            await this.videoEl.play();
            // Ensure this player's volume is audible by unmuting if it was
            if (this.videoEl.muted) {
                this.videoEl.muted = false;
            }
            if (this.videoEl.volume === 0) {
                this.videoEl.volume = parseFloat(localStorage.getItem(`multiPlayerVolume_${this.id}`) || 0.5);
            }
        } catch (err) {
            console.error(`Error playing stream in slot ${this.id}:`, err);
            showNotification(`Could not play stream for ${name}. Try another channel.`, true);
            this.stop(); // Stop gracefully on error
            this.channelNameEl.textContent = "Error playing channel";
        }
    }

    stop() {
        if (this.player) {
            this.player.unload();
            this.player.detachMediaElement();
            this.player.destroy();
            this.player = null;
        }
        this.videoEl.src = ""; // Clear video source
        this.videoEl.removeAttribute('src');
        this.videoEl.load(); // Load to apply changes and clear buffered data
        this.currentChannel = null;
        this.channelNameEl.textContent = "No Channel Selected";
    }

    stopAndClose() {
        this.stop();
        this.containerEl.remove(); // Remove player from DOM
        appState.multiPlayers = appState.multiPlayers.filter(p => p.id !== this.id); // Remove from state
        updateMultiViewPlaceholder(); // Update placeholder visibility
    }

    promptChangeChannel() {
        // In a real app, this would open a channel picker modal,
        // likely using your existing M3U channel data.
        // For the mock, we'll just cycle through sample channels.
        const selectedChannel = SAMPLE_CHANNELS[nextSampleChannelIndex];
        nextSampleChannelIndex = (nextSampleChannelIndex + 1) % SAMPLE_CHANNELS.length;

        if (selectedChannel) {
            this.playChannel(selectedChannel.url, selectedChannel.name);
            showNotification(`Playing: ${selectedChannel.name}`);
        } else {
            showNotification('No more sample channels to play!', false);
        }
    }
}

/**
 * Adds a new player slot to the multi-view grid.
 */
export const addPlayerSlot = () => {
    if (appState.multiPlayers.length >= 6) { // Limit to 6 players for performance/layout
        showNotification('Maximum of 6 players allowed in multi-view.', false);
        return;
    }

    const templateContent = UIElements.multiPlayerTemplate.content;
    const playerSlotEl = templateContent.cloneNode(true).firstElementChild;
    const id = `player-slot-${Date.now()}`;
    playerSlotEl.id = id;

    const videoEl = playerSlotEl.querySelector('.multi-video-element');
    const channelNameEl = playerSlotEl.querySelector('.channel-name');
    const volumeSliderEl = playerSlotEl.querySelector('.volume-slider');
    const volumeToggleBtn = playerSlotEl.querySelector('.volume-toggle-btn');
    const fullscreenBtn = playerSlotEl.querySelector('.fullscreen-btn');
    const closeBtn = playerSlotEl.querySelector('.close-player-btn');
    const changeChannelBtn = playerSlotEl.querySelector('.change-channel-btn');
    const resizeHandle = playerSlotEl.querySelector('.player-resize-handle');

    const newPlayer = new MultiPlayerSlot(
        id, playerSlotEl, videoEl, channelNameEl, volumeSliderEl, volumeToggleBtn, fullscreenBtn, closeBtn, changeChannelBtn
    );
    appState.multiPlayers.push(newPlayer);
    UIElements.multiViewGrid.appendChild(playerSlotEl);

    makePlayerResizable(resizeHandle, playerSlotEl);
    updateMultiViewPlaceholder();
    // Automatically make the newly added player the active one
    setActivePlayerSlot(id);
};

/**
 * Removes the last added player slot.
 */
export const removeLastPlayerSlot = () => {
    if (appState.multiPlayers.length === 0) {
        showNotification('No players to remove.', false);
        return;
    }
    const lastPlayer = appState.multiPlayers.pop();
    if (lastPlayer) {
        lastPlayer.stopAndClose(); // This also removes it from DOM
        showNotification('Last player removed.');
        updateMultiViewPlaceholder();
    }
    // Clear active player if it was the one removed
    if (!appState.multiPlayers.some(p => p.containerEl.classList.contains('active-player'))) {
        if (appState.multiPlayers.length > 0) {
            setActivePlayerSlot(appState.multiPlayers[0].id); // Set first player as active
        }
    }
};

/**
 * Sets a player slot as the active one, adding a highlight and ensuring its volume is adjusted.
 * @param {string} id - The ID of the player slot to activate.
 */
export const setActivePlayerSlot = (id) => {
    appState.multiPlayers.forEach(player => {
        if (player.id === id) {
            player.containerEl.classList.add('active-player');
            // Ensure this player's volume is audible by unmuting if it was muted
            if (player.videoEl.muted) {
                player.videoEl.muted = false;
            }
            // If volume was 0, restore it to a default audible level (or last saved)
            if (player.videoEl.volume === 0) {
                 player.videoEl.volume = parseFloat(localStorage.getItem(`multiPlayerVolume_${player.id}`) || 0.5);
            }
            player.videoEl.focus(); // Give focus to the active video element
        } else {
            player.containerEl.classList.remove('active-player');
            // Optionally: Mute other players when one is active
            // player.videoEl.muted = true;
            // player.updateMuteButtonIcon(); // Update their mute icon
        }
        player.updateMuteButtonIcon(); // Ensure mute icon is correct after activation change
    });
};

/**
 * Applies a predefined grid layout to the multi-view container.
 * @param {string} layoutName - The name of the layout (e.g., 'auto', '2x2', '1plus3').
 */
export const applyLayout = (layoutName) => {
    const grid = UIElements.multiViewGrid;
    
    // Remove existing layout classes
    grid.classList.remove('layout-2x2', 'layout-1plus3'); 
    
    // Reset individual player slot styles that might interfere with new layouts
    appState.multiPlayers.forEach(player => {
        player.containerEl.style.gridColumn = '';
        player.containerEl.style.gridRow = '';
    });

    if (layoutName === '2x2') {
        grid.classList.add('layout-2x2');
    } else if (layoutName === '1plus3') {
        grid.classList.add('layout-1plus3');
        // Apply specific styles for the first player (large one)
        if (appState.multiPlayers.length > 0) {
            appState.multiPlayers[0].containerEl.style.gridColumn = 'span 2';
            appState.multiPlayers[0].containerEl.style.gridRow = 'span 2';
        }
    }
    // 'auto' layout implies no specific class, lets grid handle it responsive
    showNotification(`Layout set to ${layoutName}.`);
};

/**
 * Updates the visibility of the multi-view placeholder message.
 */
const updateMultiViewPlaceholder = () => {
    if (UIElements.multiViewPlaceholder) {
        UIElements.multiViewPlaceholder.classList.toggle('hidden', appState.multiPlayers.length > 0);
    }
    // Update remove button state
    if (UIElements.removePlayerSlotBtn) {
        UIElements.removePlayerSlotBtn.disabled = appState.multiPlayers.length === 0;
    }
};

/**
 * Sets up event listeners for multi-view page controls.
 */
export function setupMultiViewEventListeners() {
    UIElements.addPlayerSlotBtn?.addEventListener('click', addPlayerSlot);
    UIElements.removePlayerSlotBtn?.addEventListener('click', removeLastPlayerSlot);
    UIElements.layoutAutoBtn?.addEventListener('click', () => applyLayout('auto'));
    UIElements.layout2x2Btn?.addEventListener('click', () => applyLayout('2x2'));
    UIElements.layout1plus3Btn?.addEventListener('click', () => applyLayout('1plus3'));

    // Initial check for placeholder visibility
    updateMultiViewPlaceholder();
}
