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
    console.log('[AUTH_UI] Displaying login screen. Error:', errorMsg);
    UIElements.authContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('hidden');
    UIElements.loginForm.classList.remove('hidden');
    UIElements.setupForm.classList.add('hidden');
    UIElements.authLoader.classList.add('hidden');
    if (errorMsg) {
        UIElements.loginError.textContent = errorMsg;
        UIElements.loginError.classList.remove('hidden');
    } else {
        UIElements.loginError.classList.add('hidden'); // Clear previous errors
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
    UIElements.authLoader.classList.add('hidden');
};

/**
 * Shows the main application container and hides the auth screen.
 * @param {object} user - The user object { username, isAdmin }.
 */
const showApp = (user) => {
    console.log('[AUTH_UI] Displaying main application. User:', user.username, 'isAdmin:', user.isAdmin);
    appState.currentUser = user;
    UIElements.authContainer.classList.add('hidden');
    UIElements.appContainer.classList.remove('hidden');
    UIElements.appContainer.classList.add('flex');

    UIElements.userDisplay.textContent = user.username;
    UIElements.userDisplay.classList.remove('hidden');
    UIElements.userManagementSection.classList.toggle('hidden', !user.isAdmin);

    if (!appState.appInitialized) {
        console.log('[AUTH_UI] App not yet initialized. Calling initMainApp...');
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
    UIElements.authLoader.classList.remove('hidden'); // Ensure loader is visible
    UIElements.loginForm.classList.add('hidden');
    UIElements.setupForm.classList.add('hidden');

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
        UIElements.authLoader.classList.add('hidden'); // Hide loader regardless of outcome
    }
}

/**
 * Sets up event listeners for the authentication forms (login, setup, logout).
 */
export function setupAuthEventListeners() {
    console.log('[AUTH_EVENTS] Setting up authentication event listeners...');
    UIElements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[AUTH_EVENTS] Login form submitted.');
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
            console.log('[AUTH_EVENTS] Login API response:', res.status, data);
            if (res.ok) {
                showApp(data.user);
            } else {
                UIElements.loginError.textContent = data.error || "Login failed.";
                UIElements.loginError.classList.remove('hidden');
            }
        } catch (e) {
            console.error('[AUTH_EVENTS] Error during login fetch:', e);
            UIElements.loginError.textContent = "Network error or server unreachable during login.";
            UIElements.loginError.classList.remove('hidden');
        }
    });

    UIElements.setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[AUTH_EVENTS] Setup form submitted.');
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
            console.log('[AUTH_EVENTS] Setup API response:', res.status, data);
            if (res.ok) {
                showApp(data.user);
            } else {
                UIElements.setupError.textContent = data.error || "Setup failed.";
                UIElements.setupError.classList.remove('hidden');
            }
        } catch (e) {
            console.error('[AUTH_EVENTS] Error during setup fetch:', e);
            UIElements.setupError.textContent = "Network error or server unreachable during setup.";
            UIElements.setupError.classList.remove('hidden');
        }
    });

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
    console.log('[AUTH_EVENTS] Authentication event listeners setup complete.');
}
```

---

## 🔍 How to Use These Logs

1.  **Replace the files**: Copy and paste the content of the updated files into their respective locations in your project.
2.  **Rebuild Docker**: You'll need to rebuild your Docker image for the changes in `server.js` to take effect.
    ```bash
    docker-compose down # Stop and remove old container
    docker-compose build --no-cache # Rebuild image from scratch
    docker-compose up -d # Run the new container
    ```
3.  **Check Docker Logs**: After running `docker-compose up -d`, immediately check the server logs:
    ```bash
    docker logs -f viniplay
    
