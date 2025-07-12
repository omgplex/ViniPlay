/**
 * player.js
 * * Manages the video player functionality using mpegts.js.
 */

import { appState, guideState, UIElements } from './state.js';
import { saveUserSetting } from './api.js';
import { showNotification, openModal, closeModal } from './ui.js';

/**
 * Stops the current stream, cleans up the player instance, and closes the modal.
 */
export const stopAndCleanupPlayer = () => {
    if (appState.player) {
        appState.player.destroy();
        appState.player = null;
    }
    // Clear the video source to stop any background loading
    UIElements.videoElement.src = "";
    UIElements.videoElement.removeAttribute('src');
    UIElements.videoElement.load();

    // Exit Picture-in-Picture mode if active
    if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(console.error);
    }
    closeModal(UIElements.videoModal);
};

/**
 * Initializes and starts playing a channel stream.
 * @param {string} url - The URL of the channel stream.
 * @param {string} name - The name of the channel to display.
 * @param {string} channelId - The unique ID of the channel.
 */
export const playChannel = (url, name, channelId) => {
    if (appState.player) {
        stopAndCleanupPlayer();
    }
    
    // Update and save recent channels
    if (channelId) {
        const recentChannels = [channelId, ...(guideState.settings.recentChannels || []).filter(id => id !== channelId)].slice(0, 15);
        guideState.settings.recentChannels = recentChannels;
        saveUserSetting('recentChannels', recentChannels);
    }

    const profileId = guideState.settings.activeStreamProfileId;
    const userAgentId = guideState.settings.activeUserAgentId;
    if (!profileId || !userAgentId) {
        showNotification("Active stream profile or user agent not set. Please check settings.", true);
        return;
    }

    const profile = (guideState.settings.streamProfiles || []).find(p => p.id === profileId);
    if (!profile) {
        return showNotification("Stream profile not found.", true);
    }
    
    // Determine the URL to play based on the stream profile (direct redirect or server proxy)
    const streamUrlToPlay = profile.command === 'redirect' ? url : `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;

    if (mpegts.isSupported()) {
        appState.player = mpegts.createPlayer({
            type: 'mse',
            isLive: true,
            url: streamUrlToPlay
        });
        
        openModal(UIElements.videoModal);
        UIElements.videoTitle.textContent = name;
        appState.player.attachMediaElement(UIElements.videoElement);
        appState.player.load();
        
        // Restore previous volume or default to 50%
        UIElements.videoElement.volume = parseFloat(localStorage.getItem('iptvPlayerVolume') || 0.5);
        
        appState.player.play().catch((err) => {
            console.error("MPEGTS Player Error:", err);
            showNotification("Could not play stream. Check browser console & server logs.", true);
            stopAndCleanupPlayer();
        });
    } else {
        showNotification('Your browser does not support Media Source Extensions (MSE).', true);
    }
};

/**
 * Sets up event listeners for the video player.
 */
export function setupPlayerEventListeners() {
    UIElements.closeModal.addEventListener('click', stopAndCleanupPlayer);

    UIElements.pipBtn.addEventListener('click', () => {
        if (document.pictureInPictureEnabled && UIElements.videoElement.readyState >= 3) {
            UIElements.videoElement.requestPictureInPicture().catch(() => showNotification("Could not enter Picture-in-Picture.", true));
        }
    });

    UIElements.videoElement.addEventListener('enterpictureinpicture', () => closeModal(UIElements.videoModal));
    UIElements.videoElement.addEventListener('leavepictureinpicture', () => {
        // Re-open the modal only if the player exists and is not paused
        if (appState.player && !UIElements.videoElement.paused) {
            openModal(UIElements.videoModal);
        } else {
            stopAndCleanupPlayer();
        }
    });
    
    // Save volume changes to local storage
    UIElements.videoElement.addEventListener('volumechange', () => {
        localStorage.setItem('iptvPlayerVolume', UIElements.videoElement.volume);
    });
}
