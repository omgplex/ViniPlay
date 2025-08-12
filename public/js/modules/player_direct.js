/**
 * player_direct.js
 * * Manages the functionality for the direct stream player page.
 * This has been updated to include recent links, a stop button, direct play vs. proxy,
 * and a logging console for better error feedback.
 */

import { UIElements, guideState } from './state.js';
import { showNotification } from './ui.js';
import { saveUserSetting, stopDirectStream } from './api.js';

let directPlayer = null; // To hold the mpegts.js instance
const MAX_RECENT_LINKS = 10;

// --- VINI-FIX: Store event listener references for proper cleanup ---
const playerEventListeners = {
    onError: null,
    onMediaInfo: null,
    onStatisticsInfo: null,
    onLoadingComplete: null
};

// --- VINI-FIX: Store video element event listener references ---
const videoEventListeners = {
    onPlaying: null,
    onWaiting: null,
    onStalled: null,
    onError: null
};


// --- Helper Functions ---

/**
 * Logs a message to the on-screen player console.
 * @param {string} message - The message to display.
 * @param {boolean} isError - If true, styles the message as an error.
 */
function logToPlayerConsole(message, isError = false) {
    const consoleEl = UIElements.directPlayerConsole;
    if (!consoleEl) return;

    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('p');
    const sanitizedMessage = document.createElement('span');
    sanitizedMessage.textContent = message;

    logEntry.innerHTML = `<span class="text-gray-500">${timestamp}:</span> <span class="${isError ? 'text-red-400' : 'text-gray-300'}">${sanitizedMessage.innerHTML}</span>`;
    
    consoleEl.appendChild(logEntry);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

/**
 * Retrieves the list of recent links from the central guideState object.
 * @returns {Array<string>} An array of URLs.
 */
function getRecentLinks() {
    return guideState.settings.recentDirectLinks || [];
}

/**
 * Saves the list of recent links to the server via the API.
 * @param {Array<string>} links - The array of URLs to save.
 */
function saveRecentLinks(links) {
    guideState.settings.recentDirectLinks = links;
    saveUserSetting('recentDirectLinks', links);
}

/**
 * Adds a new URL to the recent links list.
 * @param {string} url - The URL to add.
 */
function addRecentLink(url) {
    let links = getRecentLinks();
    links = links.filter(link => link !== url);
    links.unshift(url);
    links = links.slice(0, MAX_RECENT_LINKS);
    saveRecentLinks(links);
}

/**
 * Renders the recent links table in the UI.
 */
function renderRecentLinks() {
    const links = getRecentLinks();
    const tbody = UIElements.recentLinksTbody;

    UIElements.noRecentLinksMessage.classList.toggle('hidden', links.length > 0);
    UIElements.recentLinksTableContainer.classList.toggle('hidden', links.length === 0);

    if (!tbody) return;
    tbody.innerHTML = links.map(link => `
        <tr>
            <td class="max-w-md truncate" title="${link}">
                <a href="#" class="replay-link text-blue-400 hover:underline" data-url="${link}">${link}</a>
            </td>
            <td class="text-right">
                <button class="action-btn delete-recent-link-btn p-1" title="Delete Link" data-url="${link}">
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                </button>
            </td>
        </tr>
    `).join('');
}

// --- Player Lifecycle Functions ---

/**
 * Initializes the Direct Player page.
 */
export function initDirectPlayer() {
    console.log('[DirectPlayer] Initializing Direct Player page.');
    if (directPlayer) {
        stopAndCleanupDirectPlayer();
    }
    if (UIElements.directPlayerForm) {
        UIElements.directPlayerForm.reset();
    }
    
    const savedDirectPlayState = guideState.settings.directPlayEnabled === true;
    UIElements.directPlayCheckbox.checked = savedDirectPlayState;

    renderRecentLinks();
}

/**
 * Stops the current stream and cleans up the mpegts.js player instance and UI.
 */
async function stopAndCleanupDirectPlayer() {
    logToPlayerConsole('Stop requested. Cleaning up player...');
    await stopDirectStream();

    if (directPlayer) {
        console.log('[DirectPlayer] Destroying direct player instance.');
        logToPlayerConsole('Destroying player instance.');
        try {
            // **VINI-FIX**: Reliably detach all event listeners before destroying.
            if (playerEventListeners.onError) directPlayer.off(mpegts.Events.ERROR, playerEventListeners.onError);
            if (playerEventListeners.onMediaInfo) directPlayer.off(mpegts.Events.MEDIA_INFO, playerEventListeners.onMediaInfo);
            if (playerEventListeners.onStatisticsInfo) directPlayer.off(mpegts.Events.STATISTICS_INFO, playerEventListeners.onStatisticsInfo);
            if (playerEventListeners.onLoadingComplete) directPlayer.off(mpegts.Events.LOADING_COMPLETE, playerEventListeners.onLoadingComplete);
            
            directPlayer.detachMediaElement();
            directPlayer.destroy();
        } catch (e) {
            console.warn('[DirectPlayer] Error during player.destroy():', e.message);
            logToPlayerConsole(`Error during player cleanup: ${e.message}`, true);
        }
        directPlayer = null;
    }

    if (UIElements.directVideoElement) {
        const videoEl = UIElements.directVideoElement;
        // **VINI-FIX**: Reliably remove video element listeners.
        if (videoEventListeners.onPlaying) videoEl.removeEventListener('playing', videoEventListeners.onPlaying);
        if (videoEventListeners.onWaiting) videoEl.removeEventListener('waiting', videoEventListeners.onWaiting);
        if (videoEventListeners.onStalled) videoEl.removeEventListener('stalled', videoEventListeners.onStalled);
        if (videoEventListeners.onError) videoEl.removeEventListener('error', videoEventListeners.onError);
        
        videoEl.pause();
        videoEl.src = "";
        videoEl.removeAttribute('src');
        videoEl.load();
    }

    UIElements.directPlayerContainer.classList.add('hidden');
    UIElements.directStopBtn.classList.add('hidden');
    UIElements.directPlayBtn.classList.remove('hidden');
    logToPlayerConsole('Player stopped and cleaned up.');
}

/**
 * Cleans up the direct player when navigating away from the tab.
 */
export async function cleanupDirectPlayer() {
    console.log('[DirectPlayer] Cleaning up direct player due to navigation.');
    await stopAndCleanupDirectPlayer();
}

/**
 * Checks if a stream is currently active.
 * @returns {boolean} True if a player instance exists.
 */
export function isDirectPlayerActive() {
    return !!directPlayer;
}

/**
 * Initializes mpegts.js and plays the provided stream URL.
 * @param {string} url The URL of the .ts or .m3u8 stream.
 */
async function playDirectStream(url) {
    await stopAndCleanupDirectPlayer();

    const consoleEl = UIElements.directPlayerConsole;
    if (consoleEl) consoleEl.innerHTML = '';
    UIElements.directPlayerConsoleContainer.classList.remove('hidden');
    logToPlayerConsole(`Attempting to play: ${url}`);

    const isDirectPlay = UIElements.directPlayCheckbox.checked;
    let streamUrlToPlay = url;

    if (!isDirectPlay) {
        logToPlayerConsole('Direct Play is OFF. Using server proxy.');
        const profileId = guideState.settings.activeStreamProfileId;
        const userAgentId = guideState.settings.activeUserAgentId;
        if (!profileId || !userAgentId) {
            const errorMsg = "Active stream profile or user agent not set. Please check settings.";
            logToPlayerConsole(errorMsg, true);
            showNotification(errorMsg, true);
            return;
        }
        streamUrlToPlay = `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;
        logToPlayerConsole(`Proxy URL constructed: ${streamUrlToPlay}`);
    } else {
        logToPlayerConsole('Direct Play is ON. Connecting directly to stream.');
    }

    addRecentLink(url);
    renderRecentLinks();

    if (mpegts.isSupported()) {
        try {
            const playerConfig = { type: 'mse', isLive: true, url: streamUrlToPlay };
            const featureConfig = { enableStashBuffer: false, lazyLoad: false, liveBufferLatencyChasing: true };
            
            logToPlayerConsole(`Creating mpegts.js player with config: ${JSON.stringify(playerConfig)}`);
            directPlayer = mpegts.createPlayer(playerConfig, featureConfig);

            UIElements.directPlayerContainer.classList.remove('hidden');
            UIElements.directStopBtn.classList.remove('hidden');
            UIElements.directPlayBtn.classList.add('hidden');
            
            // **VINI-FIX**: Define and store listener functions
            playerEventListeners.onError = (type, detail, info) => {
                console.error('[DirectPlayer] MPEGTS Error:', type, detail, info);
                let msg = `Player Error: ${type} - ${detail}.`;
                if (info && info.code) msg += ` (Code: ${info.code}, Msg: ${info.msg})`;
                logToPlayerConsole(msg, true);
                if (type === mpegts.ErrorTypes.NETWORK_ERROR) {
                    logToPlayerConsole("Stream terminated due to network error.", true);
                    stopAndCleanupDirectPlayer();
                }
            };
            playerEventListeners.onMediaInfo = (info) => logToPlayerConsole(`Media Info received: ${JSON.stringify(info)}`);
            playerEventListeners.onStatisticsInfo = (stats) => console.log('[DirectPlayer Stats]', stats);
            playerEventListeners.onLoadingComplete = () => {
                logToPlayerConsole('Warning: Loading complete event fired for a live stream. The source may have ended.', true);
                stopAndCleanupDirectPlayer();
            };

            // Attach player listeners
            directPlayer.on(mpegts.Events.ERROR, playerEventListeners.onError);
            directPlayer.on(mpegts.Events.MEDIA_INFO, playerEventListeners.onMediaInfo);
            directPlayer.on(mpegts.Events.STATISTICS_INFO, playerEventListeners.onStatisticsInfo);
            directPlayer.on(mpegts.Events.LOADING_COMPLETE, playerEventListeners.onLoadingComplete);

            const videoEl = UIElements.directVideoElement;
            // **VINI-FIX**: Define, store, and attach video element listeners
            videoEventListeners.onPlaying = () => logToPlayerConsole('Video Event: playing');
            videoEventListeners.onWaiting = () => logToPlayerConsole('Video Event: waiting (buffering)');
            videoEventListeners.onStalled = () => logToPlayerConsole('Video Event: stalled (network issue)', true);
            videoEventListeners.onError = () => logToPlayerConsole(`Video Element Error: Code ${videoEl.error.code}, Message: ${videoEl.error.message}`, true);
            
            videoEl.addEventListener('playing', videoEventListeners.onPlaying);
            videoEl.addEventListener('waiting', videoEventListeners.onWaiting);
            videoEl.addEventListener('stalled', videoEventListeners.onStalled);
            videoEl.addEventListener('error', videoEventListeners.onError);
            
            logToPlayerConsole('Attaching media element...');
            directPlayer.attachMediaElement(videoEl);
            
            logToPlayerConsole('Player instance created. Loading media...');
            directPlayer.load();

            logToPlayerConsole('Calling player.play()...');
            await directPlayer.play();
            logToPlayerConsole('player.play() promise resolved. Playback should be active.');

        } catch (err) {
            const errorMsg = `Could not play the stream. The format may be unsupported or the URL is invalid.`;
            console.error("[DirectPlayer] Player.play() caught an error:", err);
            logToPlayerConsole(`${errorMsg} (Details: ${err.message})`, true);
            showNotification(errorMsg, true);
            await stopAndCleanupDirectPlayer();
        }
    } else {
        const errorMsg = 'Your browser does not support the necessary technology to play this stream (Media Source Extensions).';
        logToPlayerConsole(errorMsg, true);
        showNotification(errorMsg, true);
    }
}

// --- Event Listener Setup ---

/**
 * Sets up the event listeners for the Direct Player page controls.
 */
export function setupDirectPlayerEventListeners() {
    UIElements.directPlayerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const streamUrl = UIElements.directStreamUrl.value.trim();
        if (streamUrl) {
            await playDirectStream(streamUrl);
        } else {
            showNotification('Please enter a stream URL.', true);
        }
    });

    UIElements.directStopBtn.addEventListener('click', stopAndCleanupDirectPlayer);
    
    UIElements.directPlayCheckbox.addEventListener('change', () => {
        const isEnabled = UIElements.directPlayCheckbox.checked;
        guideState.settings.directPlayEnabled = isEnabled;
        saveUserSetting('directPlayEnabled', isEnabled);
        showNotification(`Direct Play ${isEnabled ? 'enabled' : 'disabled'}.`, false, 2000);
    });

    UIElements.recentLinksTbody.addEventListener('click', async (e) => {
        const replayLink = e.target.closest('.replay-link');
        const deleteBtn = e.target.closest('.delete-recent-link-btn');
        
        if (replayLink) {
            e.preventDefault();
            const url = replayLink.dataset.url;
            UIElements.directStreamUrl.value = url;
            await playDirectStream(url);
        } else if (deleteBtn) {
            const urlToDelete = deleteBtn.dataset.url;
            let links = getRecentLinks();
            links = links.filter(link => link !== urlToDelete);
            saveRecentLinks(links);
            renderRecentLinks();
            showNotification('Link removed from recents.');
        }
    });
}
