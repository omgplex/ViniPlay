/**
 * main.js
 *
 * Main entry point for the ViniPlay application.
 * Initializes the app by setting up authentication, event listeners, and loading initial data.
 */

import { appState, guideState, UIElements } from './modules/state.js';
import { apiFetch, fetchConfig } from './modules/api.js'; // IMPORTED fetchConfig
import { checkAuthStatus, setupAuthEventListeners } from './modules/auth.js';
import { handleGuideLoad, finalizeGuideLoad, setupGuideEventListeners } from './modules/guide.js';
import { setupPlayerEventListeners } from './modules/player.js';
import { setupSettingsEventListeners, populateTimezoneSelector, updateUIFromSettings } from './modules/settings.js';
import { makeModalResizable, handleRouteChange, switchTab, handleConfirm, closeModal, makeColumnResizable, openMobileMenu, closeMobileMenu, showNotification } from './modules/ui.js';
import { loadAndScheduleNotifications, subscribeUserToPush } from './modules/notification.js';
import { setupDvrEventListeners } from './modules/dvr.js'; // NEW: Import DVR event listeners
import { populateChannelSelector } from './modules/multiview.js'; // NEW: Import populateChannelSelector for universal modal use

// The initializeCastApi function is no longer called directly from here,
// but the cast.js module will handle its own initialization via the window callback.

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
    setupDvrEventListeners(); // NEW: Setup DVR event listeners
    // REMOVED: The direct call to initializeCastApi() is no longer needed here.
    // The cast.js module will now be initialized automatically by the Google Cast SDK callback.
    console.log('[MAIN] All event listeners set up.');

    // 3. Load initial configuration and guide data
    try {
        console.log('[MAIN] Fetching initial configuration from server via api.js...');
        // REFACTORED: Use the centralized fetchConfig from api.js
        const config = await fetchConfig(); 
        if (!config) {
            throw new Error(`Could not load configuration from server. Check logs for details.`);
        }

        console.log('[MAIN] Configuration loaded:', config);
        Object.assign(guideState.settings, config.settings || {}); // Merge server settings into guideState

        // Restore UI dimensions from settings
        restoreDimensions();
        // Populate timezone selector and update other settings UI
        populateTimezoneSelector();
        updateUIFromSettings();

        // Show initial loading indicator for guide (if not already handled by auth.js)
        UIElements.initialLoadingIndicator.classList.remove('hidden');
        UIElements.guidePlaceholder.classList.remove('hidden');

        // Attempt to load cached data first
        console.log('[MAIN] Attempting to load guide data from IndexedDB cache...');
        const cachedChannels = await loadDataFromDB('channels');
        const cachedPrograms = await loadDataFromDB('programs');

        if (cachedChannels?.length > 0 && cachedPrograms) {
            console.log('[MAIN] Loaded guide data from cache. Finalizing guide load.');
            guideState.channels = cachedChannels;
            guideState.programs = cachedPrograms;
            finalizeGuideLoad(true); // true indicates first load
        } else if (config.m3uContent) {
            console.log('[MAIN] No cached data or incomplete cache. Processing guide data from server config.');
            handleGuideLoad(config.m3uContent, config.epgContent);
        } else {
            console.log('[MAIN] No M3U content from server or cache. Displaying no data message.');
            UIElements.initialLoadingIndicator.classList.add('hidden');
            UIElements.noDataMessage.classList.remove('hidden');
        }
        
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
            // Add any future schema upgrades here
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
    if (guideState.settings.programDetailsDimensions && UIElements.programDetailsContainer) {
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
    UIElements.tabMultiview?.addEventListener('click', () => { console.log('[NAV] Desktop Multi-View tab clicked.'); switchTab('multiview'); });
    UIElements.tabDvr?.addEventListener('click', () => { console.log('[NAV] Desktop DVR tab clicked.'); switchTab('dvr'); }); // NEW: DVR Tab
    UIElements.tabNotifications?.addEventListener('click', () => { console.log('[NAV] Desktop Notifications tab clicked.'); switchTab('notifications'); });
    UIElements.tabSettings?.addEventListener('click', () => { console.log('[NAV] Desktop Settings tab clicked.'); switchTab('settings'); });

    UIElements.mobileMenuToggle?.addEventListener('click', () => { console.log('[NAV] Mobile menu toggle clicked.'); openMobileMenu(); });
    UIElements.mobileMenuClose?.addEventListener('click', () => { console.log('[NAV] Mobile menu close clicked.'); closeMobileMenu(); });
    UIElements.mobileMenuOverlay?.addEventListener('click', () => { console.log('[NAV] Mobile menu overlay clicked (to close).'); closeMobileMenu(); });
    UIElements.mobileNavGuide?.addEventListener('click', () => { console.log('[NAV] Mobile Guide nav clicked.'); switchTab('guide'); });
    UIElements.mobileNavMultiview?.addEventListener('click', () => { console.log('[NAV] Mobile Multi-View nav clicked.'); switchTab('multiview'); });
    UIElements.mobileNavDvr?.addEventListener('click', () => { console.log('[NAV] Mobile DVR nav clicked.'); switchTab('dvr'); }); // NEW: Mobile DVR Nav
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

    // NEW: Use ResizeObserver to update CSS variable for sticky header positioning
    if (UIElements.mainHeader && UIElements.unifiedGuideHeader) {
        const mainHeaderObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.target === UIElements.mainHeader) {
                    document.documentElement.style.setProperty('--main-header-height', `${entry.contentRect.height}px`);
                    console.log(`[MAIN] Main header height updated to: ${entry.contentRect.height}px`);
                }
            }
        });
        mainHeaderObserver.observe(UIElements.mainHeader);
        console.log('[MAIN] ResizeObserver attached to main-header.');
    }

    // NEW: Moved Channel Selector Modal listeners here for universal access
    console.log(`[MAIN] Attaching universal listener to #channel-selector-cancel-btn. Found: ${!!UIElements.channelSelectorCancelBtn}`);
    if (UIElements.channelSelectorCancelBtn) {
        UIElements.channelSelectorCancelBtn.addEventListener('click', () => {
            console.log('[MAIN] Universal channel-selector-cancel-btn clicked.');
            // This listener always closes the modal, regardless of context.
            // The context flag is for determining what happens *after* selection, not for closing.
            if (document.body.dataset.channelSelectorContext) {
                delete document.body.dataset.channelSelectorContext;
                console.log('[MAIN] Cleared channelSelectorContext flag on cancel (universal).');
            }
            closeModal(UIElements.multiviewChannelSelectorModal);
        });
    }

    console.log(`[MAIN] Attaching universal listener to #multiview-channel-filter. Found: ${!!UIElements.multiviewChannelFilter}`);
    if (UIElements.multiviewChannelFilter) {
        UIElements.multiviewChannelFilter.addEventListener('change', () => {
            console.log('[MAIN] Universal multiview-channel-filter changed.');
            // This re-populates the channel selector based on the filter change.
            populateChannelSelector();
        });
    }

    // NEW: Universal listener for channel selection in the modal
    console.log(`[MAIN] Attaching universal listener to #channel-selector-list. Found: ${!!UIElements.channelSelectorList}`);
    if (UIElements.channelSelectorList) {
        UIElements.channelSelectorList.addEventListener('click', (e) => {
            console.log('[MAIN] Universal channel-selector-list clicked.');
            const channelItem = e.target.closest('.channel-item');
            if (!channelItem) return;

            const channel = {
                id: channelItem.dataset.id,
                name: channelItem.dataset.name,
                url: channelItem.dataset.url,
                logo: channelItem.dataset.logo,
            };
            
            // Check context to determine callback
            if (document.body.dataset.channelSelectorContext === 'dvr') {
                console.log('[MAIN] Channel selected in DVR context.');
                // Update DVR form fields
                UIElements.manualRecSelectedChannelName.textContent = channel.name;
                UIElements.manualRecChannelId.value = channel.id;
                UIElements.manualRecChannelName.value = channel.name;
            } else {
                console.log('[MAIN] Channel selected in Multi-View context or general context.');
                // Call Multi-View specific callback if it exists
                // Note: The channelSelectorCallback is set in multiview.js and used there.
                // We're moving the listener, but the callback assignment remains in multiview.js.
                // This means we need to ensure channelSelectorCallback is accessible and set correctly.
                // For now, let's assume the multiview.js setup still sets channelSelectorCallback.
                // If it's a multi-view player click, then play the channel.
                // The issue here is that `channelSelectorCallback` is local to multiview.js,
                // so we can't directly call it from main.js without refactoring.
                // For now, let's leave this click handler generic and assume
                // individual modules will handle the `channel-item` clicks
                // by attaching their own listeners to `channelSelectorList`
                // after the modal is opened.
                // The *current* multiview.js already attaches a listener, so that should still work.
                // Let's modify the dvr.js part to remove its listener, as this universal one is enough.
            }
            
            closeModal(UIElements.multiviewChannelSelectorModal);
            delete document.body.dataset.channelSelectorContext; // Always clear context after selection
            console.log('[MAIN] Cleared channelSelectorContext flag on select (universal).');
        });
    }
}


// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    // Register Service Worker
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        console.log('[APP_START] Service Worker and Push API are supported by browser.');
        navigator.serviceWorker.register('/sw.js') // FIX: Use absolute path
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
