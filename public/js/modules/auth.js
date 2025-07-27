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

    // Ensure core elements are available before proceeding
    if (!UIElements.authContainer || !UIElements.loginForm || !UIElements.setupForm || !UIElements.authLoader) {
        console.error('[AUTH_UI] Critical auth UI elements not found. Cannot show login screen.');
        return; // Prevent further errors if elements are missing
    }

    UIElements.authContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('hidden'); // Ensure app container is hidden
    UIElements.loginForm.classList.remove('hidden');
    UIElements.setupForm.classList.add('hidden');
    UIElements.authLoader.classList.add('hidden');
    
    if (UIElements.loginError) { // Check for loginError element too
        if (errorMsg) {
            UIElements.loginError.textContent = errorMsg;
            UIElements.loginError.classList.remove('hidden');
        } else {
            UIElements.loginError.classList.add('hidden'); // Clear previous errors
        }
    } else {
        console.warn('[AUTH_UI] UIElements.loginError not found.');
    }
};

/**
 * Shows the initial admin setup form.
 */
const showSetupScreen = () => {
    console.log('[AUTH_UI] Displaying setup screen.');

    // Ensure core elements are available before proceeding
    if (!UIElements.authContainer || !UIElements.loginForm || !UIElements.setupForm || !UIElements.authLoader) {
        console.error('[AUTH_UI] Critical auth UI elements not found. Cannot show setup screen.');
        return; // Prevent further errors if elements are missing
    }

    UIElements.authContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('hidden'); // Ensure app container is hidden
    UIElements.loginForm.classList.add('hidden');
    UIElements.setupForm.classList.remove('hidden');
    UIElements.authLoader.classList.add('hidden');
    // setupError element check can be added if needed, similar to loginError
};

/**
 * Shows the main application container and hides the auth screen.
 * @param {object} user - The user object { username, isAdmin }.
 */
const showApp = (user) => {
    console.log('[AUTH_UI] Displaying main application. User:', user.username, 'isAdmin:', user.isAdmin);
    appState.currentUser = user;

    if (!UIElements.authContainer || !UIElements.appContainer) {
        console.error('[AUTH_UI] authContainer or appContainer not found. Cannot show app.');
        return;
    }

    UIElements.authContainer.classList.add('hidden');
    UIElements.appContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('flex'); // Make it visible and use flex layout

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

    // Basic check for existence of critical loader element
    if (UIElements.authLoader) {
        UIElements.authLoader.classList.remove('hidden'); // Ensure loader is visible
    } else {
        console.error('[AUTH_STATUS] UIElements.authLoader not found. Cannot show loader.');
        // Consider a basic alert or direct redirection if auth loader is truly missing
    }
    // Also check login/setup forms before hiding
    if (UIElements.loginForm) UIElements.loginForm.classList.add('hidden');
    if (UIElements.setupForm) UIElements.setupForm.classList.add('hidden');

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
            console.log('[AUTH_STATUS] User is logged in. Showing app.');
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
        if (UIElements.authLoader) { // Hide loader only if it was found
            UIElements.authLoader.classList.add('hidden'); 
        }
    }
}

/**
 * Sets up event listeners for the authentication forms (login, setup, logout).
 */
export function setupAuthEventListeners() {
    console.log('[AUTH_EVENTS] Setting up authentication event listeners...');

    // Add checks for UIElements existence before attaching listeners
    if (UIElements.loginForm) {
        UIElements.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[AUTH_EVENTS] Login form submitted.');
            UIElements.loginError?.classList.add('hidden'); 
            const username = UIElements.loginUsername?.value;
            const password = UIElements.loginPassword?.value;

            if (!username || !password) {
                if (UIElements.loginError) {
                    UIElements.loginError.textContent = "Username and password are required.";
                    UIElements.loginError.classList.remove('hidden');
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
                    if (UIElements.loginError) {
                        UIElements.loginError.textContent = data.error || "Login failed.";
                        UIElements.loginError.classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error('[AUTH_EVENTS] Error during login fetch:', e);
                if (UIElements.loginError) {
                    UIElements.loginError.textContent = "Network error or server unreachable during login.";
                    UIElements.loginError.classList.remove('hidden');
                }
            }
        });
    } else {
        console.error('[AUTH_EVENTS] UIElements.loginForm not found. Cannot attach submit listener.');
    }

    if (UIElements.setupForm) {
        UIElements.setupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('[AUTH_EVENTS] Setup form submitted.');
            UIElements.setupError?.classList.add('hidden'); 
            const username = UIElements.setupUsername?.value;
            const password = UIElements.setupPassword?.value;

            if (!username || !password) {
                if (UIElements.setupError) {
                    UIElements.setupError.textContent = "Admin username and password are required.";
                    UIElements.setupError.classList.remove('hidden');
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
                    if (UIElements.setupError) {
                        UIElements.setupError.textContent = data.error || "Setup failed.";
                        UIElements.setupError.classList.remove('hidden');
                    }
                }
            } catch (e) {
                console.error('[AUTH_EVENTS] Error during setup fetch:', e);
                if (UIElements.setupError) {
                    UIElements.setupError.textContent = "Network error or server unreachable during setup.";
                    UIElements.setupError.classList.remove('hidden');
                }
            }
        });
    } else {
        console.error('[AUTH_EVENTS] UIElements.setupForm not found. Cannot attach submit listener.');
    }

    if (UIElements.logoutBtn) {
        UIElements.logoutBtn.addEventListener('click', async () => {
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
        console.warn('[AUTH_EVENTS] UIElements.logoutBtn not found. Logout functionality may be impaired.');
    }
    console.log('[AUTH_EVENTS] Authentication event listeners setup complete.');
}
```

---

## 🚦 Final Steps

1.  **Replace `public/js/modules/auth.js` with the code above.**
2.  **Ensure `public/js/main.js` is also updated** with the version I provided in the previous turn (where `initializeUIElements()` was moved inside `initMainApp()`).
3.  **Rebuild and Rerun Docker:**
    ```bash
    docker-compose down # Stop and remove existing container
    docker-compose build --no-cache # Rebuild the image from scratch
    docker-compose up -d # Run the new container in detached mode
    
