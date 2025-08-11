/**
 * api.js
 * * Manages all communication with the backend API.
 * Provides a centralized place for fetch requests and error handling.
 */

import { showLoginScreen } from './auth.js';
import { showNotification } from './ui.js';

/**
 * A wrapper for the fetch API to handle common tasks like error handling and auth failures.
 * @param {string} url - The API endpoint URL.
 * @param {object} options - Options for the fetch request (method, headers, body, etc.).
 * @returns {Promise<Response|null>} - The fetch Response object or null on failure.
 */
export async function apiFetch(url, options = {}) {
    console.log(`[API_FETCH] Requesting: ${options.method || 'GET'} ${url}`);
    try {
        const response = await fetch(url, options);
        console.log(`[API_FETCH] Response received for ${url}: Status ${response.status} ${response.statusText}`);

        // If the session expired, the server will return a 401 Unauthorized
        if (response.status === 401) {
            console.warn('[API_FETCH] 401 Unauthorized. Session expired or invalid.');
            showLoginScreen("Your session has expired. Please log in again.");
            return null; // Prevent further processing of this response
        }
        
        // Handle other non-ok responses
        if (!response.ok) {
            let errorData = {};
            try {
                errorData = await response.json(); // Try to parse error message if available
            } catch (e) {
                console.warn(`[API_FETCH] Could not parse error response as JSON for ${url}:`, e);
                errorData.error = response.statusText || 'An unknown error occurred.';
            }
            console.error(`[API_FETCH] API call failed for ${url}: Status ${response.status}, Error: ${errorData.error || 'No specific error message.'}`);
            showNotification(errorData.error || `API Error: ${response.status} ${response.statusText}`, true);
            return null;
        }

        console.log(`[API_FETCH] API call to ${url} successful.`);
        return response;
    } catch (error) {
        console.error(`[API_FETCH] Network or unexpected error during fetch for ${url}:`, error);
        showNotification("Could not connect to the server. Please check your network or server status.", true);
        return null;
    }
}

/**
 * Fetches the entire application configuration including M3U content, EPG data, and settings.
 * @returns {Promise<object|null>} The configuration object (m3uContent, epgContent, settings) or null on failure.
 */
export async function fetchConfig() {
    console.log('[API] Fetching application configuration from /api/config.');
    const response = await apiFetch(`/api/config?t=${Date.now()}`); // Add timestamp to prevent caching
    if (!response) {
        console.error('[API] Failed to fetch config: No response from apiFetch.');
        return null;
    }
    
    try {
        const config = await response.json();
        console.log('[API] Application configuration fetched successfully.');
        return config;
    } catch (e) {
        console.error('[API] Error parsing config JSON:', e);
        showNotification('Failed to parse server configuration.', true);
        return null;
    }
}

/**
 * Saves a user-specific setting to the backend.
 * @param {string} key - The setting key.
 * @param {*} value - The setting value.
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function saveUserSetting(key, value) {
    console.log(`[API] Saving user setting: ${key} =`, value);
    const res = await apiFetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
    });
    if (!res || !res.ok) {
        console.error(`[API] Failed to save user setting: ${key}`);
        // showNotification(`Could not save setting: ${key}`, true); // apiFetch already shows this
        return false;
    }
    console.log(`[API] User setting "${key}" saved successfully.`);
    return true;
}

/**
 * Saves a global (app-wide) setting to the backend.
 * @param {object} settingObject - An object containing the setting(s) to save.
 * @returns {Promise<object|null>} - The updated settings object from the server or null on failure.
 */
export async function saveGlobalSetting(settingObject) {
    console.log('[API] Saving global setting(s):', settingObject);
    const res = await apiFetch('/api/save/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingObject)
    });
    if (!res) return null; // apiFetch already handled notification

    const data = await res.json();
    if (res.ok && data.settings) {
        console.log('[API] Global settings saved successfully. New settings:', data.settings);
        return data.settings;
    } else {
        console.error('[API] Failed to save global setting:', data.error || 'Unknown server error.');
        // showNotification(data.error || 'A global setting could not be saved.', true); // apiFetch already shows this
        return null;
    }
}

