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
import { loadAndScheduleNotifications, subscribeUserToPush /*, handleUrlParameters removed as it's not used */ } from './modules/notification.js';

/**
 * Initializes the main application after successful authentication.
 */
export async function initMainApp() {
    console.log('[MAIN_APP] initMainApp called. App is initializing...');
    // 1. Initialize IndexedDB for caching
    try {
        appState.db = await openDB();
        console.log('[MAIN_APP] IndexedDB opened successfully.');
    } catch (e) {
        console.error('[MAIN_APP] Error initializing local cache (IndexedDB):', e);
        showNotification("Could not initialize local cache.", true);
    }

    // 2. Setup all event listeners for the main app
    console.log('[MAIN_APP] Setting up core event listeners...');
    setupCoreEventListeners();
    setupGuideEventListeners();
    setupPlayerEventListeners();
    setupSettingsEventListeners();
    console.log('[MAIN_APP] All event listeners set up.');

    // 3. Load initial configuration and guide data
    try {
        console.log('[MAIN_APP] Fetching initial /api/config...');
        const response = await apiFetch(`/api/config?t=${Date.now()}`);
        if (!response) { // apiFetch handles 401 and network errors
            console.error('[MAIN_APP] Failed to get config: response is null.');
            throw new Error('Could not connect to the server or authentication failed.');
        }
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[MAIN_APP] Failed to get config:', response.status, response.statusText, errorText);
            throw new Error(`Server responded with status ${response.status}: ${errorText}`);
        }

        const config = await response.json();
        console.log('[MAIN_APP] Config loaded successfully:', config);
        Object.assign(guideState.settings, config.settings || {});

        restoreDimensions();
        populateTimezoneSelector();
        updateUIFromSettings();

        UIElements.initialLoadingIndicator.classList.remove('hidden');
        UIElements.guidePlaceholder.classList.remove('hidden');

        console.log('[MAIN_APP] Attempting to load guide data from IndexedDB...');
        const cachedChannels = await loadDataFromDB('channels');
        const cachedPrograms = await loadDataFromDB('programs');

        if (cachedChannels?.length > 0 && cachedPrograms) {
            console.log('[MAIN_APP] Loaded guide data from IndexedDB.');
            guideState.channels = cachedChannels;
            guideState.programs = cachedPrograms;
            finalizeGuideLoad(true);
        } else if (config.m3uContent) {
            console.log('[MAIN_APP] Loading guide data from server config (M3U/EPG content).');
            handleGuideLoad(config.m3uContent, config.epgContent);
        } else {
            console.warn('[MAIN_APP] No cached guide data and no M3U content in config.');
            UIElements.initialLoadingIndicator.classList.add('hidden');
            UIElements.noDataMessage.classList.remove('hidden');
        }
        
        console.log('[MAIN_APP] Loading and scheduling notifications...');
        await loadAndScheduleNotifications();
        console.log('[MAIN_APP] Subscribing user to push notifications...');
        await subscribeUserToPush();

        // Removed handleUrlParameters as it was unused and could cause issues if not fully implemented.
        // If you intended to use it, you'll need to define it in notification.js and uncomment.
        // console.log('[MAIN_APP] Handling URL parameters for notifications...');
        // handleUrlParameters(); 

        console.log('[MAIN_APP] Handling initial page route change...');
        handleRouteChange();
        console.log('[MAIN_APP] Application initialization complete.');

    } catch (e) {
        console.error("[MAIN_APP] Initialization failed with uncaught error:", e);
        showNotification("Initialization failed: " + e.message, true);
        UIElements.initialLoadingIndicator.classList.add('hidden');
        UIElements.noDataMessage.classList.remove('hidden');
        switchTab('settings'); // Redirect to settings on critical failure
    }
}

/**
 * Opens and sets up the IndexedDB database.
 */
function openDB() {
    console.log('[INDEXED_DB] Opening IndexedDB...');
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ViniPlayDB_v3', 1);
        request.onerror = (event) => {
            console.error('[INDEXED_DB] Error opening IndexedDB:', event.target.error);
            reject("Error opening IndexedDB.");
        };
        request.onsuccess = (event) => {
            console.log('[INDEXED_DB] IndexedDB opened successfully.');
            resolve(event.target.result);
        };
        request.onupgradeneeded = (event) => {
            console.log('[INDEXED_DB] IndexedDB upgrade needed. Creating object store...');
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains('guideData')) {
                dbInstance.createObjectStore('guideData');
                console.log('[INDEXED_DB] Object store "guideData" created.');
            }
        };
    });
}

/**
 * Loads data from IndexedDB.
 */
async function loadDataFromDB(key) {
    if (!appState.db) {
        console.warn(`[INDEXED_DB] Cannot load data for key "${key}": IndexedDB not initialized.`);
        return null;
    }
    console.log(`[INDEXED_DB] Loading data for key "${key}" from IndexedDB...`);
    return new Promise((resolve, reject) => {
        const transaction = appState.db.transaction(['guideData'], 'readonly');
        const store = transaction.objectStore('guideData');
        const request = store.get(key);
        request.onsuccess = () => {
            console.log(`[INDEXED_DB] Data for key "${key}" loaded. Found: ${!!request.result}`);
            resolve(request.result);
        };
        request.onerror = (event) => {
            console.error(`[INDEXED_DB] Error loading data for key "${key}" from DB:`, event.target.error);
            reject("Error loading data from DB.");
        };
    });
}


/**
 * Restores the dimensions of resizable modals and the channel column from saved settings.
 */
