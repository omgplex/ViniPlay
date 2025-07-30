/**
 * player.js
 * * Manages the video player functionality using mpegts.js and Google Cast.
 */

import { appState, guideState, UIElements } from './state.js';
import { saveUserSetting } from './api.js';
import { showNotification, openModal, closeModal } from './ui.js';
import { castState, loadMedia, setLocalPlayerState } from './cast.js';

/**
 * Stops the current local stream, cleans up the mpegts.js player instance, and closes the modal.
 * This does NOT affect an active Google Cast session.
 */
export const stopAndCleanupPlayer = () => {
    console.log('[PLAYER_LOG] stopAndCleanupPlayer called.');
    if (castState.isCasting) {
        console.log('[PLAYER_LOG] Closing modal but leaving cast session active.');
        closeModal(UIElements.videoModal);
        return;
    }

    if (appState.player) {
        console.log('[PLAYER_LOG] Found active mpegts player. Destroying it.');
        appState.player.destroy();
        appState.player = null;
    } else {
        console.log('[PLAYER_LOG] No active mpegts player found to destroy.');
    }
    
    UIElements.videoElement.src = "";
    UIElements.videoElement.removeAttribute('src');
    UIElements.videoElement.load();
    console.log('[PLAYER_LOG] Video element source cleared.');

    setLocalPlayerState(null, null, null);

    if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(console.error);
    }
    closeModal(UIElements.videoModal);
    console.log('[PLAYER_LOG] stopAndCleanupPlayer finished.');
};

/**
 * Dedicated function to stop only the local mpegts.js stream for casting handoff.
 */
export const stopLocalPlayerForCasting = () => {
    console.log('[PLAYER_LOG] stopLocalPlayerForCasting called.');
    if (appState.player) {
        console.log('[PLAYER_LOG] Destroying local player for cast handoff.');
        appState.player.destroy();
        appState.player = null;
    } else {
        console.log('[PLAYER_LOG] No local player was active to stop for casting.');
    }
    
    UIElements.videoElement.pause();
    UIElements.videoElement.src = "";
    UIElements.videoElement.removeAttribute('src');
    UIElements.videoElement.load();
    console.log('[PLAYER_LOG] stopLocalPlayerForCasting finished.');
};


/**
 * Initializes and starts playing a channel stream.
 */
export const playChannel = (url, name, channelId) => {
    console.log(`[PLAYER_LOG] playChannel called for "${name}". IsCasting: ${castState.isCasting}`);
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
    
    let streamUrlToPlay;
    if (profile.command === 'redirect') {
        streamUrlToPlay = url;
    } else {
        const relativeStreamUrl = `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;
        streamUrlToPlay = new URL(relativeStreamUrl, window.location.origin).href;
    }
    console.log(`[PLAYER_LOG] Final stream URL for playback: ${streamUrlToPlay}`);

    const channel = guideState.channels.find(c => c.id === channelId);
    const logo = channel ? channel.logo : '';

    if (castState.isCasting) {
        console.log(`[PLAYER_LOG] Active cast session exists. Loading new channel "${name}" directly to remote device.`);
        loadMedia(streamUrlToPlay, name, logo);
        openModal(UIElements.videoModal);
        return;
    }

    console.log(`[PLAYER_LOG] Playing channel "${name}" locally.`);
    setLocalPlayerState(streamUrlToPlay, name, logo);
    
    if (appState.player) {
        console.log('[PLAYER_LOG] Destroying previous local player instance.');
        appState.player.destroy();
        appState.player = null;
    }

    if (mpegts.isSupported()) {
        console.log('[PLAYER_LOG] MPEGTS is supported. Creating new player.');
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
            console.error("[PLAYER_LOG] MPEGTS Player playback error:", err);
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
    console.log('[PLAYER_LOG] Setting up player event listeners.');
    UIElements.closeModal.addEventListener('click', stopAndCleanupPlayer);

    UIElements.pipBtn.addEventListener('click', () => {
        if (document.pictureInPictureEnabled && UIElements.videoElement.readyState >= 3) {
            UIElements.videoElement.requestPictureInPicture().catch(() => showNotification("Could not enter Picture-in-Picture.", true));
        }
    });

    if (UIElements.castBtn) {
        UIElements.castBtn.addEventListener('click', () => {
            console.log('[PLAYER_LOG] Cast button clicked. Requesting session...');
            try {
                const castContext = cast.framework.CastContext.getInstance();
                castContext.requestSession().then(
                   () => { console.log('[PLAYER_LOG] Cast session request successful (Promise resolved).'); },
                   (error) => { 
                        console.error('[PLAYER_LOG] Cast session request failed (Promise rejected). Error:', error);
                        if (error !== "cancel") { 
                            showNotification('Could not initiate Cast session. See console for details.', true);
                        }
                   }
                );
            } catch (e) {
                console.error('[PLAYER_LOG] Fatal Error: Cast framework is not available or failed to execute.', e);
                showNotification('Cast functionality is not available. Please try reloading.', true);
            }
        });
    } else {
        console.error('[PLAYER_LOG] CRITICAL: Cast button #cast-btn NOT FOUND.');
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
    console.log('[PLAYER_LOG] Player event listeners setup complete.');
}
