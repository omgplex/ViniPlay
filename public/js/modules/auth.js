/**
 * auth.js
 * * Handles user authentication, including login, logout, and initial setup.
 */

import { UIElements, appState } from './state.js';
import { initMainApp } from '../main.js';

/**
 * Shows the login form.
 * @param {string|null} errorMsg - An optional error message to display.
 */
export const showLoginScreen = (errorMsg = null) => {
    UIElements.authContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('hidden');
    UIElements.loginForm.classList.remove('hidden');
    UIElements.setupForm.classList.add('hidden');
    if (UIElements.authLoader) UIElements.authLoader.classList.add('hidden'); // Ensure loader is hidden
    if (errorMsg) {
        UIElements.loginError.textContent = errorMsg;
        UIElements.loginError.classList.remove('hidden');
    }
};

/**
 * Shows the initial admin setup form.
 */
const showSetupScreen = () => {
    UIElements.authContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('hidden');
    UIElements.loginForm.classList.add('hidden');
    UIElements.setupForm.classList.remove('hidden');
    if (UIElements.authLoader) UIElements.authLoader.classList.add('hidden'); // Ensure loader is hidden
};

/**
 * Shows the main application container and hides the auth screen.
 * @param {object} user - The user object { username, isAdmin }.
 */
const showApp = (user) => {
    appState.currentUser = user;
    UIElements.authContainer.classList.add('hidden');
    UIElements.appContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('flex');
    if (UIElements.authLoader) UIElements.authLoader.classList.add('hidden'); // Ensure loader is hidden

    // Display only the username, without "Welcome,"
    UIElements.userDisplay.textContent = user.username;
    UIElements.userDisplay.classList.remove('hidden');
    UIElements.userManagementSection.classList.toggle('hidden', !user.isAdmin);

    // Initialize the main app logic only once
    if (!appState.appInitialized) {
        initMainApp();
        appState.appInitialized = true;
    }
};

/**
 * Checks the user's authentication status with the server.
 * Determines whether to show the login, setup, or main app screen.
 */
export async function checkAuthStatus() {
    // Ensure loader is visible and auth container is shown while checking status
    if (UIElements.authLoader) UIElements.authLoader.classList.remove('hidden');
    UIElements.authContainer.classList.remove('hidden');

    try {
        const res = await fetch('/api/auth/status');
        // Check if response is OK before trying to parse JSON
        if (!res.ok) {
            // For non-OK responses, still try to parse JSON for error message,
            // but ensure the loader is hidden afterwards.
            const errorData = await res.json().catch(() => ({ error: `Server error: ${res.status}` }));
            throw new Error(errorData.error || `Server responded with status: ${res.status}`);
        }

        const status = await res.json();

        if (status.isLoggedIn) {
            showApp(status.user);
        } else {
            const setupRes = await fetch('/api/auth/needs-setup');
            if (!setupRes.ok) {
                const errorData = await setupRes.json().catch(() => ({ error: `Server error: ${setupRes.status}` }));
                throw new Error(errorData.error || `Server responded with status: ${setupRes.status}`);
            }
            const setup = await setupRes.json();
            if (setup.needsSetup) {
                showSetupScreen();
            } else {
                showLoginScreen();
            }
        }
    } catch (e) {
        console.error("Auth check failed:", e);
        // Explicitly hide loader and show login screen with error
        showLoginScreen("Could not verify authentication status: " + e.message);
    }
}

/**
 * Sets up event listeners for the authentication forms (login, setup, logout).
 */
export function setupAuthEventListeners() {
    UIElements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        UIElements.loginError.classList.add('hidden');
        const username = UIElements.loginUsername.value;
        const password = UIElements.loginPassword.value;
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            showApp(data.user);
        } else {
            UIElements.loginError.textContent = data.error;
            UIElements.loginError.classList.remove('hidden');
        }
    });

    UIElements.setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        UIElements.setupError.classList.add('hidden');
        const username = UIElements.setupUsername.value;
        const password = UIElements.setupPassword.value;
        const res = await fetch('/api/auth/setup-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            showApp(data.user);
        } else {
            UIElements.setupError.textContent = data.error;
            UIElements.setupError.classList.remove('hidden');
        }
    });

    UIElements.logoutBtn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.reload();
    });
}
```
