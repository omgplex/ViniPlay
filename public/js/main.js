/**
 * main.js
 *
 * Main entry point for the ViniPlay application.
 * Initializes the app by setting up authentication, event listeners, and loading initial data.
 */

import { appState, guideState, UIElements, initializeUIElements } from './modules/state.js';
import { apiFetch } from './modules/api.js';
import { checkAuthStatus, setupAuthEventListeners } from './modules/auth.js';
import { handleGuideLoad, finalizeGuideLoad, setupGuideEventListeners } from './modules/guide.js';
import { setupPlayerEventListeners } from './modules/player.js';
import { setupSettingsEventListeners, populateTimezoneSelector, updateUIFromSettings } from './modules/settings.js';
import { makeModalResizable, handleRouteChange, switchTab, handleConfirm, closeModal, makeColumnResizable, openMobileMenu, closeMobileMenu, showNotification } from './modules/ui.js';
import { loadAndScheduleNotifications, subscribeUserToPush } from './modules/notification.js';
import { parseM3U } from './modules/utils.js'; // NEW: Import parseM3U

/**
 * Initializes the main application after successful authentication.
 */
export async function initMainApp() {
    console.log('[MAIN] Initializing main application...');
    // 1. Initialize IndexedDB for caching
    try {
        appState.db = await openDB();
        console.log('[MAIN] IndexedDB initialized successfully.');
    } catch (e) {
        console.error('[MAIN] Error initializing IndexedDB:', e);
        showNotification("Could not initialize local cache. Data may not persist.", true);
    }

    // 2. Setup all event listeners for the main app
    console.log('[MAIN] Setting up all event listeners...');
    setupCoreEventListeners();
    setupGuideEventListeners();
    setupPlayerEventListeners();
    setupSettingsEventListeners();
    console.log('[MAIN] All event listeners set up.');

    // 3. Load initial configuration and guide data
    try {
        console.log('[MAIN] Fetching initial configuration from server...');
        // Fetch config without specific date to get M3U and global settings
        const response = await apiFetch(`/api/config?t=${Date.now()}`); 
        if (!response || !response.ok) {
            const errorText = response ? `Status: ${response.status} ${response.statusText}` : 'No response from server.';
            throw new Error(`Could not load configuration from server. ${errorText}`);
        }

        const config = await response.json();
        console.log('[MAIN] Configuration loaded:', config);
        Object.assign(guideState.settings, config.settings || {}); // Merge server settings into guideState

        // Restore UI dimensions from settings
        restoreDimensions();
        // Populate timezone selector and update other settings UI
        populateTimezoneSelector();
        updateUIFromSettings();

        // Show initial loading indicator for guide
        UIElements.initialLoadingIndicator.classList.remove('hidden');
        UIElements.guidePlaceholder.classList.remove('hidden');

        // Load initial guide data including a range of dates
        await loadInitialGuideData(config.m3uContent, config.epgContent); // Pass initial EPG for potential merge

        // Load the list of scheduled notifications for the UI
        console.log('[MAIN] Loading and scheduling notifications...');
        await loadAndScheduleNotifications();

        // Subscribe to push notifications
        console.log('[MAIN] Attempting to subscribe to push notifications...');
        await subscribeUserToPush();
        console.log('[MAIN] Push notification subscription process initiated.');

        // Handle initial route based on URL
        console.log('[MAIN] Handling initial route change.');
        handleRouteChange();

    } catch (e) {
        console.error('[MAIN] Application initialization failed:', e);
        showNotification("Initialization failed: " + e.message, true);
        UIElements.initialLoadingIndicator.classList.add('hidden');
        UIElements.noDataMessage.classList.remove('hidden'); // Ensure no data message is shown
        switchTab('settings'); // Suggest going to settings to add sources
    }
}

/**
 * Loads initial guide data, attempting from IndexedDB first, then fetching from server.
 * Ensures a range of dates (e.g., yesterday, today, tomorrow) is loaded for infinite scroll.
 * @param {string} initialM3uContent - M3U content from the initial /api/config call.
 * @param {object} initialEpgContent - EPG content from the initial /api/config call (might be full EPG or empty if no date param was passed).
 */
