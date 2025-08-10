/**
 * player_direct.js
 * * Manages the functionality for the direct stream player page.
 * This has been updated to include recent links, a stop button, direct play vs. proxy,
 * and a logging console for better error feedback.
 */

import { UIElements, guideState } from './state.js';
import { showNotification } from './ui.js';

let directPlayer = null; // To hold the mpegts.js instance
const RECENT_LINKS_KEY = 'viniplay_recent_direct_links';
const MAX_RECENT_LINKS = 10;

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
    logEntry.innerHTML = `<span class="text-gray-500">${timestamp}:</span> <span class="${isError ? 'text-red-400' : 'text-gray-300'}">${message}</span>`;
    
    consoleEl.appendChild(logEntry);
    consoleEl.scrollTop = consoleEl.scrollHeight; // Auto-scroll to the bottom
}

/**
 * Retrieves the list of recent links from localStorage.
 * @returns {Array<string>} An array of URLs.
 */
function getRecentLinks() {
    try {
        const links = localStorage.getItem(RECENT_LINKS_KEY);
        return links ? JSON.parse(links) : [];
    } catch (e) {
        console.error('[DirectPlayer] Could not parse recent links from localStorage:', e);
        return [];
    }
}

/**
 * Saves the list of recent links to localStorage.
 * @param {Array<string>} links - The array of URLs to save.
 */
function saveRecentLinks(links) {
    try {
        localStorage.setItem(RECENT_LINKS_KEY, JSON.stringify(links));
    } catch (e) {
        console.error('[DirectPlayer] Could not save recent links to localStorage:', e);
    }
}

/**
 * Adds a new URL to the recent links list, ensuring it's unique and capped at the max limit.
 * @param {string} url - The URL to add.
 */
function addRecentLink(url) {
    let links = getRecentLinks();
    // Remove the link if it already exists to move it to the top
    links = links.filter(link => link !== url);
    // Add the new link to the beginning of the array
    links.unshift(url);
    // Trim the array to the maximum allowed length
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
    tbody.innerHTML = '';

    links.forEach(link => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="max-w-md truncate" title="${link}">
                <a href="#" class="replay-link" data-url="${link}">${link}</a>
            </td>
            <td class="text-right">
                <button class="action-btn delete-recent-link-btn p-1" title="Delete Link" data-url="${link}">
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- Player Lifecycle Functions ---

/**
 * Initializes the Direct Player page. Called when the user navigates to the Player tab.
 */
export function initDirectPlayer() {
    console.log('[DirectPlayer] Initializing Direct Player page.');
    if (directPlayer) {
        stopAndCleanupDirectPlayer();
    }
    if (UIElements.directPlayerForm) {
        UIElements.directPlayerForm.reset();
    }
    renderRecentLinks();
}

/**
 * Stops the current stream and cleans up the mpegts.js player instance and UI.
 */
function stopAndCleanupDirectPlayer() {
    if (directPlayer) {
        console.log('[DirectPlayer] Destroying direct player instance.');
        directPlayer.destroy();
        directPlayer = null;
    }
    if (UIElements.directVideoElement) {
        UIElements.directVideoElement.src = "";
        UIElements.directVideoElement.removeAttribute('src');
        UIElements.directVideoElement.load();
    }
    UIElements.directPlayerContainer.classList.add('hidden');
    UIElements.directPlayerConsoleContainer.classList.add('hidden');
    UIElements.directStopBtn.classList.add('hidden');
    UIElements.directPlayBtn.classList.remove('hidden');
}

/**
 * Cleans up the direct player when the user navigates away from the tab.
 */
export function cleanupDirectPlayer() {
    console.log('[DirectPlayer] Cleaning up direct player due to navigation.');
    stopAndCleanupDirectPlayer();
}

/**
 * Checks if a stream is currently active on the direct player page.
 * @returns {boolean} True if a player instance exists.
 */
export function isDirectPlayerActive() {
    return !!directPlayer;
}

/**
 * Initializes mpegts.js and plays the provided stream URL, handling direct vs. proxy.
 * @param {string} url The URL of the .ts or .m3u8 stream.
 */
function playDirectStream(url) {
    stopAndCleanupDirectPlayer();

    const consoleEl = UIElements.directPlayerConsole;
    if (consoleEl) {
        consoleEl.innerHTML = ''; // Clear previous logs
    }
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
        logToPlayerConsole(`Proxy URL: ${streamUrlToPlay}`);
    } else {
        logToPlayerConsole('Direct Play is ON. Connecting directly to stream.');
    }

    addRecentLink(url);
    renderRecentLinks();

    if (mpegts.isSupported()) {
        try {
            directPlayer = mpegts.createPlayer({
                type: 'mse',
                isLive: true,
                url: streamUrlToPlay
            });

            UIElements.directPlayerContainer.classList.remove('hidden');
            UIElements.directStopBtn.classList.remove('hidden');
            UIElements.directPlayBtn.classList.add('hidden');
            
            directPlayer.attachMediaElement(UIElements.directVideoElement);
            
            directPlayer.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
                console.error('[DirectPlayer] MPEGTS Error:', errorType, errorDetail);
                logToPlayerConsole(`Error: ${errorType} - ${errorDetail}`, true);
            });

            directPlayer.load();
            directPlayer.play().catch((err) => {
                const errorMsg = `Could not play the stream. Please check the URL and console log for details.`;
                console.error("[DirectPlayer] Player.play() caught an error:", err);
                logToPlayerConsole(errorMsg, true);
                showNotification(errorMsg, true);
                stopAndCleanupDirectPlayer();
            });
            logToPlayerConsole('Player instance created and attempting to load stream.');

        } catch (e) {
            const errorMsg = 'Failed to create player instance. Check stream URL.';
            console.error('[DirectPlayer] Error creating player:', e);
            logToPlayerConsole(`${errorMsg} Details: ${e.message}`, true);
            stopAndCleanupDirectPlayer();
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
    UIElements.directPlayerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const streamUrl = UIElements.directStreamUrl.value.trim();
        if (streamUrl) {
            playDirectStream(streamUrl);
        } else {
            showNotification('Please enter a stream URL.', true);
        }
    });

    UIElements.directStopBtn.addEventListener('click', stopAndCleanupDirectPlayer);

    // Use event delegation for recent links table
    UIElements.recentLinksTbody.addEventListener('click', (e) => {
        const replayLink = e.target.closest('.replay-link');
        const deleteBtn = e.target.closest('.delete-recent-link-btn');
        
        if (replayLink) {
            e.preventDefault();
            const url = replayLink.dataset.url;
            UIElements.directStreamUrl.value = url;
            playDirectStream(url);
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
