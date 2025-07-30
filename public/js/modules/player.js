/**
 * player.js
 * * Manages the video player functionality using mpegts.js and Google Cast.
 */

import { appState, guideState, UIElements } from './state.js';
import { saveUserSetting } from './api.js';
import { showNotification, openModal, closeModal } from './ui.js';
import { castState, loadMedia, setLocalPlayerState, endCastSession } from './cast.js';

/**
 * Stops the current local stream, cleans up the mpegts.js player instance, and closes the modal.
 * This does NOT affect an active Google Cast session.
 */
export const stopAndCleanupPlayer = () => {
    // If we are casting, the modal might be showing the "Now Casting" screen.
    // In this case, we just want to close the modal, not stop the remote playback.
    if (castState.isCasting) {
        console.log('[PLAYER] Closing modal but leaving cast session active.');
        closeModal(UIElements.videoModal);
        // Prompt user if they want to stop casting when closing the modal.
        showConfirm(
            'Stop Casting?',
            'Do you want to stop casting this channel?',
            () => {
                endCastSession();
                // We don't need to do anything else, as the session end event will handle UI cleanup.
            },
            () => {
                // User chose not to stop, do nothing.
            }
        );
        return;
    }

    // If not casting, proceed with cleaning up the local player.
    if (appState.player) {
        console.log('[PLAYER] Destroying local mpegts player.');
        appState.player.destroy();
        appState.player = null;
    }
    // Clear the video source to stop any background loading
    UIElements.videoElement.src = "";
    UIElements.videoElement.removeAttribute('src');
    UIElements.videoElement.load();

    // Clear the local player state so it's not auto-cast later if the modal is closed.
    setLocalPlayerState(null, null, null);

    // Exit Picture-in-Picture mode if active
    if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(console.error);
    }
    closeModal(UIElements.videoModal);
};

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
    
    // --- **CORE FIX**: Differentiate between local and cast URLs ---
    // The server proxy URL needs to be relative for the local player, but absolute for the Cast device.
    
    // 1. Define the relative path for the server-side proxy. This is used by the local player.
    const relativeProxiedUrl = `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;

    // 2. Determine the URL for the LOCAL player.
    // If the profile is 'redirect', use the original stream URL directly. Otherwise, use the relative proxied URL.
    const localUrlToPlay = profile.command === 'redirect' ? url : relativeProxiedUrl;
    
    // 3. Determine the URL for the CAST device. This MUST be an absolute URL.
    // We prepend the window's origin to the relative path to make it absolute.
    const castUrlToPlay = profile.command === 'redirect' ? url : `${window.location.origin}${relativeProxiedUrl}`;
    // --- End of CORE FIX ---

    const channel = guideState.channels.find(c => c.id === channelId);
    const logo = channel ? channel.logo : '';

    // --- Casting Logic ---
    if (castState.isCasting) {
        console.log(`[PLAYER] Already casting. Loading new channel "${name}" to remote device with absolute URL.`);
        // **FIX**: Use the absolute URL (`castUrlToPlay`) when loading media on the remote device.
        loadMedia(castUrlToPlay, name, logo);
        openModal(UIElements.videoModal); // Show the "Now Casting" modal
        return;
    }

    // --- Local Playback Logic ---
    console.log(`[PLAYER] Playing channel "${name}" locally.`);
    
    // **FIX**: When setting the local player state, provide the absolute URL that the cast device will need
    // if the user decides to initiate a new cast session while this channel is playing.
    setLocalPlayerState(castUrlToPlay, name, logo);
    
    if (appState.player) {
        appState.player.destroy();
        appState.player = null;
    }

    if (mpegts.isSupported()) {
        appState.player = mpegts.createPlayer({
            type: 'mse',
            isLive: true,
            // Use the local URL (which can be relative) for the local player.
            url: localUrlToPlay 
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

    // This listener on our custom button unconditionally calls requestSession(),
    // which is the correct way to open the Google Cast device selection dialog.
    if (UIElements.castBtn) {
        UIElements.castBtn.addEventListener('click', () => {
            console.log('[PLAYER] Custom cast button clicked. Requesting new session...');
            try {
                const castContext = cast.framework.CastContext.getInstance();
                castContext.requestSession().catch((error) => {
                    console.error('Error requesting cast session:', error);
                    // "cancel" is a normal user action, not a technical error.
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