async function loadInitialGuideData(initialM3uContent, initialEpgContent) {
    let cachedChannels = null;
    let cachedProgramCache = null;
    let cachedLoadedDates = null;

    // Attempt to load cached data first
    try {
        console.log('[MAIN] Attempting to load guide data from IndexedDB cache...');
        cachedChannels = await loadDataFromDB('channels');
        cachedProgramCache = await loadDataFromDB('programCache');
        cachedLoadedDates = await loadDataFromDB('loadedDates');

        if (cachedChannels?.length > 0 && cachedProgramCache && cachedLoadedDates?.length > 0) {
            console.log('[MAIN] Loaded guide data from cache. Finalizing guide load.');
            guideState.channels = cachedChannels;
            guideState.programCache = cachedProgramCache;
            guideState.loadedDates = new Set(cachedLoadedDates);
            finalizeGuideLoad(true); // true indicates first load
            
            // Check if essential dates are loaded, if not, fetch them
            await ensureDateRangeLoaded();

            return; // Exit if data loaded from cache and initial date range is covered
        }
    } catch (e) {
        console.warn('[MAIN] Error loading cached data:', e);
        // Continue to fetch from server if cache fails
    }

    // If no complete cached data, proceed with server content
    console.log('[MAIN] No complete cached data. Processing guide data from server config and fetching required dates.');
    if (initialM3uContent) {
        guideState.channels = parseM3U(initialM3uContent);
    } else {
        UIElements.initialLoadingIndicator.classList.add('hidden');
        UIElements.noDataMessage.classList.remove('hidden');
        return; // No M3U content, nothing to display
    }

    // For initial load, fetch EPG data for a range of dates around 'now'
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of today

    const datesToLoad = [
        new Date(today.getTime() - 24 * 3600 * 1000), // Yesterday
        today,                                       // Today
        new Date(today.getTime() + 24 * 3600 * 1000), // Tomorrow
        new Date(today.getTime() + 2 * 24 * 3600 * 1000) // Day after tomorrow (optional, for smooth right scroll)
    ];

    for (const date of datesToLoad) {
        const dateKey = date.toISOString().slice(0, 10);
        if (!guideState.loadedDates.has(dateKey)) {
            guideState.loadingEpgData = true; // Set flag
            try {
                const response = await apiFetch(`/api/config?date=${dateKey}&t=${Date.now()}`);
                if (response && response.ok) {
                    const config = await response.json();
                    if (config.epgContent) {
                        handleGuideLoad(initialM3uContent, config.epgContent, date, false); // Merge, not initial load
                    }
                } else {
                    console.warn(`[MAIN] Failed to fetch EPG for ${dateKey}: ${response?.statusText || 'Unknown error'}`);
                }
            } catch (e) {
                console.error(`[MAIN] Error fetching EPG for ${dateKey}:`, e);
            } finally {
                guideState.loadingEpgData = false; // Clear flag
            }
        }
    }
    
    finalizeGuideLoad(true); // Finalize after all initial date fetches
}


/**
 * Ensures that the necessary date range (e.g., around `currentDate`) is loaded.
 * This can be called after initial load from cache to verify coverage.
 */
async function ensureDateRangeLoaded() {
    const today = new Date(guideState.currentDate);
    today.setHours(0, 0, 0, 0);

    const datesToCheck = [
        new Date(today.getTime() - 24 * 3600 * 1000), // Yesterday
        today,                                       // Today
        new Date(today.getTime() + 24 * 3600 * 1000), // Tomorrow
        new Date(today.getTime() + 2 * 24 * 3600 * 1000) // Day after tomorrow
    ];

    for (const date of datesToCheck) {
        const dateKey = date.toISOString().slice(0, 10);
        if (!guideState.loadedDates.has(dateKey)) {
            console.log(`[MAIN] Missing EPG data for ${dateKey}. Fetching...`);
            // Call fetchEpgForDate from guide.js
            // Note: A direct import of fetchEpgForDate from guide.js would create a circular dependency.
            // For now, we simulate by directly calling apiFetch and handleGuideLoad here.
            // A more robust solution might be to move fetchEpgForDate into api.js or a shared util.
            guideState.loadingEpgData = true;
            try {
                const response = await apiFetch(`/api/config?date=${dateKey}&t=${Date.now()}`);
                if (response && response.ok) {
                    const config = await response.json();
                    if (config.epgContent) {
                        // Pass an empty m3uContent as it's already handled during app initialization
                        handleGuideLoad('', config.epgContent, date, false); 
                    }
                }
            } catch (e) {
                console.error(`[MAIN] Error ensuring EPG for ${dateKey}:`, e);
            } finally {
                guideState.loadingEpgData = false;
            }
        }
    }
}


