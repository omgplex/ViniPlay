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
    console.log(`[CAST_DEBUG] setLocalPlayerState called with:`, { streamUrl, name, logo });
    castState.localPlayerState.streamUrl = streamUrl;
    castState.localPlayerState.name = name;
    castState.localPlayerState.logo = logo;
    console.log(`[CAST_DEBUG] Local player state updated: ${name}`);
}

/**
 * Initializes the Google Cast API and sets up listeners.
 * THIS IS NO LONGER CALLED DIRECTLY. It's wrapped in the __onGCastApiAvailable callback.
 */
function initializeCastApi() {
    console.log('[CAST_DEBUG] Cast SDK is available. Initializing context...');
    const castContext = cast.framework.CastContext.getInstance();
    castContext.setOptions({
        receiverApplicationId: APPLICATION_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED
    });
    console.log('[CAST_DEBUG] Cast context options set:', {
        receiverApplicationId: APPLICATION_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED
    });

    castContext.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        handleSessionStateChange
    );
    console.log('[CAST_DEBUG] Added SESSION_STATE_CHANGED listener.');
    
    castState.player = new cast.framework.RemotePlayer();
    castState.playerController = new cast.framework.RemotePlayerController(castState.player);
    castState.playerController.addEventListener(
        cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        handleRemotePlayerConnectionChange
    );
    console.log('[CAST_DEBUG] RemotePlayer and RemotePlayerController initialized. Added IS_CONNECTED_CHANGED listener.');
}

// --- FINAL FIX ---
// This is the official callback provided by the Google Cast SDK.
// It will be executed automatically by the SDK script once it has fully loaded and is ready.
// We wrap our entire initialization logic in here to prevent timing issues.
window['__onGCastApiAvailable'] = (isAvailable) => {
    console.log(`[CAST_DEBUG] __onGCastApiAvailable callback fired. isAvailable: ${isAvailable}`);
    if (isAvailable) {
        castState.isAvailable = true;
        initializeCastApi();
    } else {
        console.warn('[CAST_DEBUG] Cast SDK is not available on this device.');
        castState.isAvailable = false;
        // Optionally hide the cast button if the SDK is not available at all
        if (UIElements.castBtn) {
            UIElements.castBtn.style.display = 'none';
            console.log('[CAST_DEBUG] Cast button hidden as SDK is not available.');
        }
    }
};


/**
 * Handles changes in the Cast session state (e.g., connecting, disconnecting).
 * @param {cast.framework.SessionStateEventData} event - The event data.
 */
function handleSessionStateChange(event) {
    console.log(`[CAST_DEBUG] Session state changed: ${event.sessionState}`);
    const castContext = cast.framework.CastContext.getInstance();
    
    switch (event.sessionState) {
        case cast.framework.SessionState.SESSION_STARTED:
            console.log('[CAST_DEBUG] SESSION_STARTED: A new session has started.');
            castState.session = castContext.getCurrentSession();
            castState.isCasting = true;
            console.log(`[CAST_DEBUG] Current Cast session acquired:`, castState.session);
            showNotification(`Casting to ${castState.session.getCastDevice().friendlyName}`, false, 4000);
            
            if (castState.localPlayerState.streamUrl) {
                console.log('[CAST_DEBUG] localPlayerState has content. Automatically casting local content after session start.');
                loadMedia(castState.localPlayerState.streamUrl, castState.localPlayerState.name, castState.localPlayerState.logo);
            } else {
                console.log('[CAST_DEBUG] No localPlayerState content to auto-cast. User needs to select a channel or restart playback.');
            }
            break;
        case cast.framework.SessionState.SESSION_RESUMED:
            console.log('[CAST_DEBUG] SESSION_RESUMED: An existing session has been resumed.');
            castState.session = castContext.getCurrentSession();
            castState.isCasting = true;
            console.log(`[CAST_DEBUG] Resumed Cast session acquired:`, castState.session);
            showNotification(`Casting to ${castState.session.getCastDevice().friendlyName}`, false, 4000);
            // No need to load media here, it should already be playing if resumed.
            break;
        case cast.framework.SessionState.SESSION_ENDED:
            console.log('[CAST_DEBUG] SESSION_ENDED: Casting session has ended.');
            castState.session = null;
            castState.isCasting = false;
            castState.currentMedia = null;
            showNotification('Casting session ended.', false, 4000);
            updatePlayerUI();
            break;
        case cast.framework.SessionState.NO_SESSION:
            console.log('[CAST_DEBUG] NO_SESSION: No active Cast session.');
             castState.session = null;
             castState.isCasting = false;
             castState.currentMedia = null;
             updatePlayerUI();
             break;
        case cast.framework.SessionState.SESSION_STARTING:
             console.log('[CAST_DEBUG] SESSION_STARTING: Session is in the process of starting.');
             break;
        case cast.framework.SessionState.SESSION_ENDING:
             console.log('[CAST_DEBUG] SESSION_ENDING: Session is in the process of ending.');
             break;
        case cast.framework.SessionState.REQUEST_SESSION_SUCCESS:
             console.log('[CAST_DEBUG] REQUEST_SESSION_SUCCESS: Request for session was successful (dialog closed, session starting).');
             break;
        case cast.framework.SessionState.REQUEST_SESSION_FAILED:
             console.error('[CAST_DEBUG] REQUEST_SESSION_FAILED: Request for session failed. User may have cancelled or an error occurred.', event.error);
             if (event.error !== "cancel") { // 'cancel' is a user action, not an error we need to alert.
                 showNotification('Failed to start Cast session. See console for details.', true);
             }
             break;
    }
}

