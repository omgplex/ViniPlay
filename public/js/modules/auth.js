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
    UIElements.authLoader.classList.add('hidden');
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
    UIElements.authLoader.classList.add('hidden');
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

    // UPDATED: Set user display text in the new sidebar location
    UIElements.sidebarUserDisplay.textContent = `Welcome, ${user.username}`;
    
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
    try {
        const res = await fetch('/api/auth/status');
        const status = await res.json();

        if (status.isLoggedIn) {
            showApp(status.user);
        } else {
            // If not logged in, check if the app needs initial setup
            const setupRes = await fetch('/api/auth/needs-setup');
            const setup = await setupRes.json();
            if (setup.needsSetup) {
                showSetupScreen();
            } else {
                showLoginScreen();
            }
        }
    } catch (e) {
        console.error("Auth check failed:", e);
        showLoginScreen("Could not verify authentication status.");
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

    // UPDATED: Listener attached to the new logout button in the sidebar
    UIElements.sidebarLogoutBtn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.reload();
    });
}