/**
 * Opens and sets up the IndexedDB database.
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ViniPlayDB_v3', 1); // Increment version for schema changes
        request.onerror = (event) => {
            console.error('[IndexedDB] Error opening database:', event.target.errorCode);
            reject("Error opening IndexedDB.");
        };
        request.onsuccess = (event) => {
            const dbInstance = event.target.result;
            console.log('[IndexedDB] Database opened successfully.');
            resolve(dbInstance);
        };
        request.onupgradeneeded = (event) => {
            console.log('[IndexedDB] Database upgrade needed. Old version:', event.oldVersion, 'New version:', event.newVersion);
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains('guideData')) {
                dbInstance.createObjectStore('guideData');
                console.log('[IndexedDB] Created "guideData" object store.');
            }
            // Add any future schema upgrades here (e.g., 'programCache', 'loadedDates')
            // This is crucial: ensure these stores are created on upgrade
            if (!dbInstance.objectStoreNames.contains('guideData_channels')) { // Old approach had keys like 'channels' directly in 'guideData'
                // For ViniPlayDB_v3, we use a single 'guideData' store with specific keys
                // The current schema uses 'channels', 'programCache', 'loadedDates' as keys within 'guideData'
            }
        };
    });
}

/**
 * Loads data from IndexedDB.
 */
async function loadDataFromDB(key) {
    if (!appState.db) {
        console.warn('[IndexedDB] Cannot load data: DB instance is null.');
        return null;
    }
    return new Promise((resolve, reject) => {
        try {
            const transaction = appState.db.transaction(['guideData'], 'readonly');
            const store = transaction.objectStore('guideData');
            const request = store.get(key);
            request.onsuccess = () => {
                if (request.result) {
                    console.log(`[IndexedDB] Data for key "${key}" loaded from cache.`);
                } else {
                    console.log(`[IndexedDB] No data found for key "${key}" in cache.`);
                }
                resolve(request.result);
            };
            request.onerror = (event) => {
                console.error(`[IndexedDB] Error loading data for key "${key}" from DB:`, event.target.error);
                reject("Error loading data from DB.");
            };
        } catch (e) {
            console.error(`[IndexedDB] Unexpected error during loadDataFromDB for key "${key}":`, e);
            reject(e);
        }
    });
}


/**
 * Restores the dimensions of resizable modals and the channel column from saved settings.
 */
function restoreDimensions() {
    console.log('[MAIN] Restoring UI dimensions from settings.');
    if (guideState.settings.playerDimensions && UIElements.videoModalContainer) {
        const { width, height } = guideState.settings.playerDimensions;
        if (width) UIElements.videoModalContainer.style.width = `${width}px`;
        if (height) UIElements.videoModalContainer.style.height = `${height}px`;
        console.log(`[MAIN] Restored player dimensions: ${width}x${height}`);
    }
    if (UIElements.programDetailsDimensions && UIElements.programDetailsContainer) {
        const { width, height } = guideState.settings.programDetailsDimensions;
        if (width) UIElements.programDetailsContainer.style.width = `${width}px`;
        if (height) UIElements.programDetailsContainer.style.height = `${height}px`;
        console.log(`[MAIN] Restored program details dimensions: ${width}x${height}`);
    }
    if (guideState.settings.channelColumnWidth && UIElements.guideGrid) {
        UIElements.guideGrid.style.setProperty('--channel-col-width', `${guideState.settings.channelColumnWidth}px`);
        console.log(`[MAIN] Restored channel column width: ${guideState.settings.channelColumnWidth}px`);
    } else if (UIElements.guideGrid) {
         // Set default if not in settings (or if it's the first run)
         const defaultChannelWidth = window.innerWidth < 768 ? 64 : 180;
         UIElements.guideGrid.style.setProperty('--channel-col-width', `${defaultChannelWidth}px`);
         console.log(`[MAIN] Set default channel column width: ${defaultChannelWidth}px`);
    }
}

/**
 * Sets up core application event listeners (navigation, modals, etc.).
 */
