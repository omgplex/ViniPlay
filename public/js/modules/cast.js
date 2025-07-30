/**
 * cast.js
 * Manages all Google Cast related functionality.
 */

import { showNotification, showConfirm } from './ui.js';
import { UIElements, appState } from './state.js';
import { stopLocalPlayerForCasting } from './player.js'; // **NEW**: Import the dedicated stop function

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
 * This is the official callback provided by the Google Cast SDK.
 * It will be executed automatically by the SDK script once it has fully loaded and is ready.
 * @param {boolean} isAvailable - True if the Cast API is available.
 */
window['__onGCastApiAvailable'] = (isAvailable) => {
    if (isAvailable) {
        console.log('[CAST] Google Cast SDK is available. Initializing context...');
        castState.isAvailable = true;
        initializeCastApi();
    } else {
        console.warn('[CAST] Google Cast SDK is not available on this device.');
        castState.isAvailable = false;
        if (UIElements.castBtn) {
            UIElements.castBtn.style.display = 'none';
        }
    }
};


/**
 * Initializes the Google Cast API and sets up listeners.
 * This function should only be called by the __onGCastApiAvailable callback.
 */
function initializeCastApi() {
    const castContext = cast.framework.CastContext.getInstance();
    castContext.setOptions({
        receiverApplicationId: APPLICATION_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.TAB_AND_ORIGIN_SCOPED
    });

    // Enable verbose debugging from the Cast Receiver
    cast.framework.CastContext.getInstance().setLogLevel(cast.framework.LoggerLevel.DEBUG);

    castContext.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        handleSessionStateChange
    );
    
    castState.player = new cast.framework.RemotePlayer();
    castState.playerController = new cast.framework.RemotePlayerController(castState.player);
    
    addRemotePlayerListeners(castState.playerController);
    
    console.log('[CAST] Cast context initialized, debugging enabled, and listeners attached.');
}

/**
 * Helper function to add all necessary listeners to the remote player controller.
 * @param {cast.framework.RemotePlayerController} controller 
 */
function addRemotePlayerListeners(controller) {
    controller.addEventListener(
        cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
        handleRemotePlayerConnectionChange
    );
    controller.addEventListener(
        cast.framework.RemotePlayerEventType.MEDIA_INFO_CHANGED,
        (event) => {
            console.log('[CAST_DEBUG] Remote Player: Media info changed.', event);
            updatePlayerUI();
        }
    );
    controller.addEventListener(
        cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
        (event) => {
            console.log(`[CAST_DEBUG] Remote Player: State changed to ${event.value}`);
            console.log('[CAST_DEBUG] Full player state event:', event);
        }
    );
}


/**
 * Stores the details of the currently playing local media.
 * @param {string} streamUrl - The URL of the stream.
 * @param {string} name - The name of the channel.
 * @param {string} logo - The URL for the channel's logo.
 */
export function setLocalPlayerState(streamUrl, name, logo) {
    castState.localPlayerState.streamUrl = streamUrl;
    castState.localPlayerState.name = name;
    castState.localPlayerState.logo = logo;
    if (name) {
        console.log(`[CAST] Local player state updated for potential casting: ${name}`);
    } else {
        console.log(`[CAST] Local player state cleared.`);
    }
}

/**
 * Handles changes in the Cast session state (e.g., connecting, disconnecting).
 * @param {cast.framework.SessionStateEventData} event - The event data.
 */
function handleSessionStateChange(event) {
    console.log(`[CAST] Session state changed: ${event.sessionState}`);
    
    castState.session = event.session;
    
    switch (event.sessionState) {
        case cast.framework.SessionState.SESSION_STARTED:
        case cast.framework.SessionState.SESSION_RESUMED:
            castState.isCasting = true;
            showNotification(`Casting to ${castState.session.getCastDevice().friendlyName}`, false, 4000);

            // **CORE FIX**: Immediately stop the local player to prevent dual audio/video.
            stopLocalPlayerForCasting();
            
            // Now, load the media on the remote device.
            if (castState.localPlayerState.streamUrl) {
                console.log('[CAST] Session active. Automatically casting local content.');
                loadMedia(castState.localPlayerState.streamUrl, castState.localPlayerState.name, castState.localPlayerState.logo);
            }
            break;
        case cast.framework.SessionState.SESSION_ENDED:
        case cast.framework.SessionState.NO_SESSION:
             castState.isCasting = false;
             castState.currentMedia = null;
             if (event.sessionState === cast.framework.SessionState.SESSION_ENDED) {
                showNotification('Casting session ended.', false, 4000);
             }
             updatePlayerUI();
             break;
    }
}

/**
 * Handles changes in the remote player's connection status and updates the UI.
 */
function handleRemotePlayerConnectionChange() {
    console.log(`[CAST_DEBUG] Remote player connection state changed. Connected: ${castState.player.isConnected}`);
    updatePlayerUI();
}

/**
 * Updates the local player modal UI based on the casting state.
 */
function updatePlayerUI() {
    const videoElement = UIElements.videoElement;
    const castStatusDiv = UIElements.castStatus;
    const castBtn = UIElements.castBtn;

    // Check if we are successfully casting to a connected device.
    if (castState.isCasting && castState.player.isConnected && castState.session) {
        videoElement.classList.add('hidden');
        castStatusDiv.classList.remove('hidden');
        castStatusDiv.classList.add('flex');
        
        UIElements.castStatusText.textContent = `Casting to ${castState.session.getCastDevice().friendlyName}`;
        UIElements.castStatusChannel.textContent = castState.player.mediaInfo ? castState.player.mediaInfo.metadata.title : 'No media loaded.';
        
        if (castBtn) castBtn.classList.add('cast-connected');

    } else {
        videoElement.classList.remove('hidden');
        castStatusDiv.classList.add('hidden');
        castStatusDiv.classList.remove('flex');

        if (castBtn) castBtn.classList.remove('cast-connected');
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

    console.log(`[CAST] Loading media onto remote device: "${name}" from URL: ${url}`);
    
    const mediaInfo = new chrome.cast.media.MediaInfo(url, 'video/mp2t');
    mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
    mediaInfo.metadata = new chrome.cast.media.TvShowMediaMetadata();
    mediaInfo.metadata.title = name;
    if (logo) {
        mediaInfo.metadata.images = [new chrome.cast.Image(logo)];
    }

    const request = new chrome.cast.media.LoadRequest(mediaInfo);
    
    // This allows the receiver to load content from different origins (CORS).
    request.credentials = null;
    request.credentialsType = 'none';

    castState.session.loadMedia(request).then(
        () => {
            console.log('[CAST] Media load command sent to remote device successfully.');
            castState.currentMedia = castState.session.getMediaSession();
        },
        (errorCode) => {
            console.error(`[CAST] FATAL: Error sending media load command. Code: ${errorCode}`);
            showNotification('Failed to load media on Cast device. Check console for details.', true);
        }
    );
}

/**
 * Ends the entire Cast session, disconnecting from the device.
 */
export function endCastSession() {
     if (castState.session) {
        console.log('[CAST] Ending cast session.');
        castState.session.stop(
            () => { console.log('[CAST] Media stopped successfully.'); },
            () => { console.error('[CAST] Failed to stop media.'); }
        );
        castState.session.endSession(true);
     }
}
