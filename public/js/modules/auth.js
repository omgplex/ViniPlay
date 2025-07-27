/**
 * auth.js
 * * Handles user authentication, including login, logout, and initial setup.
 */

import { UIElements, appState } from './state.js';
import { initMainApp } from '../main.js';
import { showNotification } from './ui.js'; // Import showNotification for consistent error display

/**
 * Shows the login form.
 * @param {string|null} errorMsg - An optional error message to display.
 */
export const showLoginScreen = (errorMsg = null) => {
    console.log('[AUTH_UI] Displaying login screen.');
    UIElements.authContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('hidden');
    UIElements.loginForm.classList.remove('hidden');
    UIElements.setupForm.classList.add('hidden');
    UIElements.authLoader.classList.add('hidden'); // Hide loader
    if (errorMsg) {
        UIElements.loginError.textContent = errorMsg;
        UIElements.loginError.classList.remove('hidden');
        console.error(`[AUTH_UI] Login error displayed: ${errorMsg}`);
    } else {
        UIElements.loginError.classList.add('hidden'); // Ensure error is hidden if no message
    }
};

/**
 * Shows the initial admin setup form.
 */
const showSetupScreen = () => {
    console.log('[AUTH_UI] Displaying setup screen.');
    UIElements.authContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('hidden');
    UIElements.loginForm.classList.add('hidden');
    UIElements.setupForm.classList.remove('hidden');
    UIElements.authLoader.classList.add('hidden'); // Hide loader
    UIElements.setupError.classList.add('hidden'); // Clear previous setup errors
};

/**
 * Shows the main application container and hides the auth screen.
 * @param {object} user - The user object { username, isAdmin }.
 */
const showApp = (user) => {
    console.log(`[AUTH_UI] Displaying main app for user: ${user.username} (Admin: ${user.isAdmin})`);
    appState.currentUser = user;
    UIElements.authContainer.classList.add('hidden');
    UIElements.appContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('flex'); // Ensure flex display for app layout

    UIElements.userDisplay.textContent = user.username;
    UIElements.userDisplay.classList.remove('hidden');
    UIElements.userManagementSection.classList.toggle('hidden', !user.isAdmin);
    console.log(`[AUTH_UI] User display set to: ${user.username}. Admin section visibility: ${!user.isAdmin ? 'hidden' : 'visible'}.`);

    // Initialize the main app logic only once
    if (!appState.appInitialized) {
        console.log('[AUTH_UI] Main app not initialized yet, calling initMainApp().');
        initMainApp();
        appState.appInitialized = true;
    } else {
        console.log('[AUTH_UI] Main app already initialized.');
    }
};

/**
 * Checks the user's authentication status with the server.
 * Determines whether to show the login, setup, or main app screen.
 */
export async function checkAuthStatus() {
    console.log('[AUTH] Starting authentication status check...');
    UIElements.authLoader.classList.remove('hidden'); // Show loader
    UIElements.loginError.classList.add('hidden'); // Clear any previous errors

    try {
        const res = await fetch('/api/auth/status');
        if (!res.ok) {
            console.warn(`[AUTH] /api/auth/status returned non-OK status: ${res.status} ${res.statusText}`);
            // If server isn't reachable or other server-side error, try to get more specific.
            // For now, let the catch block handle general fetch errors.
        }
        const status = await res.json();
        console.log('[AUTH] /api/auth/status response:', status);

        if (status.isLoggedIn) {
            console.log('[AUTH] User is logged in. Showing app.');
            showApp(status.user);
        } else {
            console.log('[AUTH] User not logged in. Checking if setup is needed...');
            const setupRes = await fetch('/api/auth/needs-setup');
            if (!setupRes.ok) {
                 console.warn(`[AUTH] /api/auth/needs-setup returned non-OK status: ${setupRes.status} ${setupRes.statusText}`);
            }
            const setup = await setupRes.json();
            console.log('[AUTH] /api/auth/needs-setup response:', setup);
            if (setup.needsSetup) {
                console.log('[AUTH] App needs initial admin setup. Showing setup screen.');
                showSetupScreen();
            } else {
                console.log('[AUTH] App does not need setup. Showing login screen.');
                showLoginScreen();
            }
        }
    } catch (e) {
        console.error("[AUTH] Authentication check failed:", e);
        // Display a general connection error if the fetch fails entirely
        showLoginScreen("Could not verify authentication status. Please check server connection.");
        showNotification("Failed to connect to authentication server.", true);
    } finally {
        UIElements.authLoader.classList.add('hidden'); // Always hide loader at the end
    }
}

/**
 * Sets up event listeners for the authentication forms (login, setup, logout).
 */
export function setupAuthEventListeners() {
    console.log('[AUTH] Setting up authentication event listeners.');
    UIElements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[AUTH_EVENT] Login form submitted.');
        UIElements.loginError.classList.add('hidden');
        const username = UIElements.loginUsername.value;
        const password = UIElements.loginPassword.value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            console.log('[AUTH_EVENT] Login API response:', data);

            if (res.ok) {
                console.log('[AUTH_EVENT] Login successful.');
                showApp(data.user);
            } else {
                console.warn(`[AUTH_EVENT] Login failed: ${data.error}`);
                UIElements.loginError.textContent = data.error;
                UIElements.loginError.classList.remove('hidden');
            }
        } catch (error) {
            console.error('[AUTH_EVENT] Login fetch error:', error);
            UIElements.loginError.textContent = "Failed to connect to server for login.";
            UIElements.loginError.classList.remove('hidden');
        }
    });

    UIElements.setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[AUTH_EVENT] Setup form submitted.');
        UIElements.setupError.classList.add('hidden');
        const username = UIElements.setupUsername.value;
        const password = UIElements.setupPassword.value;

        try {
            const res = await fetch('/api/auth/setup-admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            console.log('[AUTH_EVENT] Setup API response:', data);

            if (res.ok) {
                console.log('[AUTH_EVENT] Admin setup successful.');
                showApp(data.user);
            } else {
                console.warn(`[AUTH_EVENT] Admin setup failed: ${data.error}`);
                UIElements.setupError.textContent = data.error;
                UIElements.setupError.classList.remove('hidden');
            }
        } catch (error) {
            console.error('[AUTH_EVENT] Setup fetch error:', error);
            UIElements.setupError.textContent = "Failed to connect to server for setup.";
            UIElements.setupError.classList.remove('hidden');
        }
    });

    UIElements.logoutBtn.addEventListener('click', async () => {
        console.log('[AUTH_EVENT] Logout button clicked.');
        try {
            const res = await fetch('/api/auth/logout', { method: 'POST' });
            if (!res.ok) {
                console.warn(`[AUTH_EVENT] Logout API returned non-OK status: ${res.status}`);
            }
            console.log('[AUTH_EVENT] Logout request sent. Reloading window.');
            window.location.reload(); // Full reload to clear client state
        } catch (error) {
            console.error('[AUTH_EVENT] Logout fetch error:', error);
            showNotification("Failed to log out. Please try again.", true);
        }
    });
}