function setupCoreEventListeners() {
    console.log('[MAIN] Setting up core event listeners.');
    UIElements.tabGuide?.addEventListener('click', () => { console.log('[NAV] Desktop Guide tab clicked.'); switchTab('guide'); });
    UIElements.tabNotifications?.addEventListener('click', () => { console.log('[NAV] Desktop Notifications tab clicked.'); switchTab('notifications'); });
    UIElements.tabSettings?.addEventListener('click', () => { console.log('[NAV] Desktop Settings tab clicked.'); switchTab('settings'); });

    UIElements.mobileMenuToggle?.addEventListener('click', () => { console.log('[NAV] Mobile menu toggle clicked.'); openMobileMenu(); });
    UIElements.mobileMenuClose?.addEventListener('click', () => { console.log('[NAV] Mobile menu close clicked.'); closeMobileMenu(); });
    UIElements.mobileMenuOverlay?.addEventListener('click', () => { console.log('[NAV] Mobile menu overlay clicked (to close).'); closeMobileMenu(); });
    UIElements.mobileNavGuide?.addEventListener('click', () => { console.log('[NAV] Mobile Guide nav clicked.'); switchTab('guide'); });
    UIElements.mobileNavNotifications?.addEventListener('click', () => { console.log('[NAV] Mobile Notifications nav clicked.'); switchTab('notifications'); });
    UIElements.mobileNavSettings?.addEventListener('click', () => { console.log('[NAV] Mobile Settings nav clicked.'); switchTab('settings'); });
    UIElements.mobileNavLogoutBtn?.addEventListener('click', () => {
        console.log('[NAV] Mobile Logout nav clicked.');
        const logoutButton = document.getElementById('logout-btn'); // Trigger desktop logout
        if (logoutButton) logoutButton.click();
        closeMobileMenu();
    });

    window.addEventListener('popstate', () => { console.log('[NAV] Popstate event (browser back/forward).'); handleRouteChange(); });

    UIElements.confirmCancelBtn?.addEventListener('click', () => { console.log('[UI] Confirm modal canceled.'); closeModal(UIElements.confirmModal); });
    UIElements.confirmOkBtn?.addEventListener('click', () => { console.log('[UI] Confirm modal confirmed.'); handleConfirm(); });
    UIElements.detailsCloseBtn?.addEventListener('click', () => { console.log('[UI] Program details modal closed.'); closeModal(UIElements.programDetailsModal); });

    // Make modals resizable
    if (UIElements.videoResizeHandle && UIElements.videoModalContainer) {
        makeModalResizable(UIElements.videoResizeHandle, UIElements.videoModalContainer, 400, 300, 'playerDimensions');
        console.log('[MAIN] Video modal made resizable.');
    }
    if (UIElements.detailsResizeHandle && UIElements.programDetailsContainer) {
        makeModalResizable(UIElements.detailsResizeHandle, UIElements.programDetailsContainer, 320, 250, 'programDetailsDimensions');
        console.log('[MAIN] Program details modal made resizable.');
    }

    // Make channel column resizable (desktop only)
    if (UIElements.channelColumnResizeHandle && UIElements.guideGrid && window.innerWidth >= 768) {
        makeColumnResizable(
            UIElements.channelColumnResizeHandle,
            UIElements.guideGrid,
            100, // Minimum width for the channel column
            'channelColumnWidth',
            '--channel-col-width'
        );
        console.log('[MAIN] Channel column made resizable.');
    } else {
        console.log('[MAIN] Channel column resize handle not applied (mobile or elements not found).');
    }
}


// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('[APP_START] DOMContentLoaded event fired. Initializing UI elements.');
    initializeUIElements();

    // Register Service Worker
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        console.log('[APP_START] Service Worker and Push API are supported by browser.');
        navigator.serviceWorker.register('sw.js')
            .then(swReg => {
                console.log('[APP_START] Service Worker registered successfully:', swReg);
                appState.swRegistration = swReg;
            })
            .catch(error => {
                console.error('[APP_START] Service Worker registration failed:', error);
                showNotification('Failed to register service worker for notifications.', true);
            });
    } else {
        console.warn('[APP_START] Push messaging is not supported in this browser environment.');
        showNotification('Push notifications are not supported by your browser.', false, 5000);
    }

    console.log('[APP_START] Setting up authentication event listeners...');
    setupAuthEventListeners();
    console.log('[APP_START] Checking authentication status...');
    checkAuthStatus(); // This initiates the main app flow
});