function restoreDimensions() {
    console.log('[UI_RESTORE] Restoring dimensions from settings...');
    if (guideState.settings.playerDimensions) {
        const { width, height } = guideState.settings.playerDimensions;
        if (width) UIElements.videoModalContainer.style.width = `${width}px`;
        if (height) UIElements.videoModalContainer.style.height = `${height}px`;
        console.log(`[UI_RESTORE] Player dimensions restored to ${width}x${height}.`);
    }
    if (guideState.settings.programDetailsDimensions) {
        const { width, height } = guideState.settings.programDetailsDimensions;
        if (width) UIElements.programDetailsContainer.style.width = `${width}px`;
        if (height) UIElements.programDetailsContainer.style.height = `${height}px`;
        console.log(`[UI_RESTORE] Program details dimensions restored to ${width}x${height}.`);
    }
    if (guideState.settings.channelColumnWidth) {
        UIElements.guideGrid.style.setProperty('--channel-col-width', `${guideState.settings.channelColumnWidth}px`);
        console.log(`[UI_RESTORE] Channel column width restored to ${guideState.settings.channelColumnWidth}px.`);
    }
    console.log('[UI_RESTORE] Dimension restoration complete.');
}

/**
 * Sets up core application event listeners (navigation, modals, etc.).
 */
function setupCoreEventListeners() {
    console.log('[CORE_EVENTS] Setting up core event listeners...');
    UIElements.tabGuide?.addEventListener('click', () => { console.log('[EVENT] Click: Tab Guide'); switchTab('guide'); });
    UIElements.tabNotifications?.addEventListener('click', () => { console.log('[EVENT] Click: Tab Notifications'); switchTab('notifications'); });
    UIElements.tabSettings?.addEventListener('click', () => { console.log('[EVENT] Click: Tab Settings'); switchTab('settings'); });

    UIElements.mobileMenuToggle?.addEventListener('click', () => { console.log('[EVENT] Click: Mobile Menu Toggle'); openMobileMenu(); });
    UIElements.mobileMenuClose?.addEventListener('click', () => { console.log('[EVENT] Click: Mobile Menu Close'); closeMobileMenu(); });
    UIElements.mobileMenuOverlay?.addEventListener('click', () => { console.log('[EVENT] Click: Mobile Menu Overlay'); closeMobileMenu(); });
    UIElements.mobileNavGuide?.addEventListener('click', () => { console.log('[EVENT] Click: Mobile Nav Guide'); switchTab('guide'); });
    UIElements.mobileNavNotifications?.addEventListener('click', () => { console.log('[EVENT] Click: Mobile Nav Notifications'); switchTab('notifications'); });
    UIElements.mobileNavSettings?.addEventListener('click', () => { console.log('[EVENT] Click: Mobile Nav Settings'); switchTab('settings'); });
    UIElements.mobileNavLogoutBtn?.addEventListener('click', () => {
        console.log('[EVENT] Click: Mobile Nav Logout');
        const logoutButton = document.getElementById('logout-btn');
        if (logoutButton) logoutButton.click();
        closeMobileMenu();
    });

    window.addEventListener('popstate', () => { console.log('[EVENT] Popstate (Browser History Change)'); handleRouteChange(); });

    UIElements.confirmCancelBtn.addEventListener('click', () => { console.log('[EVENT] Click: Confirm Cancel'); closeModal(UIElements.confirmModal); });
    UIElements.confirmOkBtn.addEventListener('click', () => { console.log('[EVENT] Click: Confirm OK'); handleConfirm(); });
    UIElements.detailsCloseBtn.addEventListener('click', () => { console.log('[EVENT] Click: Details Close'); closeModal(UIElements.programDetailsModal); });

    if (UIElements.videoResizeHandle && UIElements.videoModalContainer) {
        makeModalResizable(UIElements.videoResizeHandle, UIElements.videoModalContainer, 400, 300, 'playerDimensions');
    } else {
        console.warn('[CORE_EVENTS] Video resize elements not found. Skipping video modal resizable setup.');
    }
    if (UIElements.detailsResizeHandle && UIElements.programDetailsContainer) {
        makeModalResizable(UIElements.detailsResizeHandle, UIElements.programDetailsContainer, 320, 250, 'programDetailsDimensions');
    } else {
        console.warn('[CORE_EVENTS] Program details resize elements not found. Skipping modal resizable setup.');
    }

    if (UIElements.channelColumnResizeHandle && UIElements.guideGrid && window.innerWidth >= 768) {
        makeColumnResizable(
            UIElements.channelColumnResizeHandle,
            UIElements.guideGrid,
            100,
            'channelColumnWidth',
            '--channel-col-width'
        );
        console.log('[CORE_EVENTS] Channel column resizable setup.');
    } else {
        console.log('[CORE_EVENTS] Skipping channel column resizable setup (mobile or elements not found).');
    }
    console.log('[CORE_EVENTS] Core event listeners setup complete.');
}


// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('[APP_START] DOMContentLoaded event fired. Initializing UI elements...');
    initializeUIElements();

    // Register Service Worker
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        console.log('[APP_START] Service Worker and Push API are supported. Registering sw.js...');
        navigator.serviceWorker.register('sw.js')
            .then(swReg => {
                console.log('[APP_START] Service Worker registered successfully:', swReg);
                appState.swRegistration = swReg;
            })
            .catch(error => {
                console.error('[APP_START] Service Worker registration failed:', error);
            });
    } else {
        console.warn('[APP_START] Push messaging is NOT supported by this browser.');
    }

    console.log('[APP_START] Setting up authentication event listeners...');
    setupAuthEventListeners();
    console.log('[APP_START] Checking authentication status...');
    checkAuthStatus();
});

