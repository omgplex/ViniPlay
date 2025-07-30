/**
 * player.js
 * * Manages the video player functionality using mpegts.js and Google Cast.
 */

import { appState, guideState, UIElements } from './state.js';
import { apiFetch, saveUserSetting } from './api.js';
import { showNotification, openModal, closeModal } from './ui.js';
// MODIFIED: Import initiateCastPlayback instead of loadMedia directly
import { castState, setLocalPlayerState, initiateCastPlayback } from './cast.js';

/**
 * Stops the current local stream, cleans up the mpegts.js player instance, and closes the modal.
 * This does NOT affect an active Google Cast session unless explicitly forced.
 * @param {boolean} [forceStopLocal=false] - If true, forces stopping of the local player regardless of castState.isCasting.
 */
export const stopAndCleanupPlayer = (forceStopLocal = false) => {
    console.log('[PLAYER_DEBUG] stopAndCleanupPlayer called.');

    // If we are casting, the modal might be showing the "Now Casting" screen.
    // If we are *not* forcing a stop, then we just want to close the modal, not stop the remote playback.
    if (castState.isCasting && !forceStopLocal) {
        console.log('[PLAYER_DEBUG] Currently casting (and not forced). Closing modal but leaving cast session active.');
        closeModal(UIElements.videoModal);
        return; // Exit without stopping the cast session.
    }

    // If not casting, or if forceStopLocal is true, proceed with cleaning up the local player.
    if (appState.player) {
        console.log('[PLAYER_DEBUG] Destroying local mpegts player instance.');
        appState.player.destroy();
        appState.player = null;
        console.log('[PLAYER_DEBUG] mpegts player destroyed and reference cleared.');
    } else {
        console.log('[PLAYER_DEBUG] No active mpegts player instance to destroy.');
    }

    // Clear the video source to stop any background loading
    UIElements.videoElement.src = "";
    UIElements.videoElement.removeAttribute('src');
    UIElements.videoElement.load();
    console.log('[PLAYER_DEBUG] Video element source cleared.');

    // Only clear the local player state if we are NOT forcing a stop (i.e., local playback is truly ending, not being transferred to cast).
    if (!forceStopLocal) {
        setLocalPlayerState(null, null, null);
        console.log('[PLAYER_DEBUG] Local player state cleared.');
    } else {
        console.log('[PLAYER_DEBUG] Local player state NOT cleared, as casting is taking over.');
    }

    // Exit Picture-in-Picture mode if active
    if (document.pictureInPictureElement) {
        console.log('[PLAYER_DEBUG] Exiting Picture-in-Picture mode.');
        document.exitPictureInPicture().catch(e => console.error('[PLAYER_DEBUG] Error exiting PiP:', e));
    }
    
    closeModal(UIElements.videoModal);
    console.log('[PLAYER_DEBUG] Video modal closed.');
};

/**
 * Initializes and starts playing a channel stream, either locally or on a Cast device.
 * @param {string} url - The URL of the channel stream.
 * @param {string} name - The name of the channel to display.
 * @param {string} channelId - The unique ID of the channel.
 */
