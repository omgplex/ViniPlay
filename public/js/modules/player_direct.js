/**
 * player_direct.js
 * * Manages the functionality for the direct stream player page.
 */

import { UIElements, guideState } from './state.js';
import { showNotification } from './ui.js';

let directPlayer = null; // To hold the mpegts.js instance

/**
 * Initializes the Direct Player page.
 * This is called when the user navigates to the Player tab.
 */
export function initDirectPlayer() {
    console.log('[DirectPlayer] Initializing Direct Player page.');
    // If a player is somehow still active, clean it up.
    if (directPlayer) {
        stopAndCleanupDirectPlayer();
    }
    // Reset the form for a fresh start
    if (UIElements.directPlayerForm) {
        UIElements.directPlayerForm.reset();
    }
}

/**
 * Stops the current stream and cleans up the mpegts.js player instance.
 */
function stopAndCleanupDirectPlayer() {
    if (directPlayer) {
        console.log('[DirectPlayer] Destroying direct player instance.');
        directPlayer.destroy();
        directPlayer = null;
    }
    // Reset the video element and hide the player container
    if (UIElements.directVideoElement) {
        UIElements.directVideoElement.src = "";
        UIElements.directVideoElement.removeAttribute('src');
        UIElements.directVideoElement.load();
    }
    if (UIElements.directPlayerContainer) {
        UIElements.directPlayerContainer.classList.add('hidden');
    }
}

/**
 * Cleans up the direct player when the user navigates away from the tab.
 * This is exported to be called from the main routing logic.
 */
export function cleanupDirectPlayer() {
    console.log('[DirectPlayer] Cleaning up direct player due to navigation.');
    stopAndCleanupDirectPlayer();
}

/**
 * Sets up the event listeners for the Direct Player page controls.
 */
export function setupDirectPlayerEventListeners() {
    if (UIElements.directPlayerForm) {
        UIElements.directPlayerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const streamUrl = UIElements.directStreamUrl.value.trim();

            if (!streamUrl) {
                showNotification('Please enter a stream URL.', true);
                return;
            }

            playDirectStream(streamUrl);
        });
    }
}

/**
 * Initializes mpegts.js and plays the provided stream URL.
 * @param {string} url The URL of the .ts or .m3u8 stream.
 */
function playDirectStream(url) {
    // Stop any existing player before starting a new one
    stopAndCleanupDirectPlayer();

    // Get the active stream profile and user agent from the global state
    const profileId = guideState.settings.activeStreamProfileId;
    const userAgentId = guideState.settings.activeUserAgentId;

    if (!profileId || !userAgentId) {
        showNotification("Active stream profile or user agent not set. Please check settings.", true);
        return;
    }

    const profile = (guideState.settings.streamProfiles || []).find(p => p.id === profileId);
    if (!profile) {
        showNotification("Active stream profile could not be found.", true);
        return;
    }

    // Construct the URL to use the server-side proxy to bypass browser restrictions
    const streamUrlToPlay = profile.command === 'redirect'
        ? url
        : `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;

    if (mpegts.isSupported()) {
        console.log(`[DirectPlayer] Attempting to play proxied stream: ${streamUrlToPlay}`);
        
        // Create the player instance
        directPlayer = mpegts.createPlayer({
            type: 'mse',
            isLive: true,
            url: streamUrlToPlay
        });

        // Show the player and attach the video element
        UIElements.directPlayerContainer.classList.remove('hidden');
        directPlayer.attachMediaElement(UIElements.directVideoElement);
        
        // Load and play the stream
        directPlayer.load();
        directPlayer.play().catch((err) => {
            console.error("[DirectPlayer] MPEGTS Player Error:", err);
            showNotification("Could not play the stream. Check the URL, server logs, and browser console.", true);
            stopAndCleanupDirectPlayer(); // Clean up on failure
        });

    } else {
        showNotification('Your browser does not support the necessary technology to play this stream (Media Source Extensions).', true);
    }
}
