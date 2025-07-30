/**
 * cast.js
 * Manages all Google Cast related functionality.
 */

import { showNotification } from './ui.js';

const APPLICATION_ID = 'CC1AD845'; // Default Media Receiver App ID

export const castState = {
    isAvailable: false,
    isCasting: false,
    session: null,
    player: null,
    playerController: null,
    currentMedia: null
};

/**
 * Initializes the Google Cast API and sets up listeners.
 * This should be called once the application loads.
 */
export function initializeCastApi() {
    console.log('[CAST] Initializing Google Cast API...');
    
    // The Cast SDK will automatically call this function when it's ready.
    window['__onGCastApiAvailable'] = (isAvailable) => {
        if (isAvailable) {
            castState.isAvailable = true;
            console.log('[CAST] Cast SDK is available.');
            const castContext = cast.framework.CastContext.getInstance();
            castContext.setOptions({
                receiverApplicationId: APPLICATION_ID,
                autoJoinPolicy: chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED
            });

            // Add event listeners for session state changes
            castContext.addEventListener(
                cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                handleSessionStateChange
            );
            
             // Create a remote player controller
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
    switch (event.sessionState) {
        case cast.framework.SessionState.SESSION_STARTED:
        case cast.framework.SessionState.SESSION_RESUMED:
            castState.session = cast.framework.CastContext.getInstance().getCurrentSession();
            castState.isCasting = true;
            showNotification(`Casting to ${castState.session.getCastDevice().friendlyName}`, false, 4000);
            break;
        case cast.framework.SessionState.SESSION_ENDED:
            castState.session = null;
            castState.isCasting = false;
            castState.currentMedia = null;
            showNotification('Casting session ended.', false, 4000);
            break;
        case cast.framework.SessionState.NO_SESSION:
             castState.session = null;
             castState.isCasting = false;
             castState.currentMedia = null;
             break;
    }
}

/**
 * Handles changes in the remote player's connection status.
 */
function handleRemotePlayerConnectionChange() {
    if (castState.player.isConnected) {
        console.log('[CAST] Remote player is connected.');
    } else {
        console.log('[CAST] Remote player is disconnected.');
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
        },
        (errorCode) => {
            console.error('[CAST] Error loading media:', errorCode);
            showNotification('Failed to load media on Cast device. Check console.', true);
        }
    );
}

/**
 * Stops the currently playing media on the Cast device.
 */
export function stopCasting() {
    if (castState.session) {
        castState.session.stop(
            () => { console.log('[CAST] Media stopped successfully.'); },
            (errorCode) => { console.error('[CAST] Error stopping media:', errorCode); }
        );
    }
}

/**
 * Ends the entire Cast session, disconnecting from the device.
 */
export function endCastSession() {
     if (castState.session) {
        castState.session.endSession(true); // true to stop any playing media
     }
}
