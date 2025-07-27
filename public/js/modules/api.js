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
        console.log(`[API_FETCH] Response received for ${url}: Status ${response.status} (${response.statusText})`);
        
        // If the session expired, the server will return a 401 Unauthorized
        if (response.status === 401) {
            console.warn('[API_FETCH] 401 Unauthorized response received. Showing login screen.');
            showLoginScreen("Your session has expired. Please log in again.");
            return null;
        }
        
        if (!response.ok) {
            const errorBody = await response.text(); // Get response body for more context
            console.error(`[API_FETCH] HTTP Error for ${url}: ${response.status} ${response.statusText}. Body: ${errorBody}`);
        }

        return response;
    } catch (error) {
        console.error(`[API_FETCH] Network or unhandled error during fetch to ${url}:`, error);
        showNotification("Could not connect to the server or unexpected error occurred.", true);
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
    console.log(`[API] Saving user setting: ${key}`);
    const res = await apiFetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
    });
    if (!res || !res.ok) {
        console.error(`[API] Failed to save user setting: ${key}`);
        showNotification(`Could not save setting: ${key}`, true);
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
    console.log('[API] Saving global setting:', settingObject);
    const res = await apiFetch('/api/save/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingObject)
    });
    if (!res) return null;

    const data = await res.json();
    if (res.ok && data.settings) {
        console.log('[API] Global setting saved successfully. New settings:', data.settings);
        return data.settings;
    } else {
        console.error(`[API] Failed to save global setting:`, settingObject, 'Error:', data.error);
        showNotification(data.error || 'A global setting could not be saved.', true);
        return null;
    }
}

// --- REFACTORED/NEW Notification API functions ---

/**
 * Fetches the VAPID public key from the server.
 * @returns {Promise<string|null>} The VAPID public key or null on failure.
 */
export async function getVapidKey() {
    console.log('[API] Fetching VAPID public key...');
    const res = await apiFetch('/api/notifications/vapid-public-key');
    if (!res || !res.ok) {
        console.error('[API] Failed to get VAPID public key from server.');
        return null;
    }
    const key = await res.text();
    console.log('[API] VAPID public key received.');
    return key;
}

/**
 * Sends the push subscription object to the server to be saved.
 * @param {PushSubscription} subscription - The subscription object from the PushManager.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function subscribeToPush(subscription) {
    console.log('[API] Subscribing to push notifications...');
    const res = await apiFetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
    });
    if (res && res.ok) {
        console.log('[API] Push subscription sent successfully.');
        return true;
    } else {
        console.error('[API] Failed to subscribe to push notifications.');
        return false;
    }
}

/**
 * Tells the server to remove a push subscription.
 * @param {PushSubscription} subscription - The subscription object to remove.
 * @returns {Promise<boolean>} True on success, false on failure.
 */
export async function unsubscribeFromPush(subscription) {
    console.log('[API] Unsubscribing from push notifications...');
    const res = await apiFetch('/api/notifications/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint })
    });
    if (res && res.ok) {
        console.log('[API] Push unsubscription sent successfully.');
        return true;
    } else {
        console.error('[API] Failed to unsubscribe from push notifications.');
        return false;
    }
}


/**
 * Requests the server to schedule a program notification.
 * @param {object} notificationData - Object containing notification details.
 * @returns {Promise<object|null>} - The added notification object with its ID, or null on failure.
 */
export async function addProgramNotification(notificationData) {
    console.log('[API] Adding program notification:', notificationData.programTitle);
    const res = await apiFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationData)
    });
    if (!res) return null;

    const data = await res.json();
    if (res.ok && data.success) {
        console.log('[API] Program notification added successfully. ID:', data.id);
        return { 
            id: data.id, 
            status: 'active',
            ...notificationData 
        };
    } else {
        console.error('[API] Failed to add notification:', data.error);
        showNotification(data.error || 'Could not add notification.', true);
        return null;
    }
}

/**
 * Fetches all scheduled (active) and past program notifications for the current user.
 * @returns {Promise<{active: Array<object>, past: Array<object>}>} - An object containing arrays of active and past notification objects.
 */
export async function getProgramNotifications() {
    console.log('[API] Fetching program notifications...');
    const res = await apiFetch('/api/notifications');
    const defaultResponse = { active: [], past: [] };
    if (!res) return defaultResponse;

    try {
        const data = await res.json();
        if (res.ok) {
            console.log(`[API] Fetched ${data.active.length} active and ${data.past.length} past notifications.`);
            return data;
        } else {
            console.error('[API] Failed to get notifications:', data.error);
            showNotification(data.error || 'Could not retrieve notifications.', true);
            return defaultResponse;
        }
    } catch(e) {
        console.error('[API] Failed to parse notifications response:', e);
        showNotification('Could not read notifications from server.', true);
        return defaultResponse;
    }
}

/**
 * Deletes a scheduled program notification from the backend.
 * @param {string|number} notificationId - The ID of the notification to delete.
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function deleteProgramNotification(notificationId) {
    console.log('[API] Deleting program notification ID:', notificationId);
    const res = await apiFetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
    });
    if (!res) return false;

    const data = await res.json();
    if (res.ok && data.success) {
        showNotification('Notification removed.');
        console.log(`[API] Program notification ID ${notificationId} deleted successfully.`);
        return true;
    } else {
        console.error(`[API] Failed to delete notification ID ${notificationId}:`, data.error);
        showNotification(data.error || 'Could not remove notification.', true);
        return false;
    }
}