export const playChannel = async (url, name, channelId) => {
    console.log(`[PLAYER_DEBUG] playChannel called with:`, { url, name, channelId });

    // Update and save recent channels regardless of playback target
    if (channelId) {
        const recentChannels = [channelId, ...(guideState.settings.recentChannels || []).filter(id => id !== channelId)].slice(0, 15);
        guideState.settings.recentChannels = recentChannels;
        saveUserSetting('recentChannels', recentChannels);
        console.log(`[PLAYER_DEBUG] Updated recent channels for: ${channelId}`);
    } else {
        console.warn('[PLAYER_DEBUG] No channelId provided for playChannel. Cannot update recent channels.');
    }

    const profileId = guideState.settings.activeStreamProfileId;
    const userAgentId = guideState.settings.activeUserAgentId;
    console.log(`[PLAYER_DEBUG] Active stream profile ID: "${profileId}", User agent ID: "${userAgentId}"`);

    if (!profileId || !userAgentId) {
        showNotification("Active stream profile or user agent not set. Please check settings.", true);
        console.error('[PLAYER_DEBUG] Missing stream profile or user agent IDs. Aborting playback.');
        return;
    }

    const profile = (guideState.settings.streamProfiles || []).find(p => p.id === profileId);
    if (!profile) {
        showNotification("Stream profile not found.", true);
        console.error(`[PLAYER_DEBUG] Stream profile with ID "${profileId}" not found in settings.`);
        return;
    }
    console.log('[PLAYER_DEBUG] Found stream profile:', profile);
    
    // Determine the base URL to play (before token for casting)
    let baseStreamUrl = profile.command === 'redirect' ? url : `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;
    console.log(`[PLAYER_DEBUG] Calculated baseStreamUrl: ${baseStreamUrl}`);

    const channel = guideState.channels.find(c => c.id === channelId);
    const logo = channel ? channel.logo : '';
    console.log(`[PLAYER_DEBUG] Channel logo for casting: ${logo}`);

    // --- Casting Logic ---
    if (castState.isCasting) {
        console.log(`[PLAYER_DEBUG] castState.isCasting is TRUE. Delegating to initiateCastPlayback in cast.js.`);
        // Set local player state for the Cast module to pick up
        setLocalPlayerState(baseStreamUrl, name, logo); 
        // Delegate the actual media loading (including token fetch) to cast.js
        initiateCastPlayback(); 
        return;
    }

    // --- Local Playback Logic (Only if not casting) ---
    console.log(`[PLAYER_DEBUG] castState.isCasting is FALSE. Playing channel "${name}" locally.`);
    // For local playback, set the local player state directly before starting the player
    setLocalPlayerState(baseStreamUrl, name, logo);
    
    if (appState.player) {
        console.log('[PLAYER_DEBUG] Existing local mpegts player found. Destroying it before creating new one.');
        appState.player.destroy();
        appState.player = null;
    }

    if (mpegts.isSupported()) {
        console.log('[PLAYER_DEBUG] MPEGTS is supported. Creating new mpegts player instance.');
        appState.player = mpegts.createPlayer({
            type: 'mse',
            isLive: true,
            url: baseStreamUrl // Use the base URL for local playback
        });
        console.log('[PLAYER_DEBUG] mpegts player instance created:', appState.player);
        
        openModal(UIElements.videoModal);
        UIElements.videoTitle.textContent = name;
        console.log(`[PLAYER_DEBUG] Video modal opened, title set to: "${name}"`);

        appState.player.attachMediaElement(UIElements.videoElement);
        appState.player.load();
        
        UIElements.videoElement.volume = parseFloat(localStorage.getItem('iptvPlayerVolume') || 0.5);
        console.log(`[PLAYER_DEBUG] Video element volume set to: ${UIElements.videoElement.volume}`);

        appState.player.play().then(() => {
            console.log('[PLAYER_DEBUG] MPEGTS player started playback successfully.');
        }).catch((err) => {
            console.error("[PLAYER_DEBUG] MPEGTS Player Error during play():", err);
            showNotification("Could not play stream. Check browser console & server logs.", true);
            stopAndCleanupPlayer();
        });
    } else {
        console.warn('[PLAYER_DEBUG] MPEGTS is NOT supported by this browser.');
        showNotification('Your browser does not support Media Source Extensions (MSE).', true);
    }
};

/**
 * Sets up event listeners for the video player.
 */
export function setupPlayerEventListeners() {
    console.log('[PLAYER_DEBUG] Setting up player event listeners.');
    UIElements.closeModal.addEventListener('click', () => {
        console.log('[PLAYER_DEBUG] Close modal button clicked.');
        stopAndCleanupPlayer();
    });

    UIElements.pipBtn.addEventListener('click', () => {
        console.log('[PLAYER_DEBUG] PiP button clicked.');
        if (document.pictureInPictureEnabled && UIElements.videoElement.readyState >= 3) {
            UIElements.videoElement.requestPictureInPicture().then(() => {
                console.log('[PLAYER_DEBUG] Successfully entered Picture-in-Picture.');
            }).catch((err) => {
                console.error('[PLAYER_DEBUG] Error entering Picture-in-Picture:', err);
                showNotification("Could not enter Picture-in-Picture.", true);
            });
        } else {
            console.warn('[PLAYER_DEBUG] Picture-in-Picture not enabled or video not ready.');
            showNotification("Picture-in-Picture is not available or video not ready.", false);
        }
    });

    // --- FINAL FIX ---
    // This listener on our custom button unconditionally calls requestSession(),
    // which is the correct way to open the Google Cast device selection dialog.
    if (UIElements.castBtn) {
        UIElements.castBtn.addEventListener('click', () => {
            console.log('[PLAYER_DEBUG] Custom cast button clicked. Requesting session...');
            try {
                const castContext = cast.framework.CastContext.getInstance();
                castContext.requestSession().then(() => {
                    console.log('[PLAYER_DEBUG] castContext.requestSession() resolved (session started or resumed).');
                }).catch((error) => {
                    console.error('[PLAYER_DEBUG] Error requesting cast session:', error);
                    // "cancel" is a normal user action, not a technical error.
                    if (error !== "cancel" && error.code !== "cancel") { // Check for both string 'cancel' and object {code: 'cancel'}
                        showNotification('Could not initiate Cast session. See console for details.', true);
                    } else {
                        console.log('[PLAYER_DEBUG] Cast session request cancelled by user.');
                    }
                });
            } catch (e) {
                console.error('[PLAYER_DEBUG] Fatal Error: Cast framework is not available or threw an exception during requestSession.', e);
                showNotification('Cast functionality is not available. Please try reloading.', true);
            }
        });
    } else {
        console.error('[PLAYER_DEBUG] CRITICAL: Cast button #cast-btn NOT FOUND. Cast functionality will not work.');
    }
    // --- END FINAL FIX ---

    UIElements.videoElement.addEventListener('enterpictureinpicture', () => {
        console.log('[PLAYER_DEBUG] Video entered Picture-in-Picture. Closing main modal.');
        closeModal(UIElements.videoModal);
    });
    UIElements.videoElement.addEventListener('leavepictureinpicture', () => {
        console.log('[PLAYER_DEBUG] Video left Picture-in-Picture.');
        if (appState.player && !UIElements.videoElement.paused) {
            console.log('[PLAYER_DEBUG] Local player is still active. Re-opening main video modal.');
            openModal(UIElements.videoModal);
        } else {
            console.log('[PLAYER_DEBUG] Local player is paused or stopped. Stopping and cleaning up player.');
            stopAndCleanupPlayer();
        }
    });
    
    UIElements.videoElement.addEventListener('volumechange', () => {
        const currentVolume = UIElements.videoElement.volume;
        localStorage.setItem('iptvPlayerVolume', currentVolume);
        console.log(`[PLAYER_DEBUG] Video element volume changed to: ${currentVolume}. Saved to localStorage.`);
    });
    
    UIElements.videoElement.addEventListener('error', (e) => {
        console.error('[PLAYER_DEBUG] Video element encountered an error:', e);
        showNotification('Video playback error. Please try another channel or check server logs.', true);
    });
}
