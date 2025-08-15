/**
 * player.js
 * * Manages the video player functionality using mpegts.js and Google Cast.
 */

import { appState, guideState, UIElements } from './state.js';
// MODIFIED: Added stopStream to the import
import { saveUserSetting, stopStream } from './api.js';
import { showNotification, openModal, closeModal } from './ui.js';
import { castState, loadMedia, setLocalPlayerState } from './cast.js';

let streamInfoInterval = null; // Interval to update stream stats
let currentLocalStreamUrl = null; // ADDED: Track the original URL of the currently playing local stream

/**
 * Stops the current local stream, cleans up the mpegts.js player instance, and closes the modal.
 * This does NOT affect an active Google Cast session.
 */
export const stopAndCleanupPlayer = async () => { // MODIFIED: Made function async
    // NEW: Explicitly tell the server to stop the stream process.
    if (currentLocalStreamUrl && !castState.isCasting) {
        console.log(`[PLAYER] Sending stop request to server for URL: ${currentLocalStreamUrl}`);
        await stopStream(currentLocalStreamUrl);
        currentLocalStreamUrl = null; // Clear the tracked URL after stopping
    }

    // Clear the stream info update interval
    if (streamInfoInterval) {
        clearInterval(streamInfoInterval);
        streamInfoInterval = null;
    }
    
    if (UIElements.streamInfoOverlay) {
        UIElements.streamInfoOverlay.classList.add('hidden');
    }

    if (castState.isCasting) {
        console.log('[PLAYER] Closing modal but leaving cast session active.');
        closeModal(UIElements.videoModal);
        return;
    }

    if (appState.player) {
        console.log('[PLAYER] Destroying local mpegts player.');
        appState.player.destroy();
        appState.player = null;
    }
    UIElements.videoElement.src = "";
    UIElements.videoElement.removeAttribute('src');
    UIElements.videoElement.load();

    setLocalPlayerState(null, null, null);

    if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(console.error);
    }
    closeModal(UIElements.videoModal);
};

/**
 * Updates the stream info overlay with the latest stats from mpegts.js.
 */
function updateStreamInfo() {
    if (!appState.player || !appState.player.statisticsInfo) return;

    const stats = appState.player.statisticsInfo;
    const video = UIElements.videoElement;

    const resolution = (video.videoWidth && video.videoHeight) ? `${video.videoWidth}x${video.videoHeight}` : 'N/A';
    const speed = `${(stats.speed / 1024).toFixed(2)} KB/s`;
    const fps = (stats.decodedFrames > 0 && typeof stats.fps === 'number') ? stats.fps.toFixed(2) : '0.00';
    const buffer = video.buffered.length > 0 ? `${(video.buffered.end(0) - video.currentTime).toFixed(2)}s` : '0.00s';

    UIElements.streamInfoResolution.textContent = `Resolution: ${resolution}`;
    UIElements.streamInfoBandwidth.textContent = `Bandwidth: ${speed}`;
    UIElements.streamInfoFps.textContent = `FPS: ${fps}`;
    UIElements.streamInfoBuffer.textContent = `Buffer: ${buffer}`;
}


/**
 * Initializes and starts playing a channel stream, either locally or on a Cast device.
 * @param {string} url - The URL of the channel stream.
 * @param {string} name - The name of the channel to display.
 * @param {string} channelId - The unique ID of the channel.
 */
export const playChannel = (url, name, channelId) => {
    // Update and save recent channels regardless of playback target
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
    
    const streamUrlToPlay = profile.command === 'redirect' ? url : `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;
    const channel = guideState.channels.find(c => c.id === channelId);
    const logo = channel ? channel.logo : '';

    if (castState.isCasting) {
        console.log(`[PLAYER] Already casting. Loading new channel "${name}" to remote device.`);
        loadMedia(streamUrlToPlay, name, logo);
        openModal(UIElements.videoModal);
        return;
    }

    // --- Local Playback Logic ---
    // MODIFIED: Store the original stream URL for the explicit stop API call.
    currentLocalStreamUrl = url; 
    console.log(`[PLAYER] Playing channel "${name}" locally. Tracking URL for cleanup: ${currentLocalStreamUrl}`);
    
    setLocalPlayerState(streamUrlToPlay, name, logo);
    
    if (appState.player) {
        appState.player.destroy();
        appState.player = null;
    }
    if (streamInfoInterval) {
        clearInterval(streamInfoInterval);
        streamInfoInterval = null;
    }

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
        
        UIElements.videoElement.volume = parseFloat(localStorage.getItem('iptvPlayerVolume') || 0.5);
        
        appState.player.play().catch((err) => {
            console.error("MPEGTS Player Error:", err);
            showNotification("Could not play stream. Check browser console & server logs.", true);
            stopAndCleanupPlayer();
        });

        streamInfoInterval = setInterval(updateStreamInfo, 2000);

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

    UIElements.streamInfoToggleBtn.addEventListener('click', () => {
        UIElements.streamInfoOverlay.classList.toggle('hidden');
    });

    if (UIElements.castBtn) {
        UIElements.castBtn.addEventListener('click', () => {
            console.log('[PLAYER] Custom cast button clicked. Requesting session...');
            try {
                const castContext = cast.framework.CastContext.getInstance();
                castContext.requestSession().catch((error) => {
                    console.error('Error requesting cast session:', error);
                    if (error !== "cancel") { 
                        showNotification('Could not initiate Cast session. See console for details.', true);
                    }
                });
            } catch (e) {
                console.error('Fatal Error: Cast framework is not available.', e);
                showNotification('Cast functionality is not available. Please try reloading.', true);
            }
        });
    } else {
        console.error('[PLAYER] CRITICAL: Cast button #cast-btn NOT FOUND.');
    }

    UIElements.videoElement.addEventListener('enterpictureinpicture', () => closeModal(UIElements.videoModal));
    UIElements.videoElement.addEventListener('leavepictureinpicture', () => {
        if (appState.player && !UIElements.videoElement.paused) {
            openModal(UIElements.videoModal);
        } else {
            stopAndCleanupPlayer();
        }
    });
    
    UIElements.videoElement.addEventListener('volumechange', () => {
        localStorage.setItem('iptvPlayerVolume', UIElements.videoElement.volume);
    });
}
