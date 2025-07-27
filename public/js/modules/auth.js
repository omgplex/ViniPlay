/**
 * auth.js
 * * Handles user authentication, including login, logout, and initial setup.
 */

import { UIElements, appState } from './state.js';
import { initMainApp } from '../main.js'; // Ensure initMainApp is imported

/**
 * Shows the login form.
 * @param {string|null} errorMsg - An optional error message to display.
 */
export const showLoginScreen = (errorMsg = null) => {
    console.log('[AUTH_UI] Displaying login screen. Error:', errorMsg);

    const authContainer = document.getElementById('auth-container');
    const loginForm = document.getElementById('login-form');
    const setupForm = document.getElementById('setup-form');
    const authLoader = document.getElementById('auth-loader');
    const loginError = document.getElementById('login-error');
    const appContainer = document.getElementById('app-container'); // Also get appContainer here for consistency

    // Ensure core elements are available before proceeding
    if (!authContainer || !loginForm || !setupForm || !authLoader || !appContainer) {
        console.error('[AUTH_UI] Critical auth UI elements not found. Cannot show login screen. Missing elements:', { authContainer: !!authContainer, loginForm: !!loginForm, setupForm: !!setupForm, authLoader: !!authLoader, appContainer: !!appContainer });
        return; // Prevent further errors if elements are missing
    }

    authContainer.classList.remove('hidden');
    appContainer.classList.add('hidden'); // Ensure app container is hidden
    loginForm.classList.remove('hidden');
    setupForm.classList.add('hidden');
    authLoader.classList.add('hidden');
    
    if (loginError) {
        if (errorMsg) {
            loginError.textContent = errorMsg;
            loginError.classList.remove('hidden');
        } else {
            loginError.classList.add('hidden'); // Clear previous errors
        }
    } else {
        console.warn('[AUTH_UI] loginError element not found.');
    }
};

/**
 * Shows the initial admin setup form.
 */
const showSetupScreen = () => {
    console.log('[AUTH_UI] Displaying setup screen.');

    const authContainer = document.getElementById('auth-container');
    const loginForm = document.getElementById('login-form');
    const setupForm = document.getElementById('setup-form');
    const authLoader = document.getElementById('auth-loader');
    const appContainer = document.getElementById('app-container'); // Also get appContainer here for consistency


    // Ensure core elements are available before proceeding
    if (!authContainer || !loginForm || !setupForm || !authLoader || !appContainer) {
        console.error('[AUTH_UI] Critical auth UI elements not found. Cannot show setup screen. Missing elements:', { authContainer: !!authContainer, loginForm: !!loginForm, setupForm: !!setupForm, authLoader: !!authLoader, appContainer: !!appContainer });
        return; // Prevent further errors if elements are missing
    }

    authContainer.classList.remove('hidden');
    appContainer.classList.add('hidden'); // Ensure app container is hidden
    loginForm.classList.add('hidden');
    setupForm.classList.remove('hidden');
    authLoader.classList.add('hidden');
    // setupError element check can be added if needed, similar to loginError
};

/**
 * Shows the main application container and hides the auth screen.
 * @param {object} user - The user object { username, isAdmin }.
 */
const showApp = (user) => {
    console.log('[AUTH_UI] Displaying main application. User:', user.username, 'isAdmin:', user.isAdmin);
    appState.currentUser = user;

    // Directly query for authContainer and appContainer here to ensure they are found.
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');

    if (!authContainer || !appContainer) {
        console.error('[AUTH_UI] authContainer or appContainer not found. Cannot show app. Missing:', {authContainer: !!authContainer, appContainer: !!appContainer});
        // You might want a fallback here, like reloading or showing a severe error.
        return;
    }

    authContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');
    appContainer.classList.add('flex'); // Make it visible and use flex layout

    // Update user display and admin sections
    if (UIElements.userDisplay) UIElements.userDisplay.textContent = user.username;
    if (UIElements.userDisplay) UIElements.userDisplay.classList.remove('hidden');
    if (UIElements.userManagementSection) UIElements.userManagementSection.classList.toggle('hidden', !user.isAdmin);

    // Initialize the main app logic only once, now that UIElements are in the DOM
    if (!appState.appInitialized) {
        console.log('[AUTH_UI] App not yet initialized. Calling initMainApp...');
        // initMainApp is now responsible for calling initializeUIElements()
        initMainApp(); 
        appState.appInitialized = true;
    } else {
        console.log('[AUTH_UI] App already initialized, skipping initMainApp.');
    }
};

/**
 * Checks the user's authentication status with the server.
 * Determines whether to show the login, setup, or main app screen.
 */