/**
 * Handles changes in the remote player's connection status and updates the UI.
 */
function handleRemotePlayerConnectionChange() {
    console.log(`[CAST_DEBUG] Remote player connection changed. isConnected: ${castState.player.isConnected}`);
    updatePlayerUI();
}

/**
 * Updates the local player modal UI based on the casting state.
 */
function updatePlayerUI() {
    console.log('[CAST_DEBUG] Updating player UI based on cast state.');
    const videoElement = UIElements.videoElement;
    const castStatusDiv = UIElements.castStatus;
    const castBtn = UIElements.castBtn;

    if (!videoElement || !castStatusDiv || !castBtn) {
        console.warn('[CAST_DEBUG] updatePlayerUI: Missing required UI elements.');
        return;
    }

    console.log(`[CAST_DEBUG] Current castState.isCasting: ${castState.isCasting}, castState.player.isConnected: ${castState.player.isConnected}`);

    if (castState.isCasting && castState.player.isConnected) {
        console.log('[CAST_DEBUG] Casting is active and player is connected. Showing cast status div.');
        videoElement.classList.add('hidden');
        castStatusDiv.classList.remove('hidden');
        castStatusDiv.classList.add('flex');
        
        UIElements.castStatusText.textContent = `Casting to ${castState.session ? castState.session.getCastDevice().friendlyName : 'device'}`;
        UIElements.castStatusChannel.textContent = castState.player.mediaInfo ? castState.player.mediaInfo.metadata.title : 'No media loaded.';
        console.log(`[CAST_DEBUG] Cast status text set to: "${UIElements.castStatusText.textContent}" for channel "${UIElements.castStatusChannel.textContent}"`);
        
        // Add class to our custom button to indicate connected state
        castBtn.classList.add('cast-connected');
        console.log('[CAST_DEBUG] Cast button class "cast-connected" added.');

    } else {
        console.log('[CAST_DEBUG] Not casting or player disconnected. Hiding cast status div.');
        videoElement.classList.remove('hidden');
        castStatusDiv.classList.add('hidden');
        castStatusDiv.classList.remove('flex');

        // Remove connected state class
        castBtn.classList.remove('cast-connected');
        console.log('[CAST_DEBUG] Cast button class "cast-connected" removed.');
    }
}


/**
 * Loads a media stream onto the connected Cast device.
 * @param {string} url - The URL of the stream.
 * @param {string} name - The name of the channel.
 * @param {string} logo - The URL of the channel's logo.
 */
export function loadMedia(url, name, logo) {
    console.log(`[CAST_DEBUG] loadMedia called. URL: "${url}", Name: "${name}", Logo: "${logo}"`);
    if (!castState.session) {
        console.error('[CAST_DEBUG] loadMedia: No active Cast session. Cannot load media.');
        showNotification('Not connected to a Cast device.', true);
        return;
    }

    // --- FIX START ---
    // Ensure the URL passed to MediaInfo is absolute, as Chromecast receivers might expect this.
    // The `url` parameter here is already the `/stream?url=...` endpoint from your server.
    const absoluteUrl = new URL(url, window.location.origin).href;
    console.log(`[CAST_DEBUG] Converted relative URL to absolute for Cast: ${absoluteUrl}`);
    // --- FIX END ---

    console.log(`[CAST_DEBUG] Creating MediaInfo object for URL: ${absoluteUrl}`);
    // Use the absolute URL as the contentId
    const mediaInfo = new chrome.cast.media.MediaInfo(absoluteUrl, 'video/mp2t'); // Assuming video/mp2t for HLS/MPEG-TS
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
    mediaInfo.metadata = new chrome.cast.media.TvShowMediaMetadata(); // Or GenericMediaMetadata
    mediaInfo.metadata.title = name;
    if (logo) {
        mediaInfo.metadata.images = [new chrome.cast.Image(logo)];
        console.log(`[CAST_DEBUG] MediaInfo metadata includes logo: ${logo}`);
    } else {
        console.log('[CAST_DEBUG] No logo provided for MediaInfo metadata.');
    }
    
    console.log('[CAST_DEBUG] MediaInfo created:', mediaInfo);

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    console.log('[CAST_DEBUG] LoadRequest created:', request);

    castState.session.loadMedia(request).then(
        () => {
            console.log('[CAST_DEBUG] Media loaded successfully on Cast device!');
            castState.currentMedia = castState.session.getMediaSession();
            console.log('[CAST_DEBUG] Current Cast MediaSession:', castState.currentMedia);
            updatePlayerUI();
        },
        (errorCode) => {
            console.error('[CAST_DEBUG] Error loading media on Cast device:', errorCode);
            // Possible error codes: "TIMEOUT", "INVALID_PARAMETER", "MEDIA_ERROR", "PLAYER_ERROR", "INVALID_REQUEST"
            showNotification(`Failed to load media on Cast device: ${errorCode.code || errorCode}. Check console for details.`, true);
        }
    );
}

/**
 * Ends the entire Cast session, disconnecting from the device.
 */
export function endCastSession() {
    console.log('[CAST_DEBUG] Attempting to end Cast session.');
     if (castState.session) {
        console.log(`[CAST_DEBUG] Ending session with friendlyName: ${castState.session.getCastDevice().friendlyName}`);
        castState.session.endSession(true); // true to stop any playing media
        console.log('[CAST_DEBUG] Session end requested.');
     } else {
        console.log('[CAST_DEBUG] No active session to end.');
     }
}
