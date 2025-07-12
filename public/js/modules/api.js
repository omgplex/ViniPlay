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
