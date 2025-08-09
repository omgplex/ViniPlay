/**
 * player_direct.js
 * * Manages the functionality for the direct stream player page.
 */

import { UIElements } from './modules/state.js';
import { showNotification } from './modules/ui.js';

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

    if (mpegts.isSupported()) {
        console.log(`[DirectPlayer] Attempting to play stream: ${url}`);
        
        // Create the player instance
        directPlayer = mpegts.createPlayer({
            type: 'mse', // mpegts.js can often handle HLS (.m3u8) via MSE as well
            isLive: true,
            url: url
        });

        // Show the player and attach the video element
        UIElements.directPlayerContainer.classList.remove('hidden');
        directPlayer.attachMediaElement(UIElements.directVideoElement);
        
        // Load and play the stream
        directPlayer.load();
        directPlayer.play().catch((err) => {
            console.error("[DirectPlayer] MPEGTS Player Error:", err);
            showNotification("Could not play the stream. Check the URL and browser console for errors.", true);
            stopAndCleanupDirectPlayer(); // Clean up on failure
        });

    } else {
        showNotification('Your browser does not support the necessary technology to play this stream (Media Source Extensions).', true);
    }
}