// --- REFACTORED/NEW Notification API functions ---

/**
 * Fetches the VAPID public key from the server.
 * @returns {Promise<string|null>} The VAPID public key or null on failure.
 */
export async function getVapidKey() {
    console.log('[API] Fetching VAPID public key.');
    const res = await apiFetch('/api/notifications/vapid-public-key');
    if (!res || !res.ok) {
        console.error('[API] Failed to get VAPID public key from server.');
        return null;
    }
    const key = await res.text();
    console.log('[API] VAPID public key fetched successfully.');
    return key;
}

/**
 * Sends the push subscription object to the server to be saved.
 * @param {PushSubscription} subscription - The subscription object from the PushManager.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function subscribeToPush(subscription) {
    console.log('[API] Sending push subscription to server.');
    const res = await apiFetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
    });
    if (res && res.ok) {
        console.log('[API] Push subscription saved on server.');
    } else {
        console.error('[API] Failed to save push subscription on server.');
    }
    return res && res.ok;
}

/**
 * Tells the server to remove a push subscription.
 * @param {PushSubscription} subscription - The subscription object to remove.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function unsubscribeFromPush(subscription) {
    console.log('[API] Sending unsubscribe request to server.');
    const res = await apiFetch('/api/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
    });
    if (res && res.ok) {
        console.log('[API] Push subscription removed from server.');
    } else {
        console.error('[API] Failed to remove push subscription from server.');
    }
    return res && res.ok;
}


/**
 * Requests the server to schedule a program notification.
 * @param {object} notificationData - Object containing notification details.
 * @returns {Promise<object|null>} - The added notification object with its ID, or null on failure.
 */
export async function addProgramNotification(notificationData) {
    console.log('[API] Requesting to add program notification:', notificationData.programTitle);
    const res = await apiFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationData)
    });
    if (!res) return null;

    const data = await res.json();
    if (res.ok && data.success) {
        console.log(`[API] Program notification added successfully. ID: ${data.id}`);
        return { id: data.id, ...notificationData };
    } else {
        console.error('[API] Failed to add notification:', data.error);
        // showNotification(data.error || 'Could not add notification.', true); // apiFetch already shows this
        return null;
    }
}

/**
 * Fetches all scheduled program notifications for the current user from the backend.
 * @returns {Promise<Array<object>>} - An array of notification objects, or empty array on failure.
 */
export async function getProgramNotifications() {
    console.log('[API] Fetching all program notifications.');
    const res = await apiFetch('/api/notifications');
    if (!res) return [];

    const data = await res.json();
    if (res.ok) {
        console.log(`[API] Fetched ${data.length} program notifications.`);
        return data;
    } else {
        console.error('[API] Failed to get notifications:', data.error);
        // showNotification(data.error || 'Could not retrieve notifications.', true); // apiFetch already shows this
        return [];
    }
}

/**
 * Deletes a scheduled program notification from the backend.
 * @param {string|number} notificationId - The ID of the notification to delete.
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function deleteProgramNotification(notificationId) {
    console.log(`[API] Requesting to delete notification ID: ${notificationId}.`);
    const res = await apiFetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
    });
    if (!res) return false;

    const data = await res.json();
    if (res.ok && data.success) {
        console.log(`[API] Notification ID ${notificationId} deleted successfully.`);
        // showNotification('Notification removed.'); // This is called in notification.js now
        return true;
    } else {
        console.error(`[API] Failed to delete notification ${notificationId}:`, data.error);
        // showNotification(data.error || 'Could not remove notification.', true); // apiFetch already shows this
        return false;
    }
}

/**
 * Deletes all past (sent or expired) notifications for the user.
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function clearPastNotifications() {
    console.log(`[API] Requesting to delete all past notifications.`);
    const res = await apiFetch(`/api/notifications/past`, {
        method: 'DELETE',
    });
    // Return true if the request was successful (res is not null and res.ok is true)
    return res && res.ok;
}
