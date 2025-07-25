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
    try {
        const response = await fetch(url, options);
        // If the session expired, the server will return a 401 Unauthorized
        if (response.status === 401) {
            showLoginScreen("Your session has expired. Please log in again.");
            return null;
        }
        return response;
    } catch (error) {
        console.error('API Fetch error:', error);
        showNotification("Could not connect to the server.", true);
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
    const res = await apiFetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
    });
    if (!res || !res.ok) {
        console.error(`Failed to save user setting: ${key}`);
        showNotification(`Could not save setting: ${key}`, true);
        return false;
    }
    return true;
}

/**
 * Saves a global (app-wide) setting to the backend.
 * @param {object} settingObject - An object containing the setting(s) to save.
 * @returns {Promise<object|null>} - The updated settings object from the server or null on failure.
 */
export async function saveGlobalSetting(settingObject) {
    const res = await apiFetch('/api/save/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingObject)
    });
    if (!res) return null;

    const data = await res.json();
    if (res.ok && data.settings) {
        return data.settings;
    } else {
        console.error(`Failed to save global setting:`, settingObject);
        showNotification(data.error || 'A global setting could not be saved.', true);
        return null;
    }
}

// NEW: Notification API functions

/**
 * Adds a program notification to the backend.
 * @param {object} notificationData - Object containing notification details.
 * @returns {Promise<object|null>} - The added notification object with its ID, or null on failure.
 */
export async function addProgramNotification(notificationData) {
    const res = await apiFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationData)
    });
    if (!res) return null;

    const data = await res.json();
    if (res.ok && data.success) {
        return { id: data.id, ...notificationData };
    } else {
        console.error('Failed to add notification:', data.error);
        showNotification(data.error || 'Could not add notification.', true);
        return null;
    }
}

/**
 * Fetches all program notifications for the current user from the backend.
 * @returns {Promise<Array<object>>} - An array of notification objects, or empty array on failure.
 */
export async function getProgramNotifications() {
    const res = await apiFetch('/api/notifications');
    if (!res) return [];

    const data = await res.json();
    if (res.ok) {
        return data;
    } else {
        console.error('Failed to get notifications:', data.error);
        showNotification(data.error || 'Could not retrieve notifications.', true);
        return [];
    }
}

/**
 * Deletes a program notification from the backend.
 * @param {number} notificationId - The ID of the notification to delete.
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function deleteProgramNotification(notificationId) {
    const res = await apiFetch(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
    });
    if (!res) return false;

    const data = await res.json();
    if (res.ok && data.success) {
        showNotification('Notification removed.');
        return true;
    } else {
        console.error('Failed to delete notification:', data.error);
        showNotification(data.error || 'Could not remove notification.', true);
        return false;
    }
}
