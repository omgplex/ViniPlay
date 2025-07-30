/**
 * cast.js
 * Manages all Google Cast related functionality.
 */

import { showNotification } from './ui.js';
import { UIElements } from './state.js';

const APPLICATION_ID = 'CC1AD845'; // Default Media Receiver App ID

export const castState = {
    isAvailable: false,
    isCasting: false,
    session: null,
    player: null,
    playerController: null,
    currentMedia: null,
    // NEW: Store details of what's playing locally
    localPlayerState: {
        streamUrl: null,
        name: null,
        logo: null
    }
};

/**
 * Stores the details of the currently playing local media.
 * This is called from player.js whenever a channel starts playing locally.
 * @param {string} streamUrl - The URL of the stream.
 * @param {string} name - The name of the channel.
 * @param {string} logo - The URL for the channel's logo.
 */
export function setLocalPlayerState(streamUrl, name, logo) {
    castState.localPlayerState.streamUrl = streamUrl;
    castState.localPlayerState.name = name;
    castState.localPlayerState.logo = logo;
    console.log(`[CAST] Local player state updated: ${name}`);
}

/**
 * Initializes the Google Cast API and sets up listeners.
 * This should be called once the application loads.
 */
export function initializeCastApi() {
    console.log('[CAST] Initializing Google Cast API...');
    
    window['__onGCastApiAvailable'] = (isAvailable) => {
        if (isAvailable) {
            castState.isAvailable = true;
            console.log('[CAST] Cast SDK is available.');
            const castContext = cast.framework.CastContext.getInstance();
            castContext.setOptions({
                receiverApplicationId: APPLICATION_ID,
                autoJoinPolicy: chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED
            });

            castContext.addEventListener(
                cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                handleSessionStateChange
            );
            
            castState.player = new cast.framework.RemotePlayer();
            castState.playerController = new cast.framework.RemotePlayerController(castState.player);
            castState.playerController.addEventListener(
                cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
                handleRemotePlayerConnectionChange
            );

        } else {
            console.warn('[CAST] Cast SDK is not available.');
            castState.isAvailable = false;
        }
    };
}


/**
 * Handles changes in the Cast session state (e.g., connecting, disconnecting).
 * @param {cast.framework.SessionStateEventData} event - The event data.
 */
function handleSessionStateChange(event) {
    console.log(`[CAST] Session state changed: ${event.sessionState}`);
    const castContext = cast.framework.CastContext.getInstance();
    
    switch (event.sessionState) {
        case cast.framework.SessionState.SESSION_STARTED:
        case cast.framework.SessionState.SESSION_RESUMED:
            castState.session = castContext.getCurrentSession();
            castState.isCasting = true;
            showNotification(`Casting to ${castState.session.getCastDevice().friendlyName}`, false, 4000);
            
            // NEW: If a channel is playing locally, automatically cast it upon connection.
            if (castState.localPlayerState.streamUrl) {
                console.log('[CAST] Automatically casting local content after session start.');
                loadMedia(castState.localPlayerState.streamUrl, castState.localPlayerState.name, castState.localPlayerState.logo);
            }
            break;
        case cast.framework.SessionState.SESSION_ENDED:
            castState.session = null;
            castState.isCasting = false;
            castState.currentMedia = null;
            showNotification('Casting session ended.', false, 4000);
            updatePlayerUI(); // NEW: Update the local player UI
            break;
        case cast.framework.SessionState.NO_SESSION:
             castState.session = null;
             castState.isCasting = false;
             castState.currentMedia = null;
             updatePlayerUI(); // NEW: Update the local player UI
             break;
    }
}

/**
 * Handles changes in the remote player's connection status and updates the UI.
 */
function handleRemotePlayerConnectionChange() {
    updatePlayerUI();
}

/**
 * Updates the local player modal UI based on the casting state.
 */
function updatePlayerUI() {
    const videoElement = UIElements.videoElement;
    const castStatusDiv = UIElements.castStatus;

    if (castState.isCasting && castState.player.isConnected) {
        // Show "Now Casting" message
        videoElement.classList.add('hidden');
        castStatusDiv.classList.remove('hidden');
        castStatusDiv.classList.add('flex');
        
        UIElements.castStatusText.textContent = `Casting to ${castState.session.getCastDevice().friendlyName}`;
        UIElements.castStatusChannel.textContent = castState.player.mediaInfo ? castState.player.mediaInfo.metadata.title : 'No media loaded.';

    } else {
        // Show the local video player
        videoElement.classList.remove('hidden');
        castStatusDiv.classList.add('hidden');
        castStatusDiv.classList.remove('flex');
    }
}


/**
 * Loads a media stream onto the connected Cast device.
 * @param {string} url - The URL of the stream.
 * @param {string} name - The name of the channel.
 * @param {string} logo - The URL of the channel's logo.
 */
export function loadMedia(url, name, logo) {
    if (!castState.session) {
        showNotification('Not connected to a Cast device.', true);
        return;
    }

    console.log(`[CAST] Loading media: "${name}" from URL: ${url}`);
    
    const mediaInfo = new chrome.cast.media.MediaInfo(url, 'video/mp2t'); // MPEG Transport Stream
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
    mediaInfo.metadata = new chrome.cast.media.TvShowMediaMetadata();
    mediaInfo.metadata.title = name;
    if (logo) {
        mediaInfo.metadata.images = [new chrome.cast.Image(logo)];
    }

    const request = new chrome.cast.media.LoadRequest(mediaInfo);

    castState.session.loadMedia(request).then(
        () => {
            console.log('[CAST] Media loaded successfully.');
            castState.currentMedia = castState.session.getMediaSession();
            updatePlayerUI(); // NEW: Update UI after loading media
        },
        (errorCode) => {
            console.error('[CAST] Error loading media:', errorCode);
            showNotification('Failed to load media on Cast device. Check console.', true);
        }
    );
}

/**
 * Ends the entire Cast session, disconnecting from the device.
 */
export function endCastSession() {
     if (castState.session) {
        castState.session.endSession(true); // true to stop any playing media
     }
}