export async function checkAuthStatus() {
    console.log('[AUTH_STATUS] Checking authentication status with backend...');

    const authLoader = document.getElementById('auth-loader');
    const loginForm = document.getElementById('login-form');
    const setupForm = document.getElementById('setup-form');


    // Basic check for existence of critical loader element
    if (authLoader) {
        authLoader.classList.remove('hidden'); // Ensure loader is visible
    } else {
        console.error('[AUTH_STATUS] authLoader element not found. Cannot show loader.');
        // Consider a basic alert or direct redirection if auth loader is truly missing
    }
    // Also check login/setup forms before hiding
    if (loginForm) loginForm.classList.add('hidden');
    if (setupForm) setupForm.classList.add('hidden');

    try {
        console.log('[AUTH_STATUS] Fetching /api/auth/status...');
        const res = await fetch('/api/auth/status');
        
        if (!res.ok) {
            const errorText = await res.text();
            console.error(`[AUTH_STATUS] Fetch /api/auth/status failed: ${res.status} ${res.statusText}. Body: ${errorText}`);
            showLoginScreen("Failed to connect to authentication server.");
            return;
        }

        const status = await res.json();
        console.log('[AUTH_STATUS] Received /api/auth/status response:', status);

        if (status.isLoggedIn) {
            console.log('[AUTH_STATUS] User is logged in. Calling showApp.');
            showApp(status.user);
        } else {
            console.log('[AUTH_STATUS] User is not logged in. Checking if setup is needed...');
            const setupRes = await fetch('/api/auth/needs-setup');
            
            if (!setupRes.ok) {
                const errorText = await setupRes.text();
                console.error(`[AUTH_STATUS] Fetch /api/auth/needs-setup failed: ${setupRes.status} ${setupRes.statusText}. Body: ${errorText}`);
                showLoginScreen("Failed to determine setup status.");
                return;
            }

            const setup = await setupRes.json();
            console.log('[AUTH_STATUS] Received /api/auth/needs-setup response:', setup);
            if (setup.needsSetup) {
                console.log('[AUTH_STATUS] App needs setup. Showing setup screen.');
                showSetupScreen();
            } else {
                console.log('[AUTH_STATUS] App does not need setup. Showing login screen.');
                showLoginScreen();
            }
        }
    } catch (e) {
        console.error("[AUTH_STATUS] Uncaught error during auth check:", e);
        showLoginScreen("Could not verify authentication status. Network error or server unreachable.");
    } finally {
        if (authLoader) { // Hide loader only if it was found
            authLoader.classList.add('hidden'); 
        }
    }
}

/**
 * Sets up event listeners for the authentication forms (login, setup, logout).
 */
export function setupAuthEventListeners() {
    console.log('[AUTH_EVENTS] Setting up authentication event listeners...');

    const loginForm = document.getElementById('login-form');
    const setupForm = document.getElementById('setup-form');
    const logoutBtn = document.getElementById('logout-btn');

    // Add checks for UIElements existence before attaching listeners
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[AUTH_EVENTS] Login form submitted.');
            const loginError = document.getElementById('login-error'); // Get locally
            const loginUsername = document.getElementById('login-username');
            const loginPassword = document.getElementById('login-password');

            if (loginError) loginError.classList.add('hidden'); 
            const username = loginUsername?.value;
            const password = loginPassword?.value;

            if (!username || !password) {
                if (loginError) {
                    loginError.textContent = "Username and password are required.";
                    loginError.classList.remove('hidden');
                }
                console.warn('[AUTH_EVENTS] Login attempt with missing username or password.');
                return;
            }

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                console.log('[AUTH_EVENTS] Login API response:', res.status, data);
                if (res.ok) {
                    showApp(data.user);
                } else {
                    if (loginError) {
                        loginError.textContent = data.error || "Login failed.";
                        loginError.classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error('[AUTH_EVENTS] Error during login fetch:', e);
                if (loginError) {
                    loginError.textContent = "Network error or server unreachable during login.";
                    loginError.classList.remove('hidden');
                }
            }
        });
    } else {
        console.error('[AUTH_EVENTS] loginForm not found. Cannot attach submit listener.');
    }

    if (setupForm) {
        setupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[AUTH_EVENTS] Setup form submitted.');
            const setupError = document.getElementById('setup-error'); // Get locally
            const setupUsername = document.getElementById('setup-username');
            const setupPassword = document.getElementById('setup-password');

            if (setupError) setupError.classList.add('hidden'); 
            const username = setupUsername?.value;
            const password = setupPassword?.value;

            if (!username || !password) {
                if (setupError) {
                    setupError.textContent = "Admin username and password are required.";
                    setupError.classList.remove('hidden');
                }
                console.warn('[AUTH_EVENTS] Setup attempt with missing username or password.');
                return;
            }

            try {
                const res = await fetch('/api/auth/setup-admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                console.log('[AUTH_EVENTS] Setup API response:', res.status, data);
                if (res.ok) {
                    showApp(data.user);
                } else {
                    if (setupError) {
                        setupError.textContent = data.error || "Setup failed.";
                        setupError.classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error('[AUTH_EVENTS] Error during setup fetch:', e);
                if (setupError) {
                    setupError.textContent = "Network error or server unreachable during setup.";
                    setupError.classList.remove('hidden');
                }
            }
        });
    } else {
        console.error('[AUTH_EVENTS] setupForm not found. Cannot attach submit listener.');
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            console.log('[AUTH_EVENTS] Logout button clicked.');
            try {
                const res = await fetch('/api/auth/logout', { method: 'POST' });
                console.log('[AUTH_EVENTS] Logout API response:', res.status);
            } catch (e) {
                console.error('[AUTH_EVENTS] Error during logout fetch:', e);
            } finally {
                window.location.reload(); // Always reload on logout
            }
        });
    } else {
        console.warn('[AUTH_EVENTS] logoutBtn not found. Logout functionality may be impaired.');
    }
    console.log('[AUTH_EVENTS] Authentication event listeners setup complete.');
}

