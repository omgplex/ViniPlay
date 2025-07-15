/**
 * main.js
 *
 * Main entry point for the ViniPlay application.
 * Initializes the app by setting up authentication, event listeners, and loading initial data.
 */

import { appState, guideState, UIElements } from './modules/state.js';
import { apiFetch } from './modules/api.js';
import { checkAuthStatus, setupAuthEventListeners } from './modules/auth.js';
import { handleGuideLoad, finalizeGuideLoad, setupGuideEventListeners } from './modules/guide.js';
import { setupPlayerEventListeners } from './modules/player.js';
import { setupSettingsEventListeners, populateTimezoneSelector, updateUIFromSettings } from './modules/settings.js';
import { makeModalResizable, handleRouteChange, switchTab, handleConfirm, closeModal } from './modules/ui.js';

// A utility function to limit the execution of a function to once every specified time limit.
const throttle = (func, limit) => {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

/**
 * Initializes the main application after successful authentication.
 */
export async function initMainApp() {
    // 1. Initialize IndexedDB for caching
    try {
        appState.db = await openDB();
    } catch (e) {
        console.error(e);
        showNotification("Could not initialize local cache.", true);
    }

    // 2. Setup all event listeners for the main app
    setupCoreEventListeners();
    setupGuideEventListeners();
    setupPlayerEventListeners();
    setupSettingsEventListeners();

    // 3. Load initial configuration and guide data
    try {
        const response = await apiFetch(`/api/config?t=${Date.now()}`);
        if (!response || !response.ok) throw new Error('Could not connect to the server.');
        
        const config = await response.json();
        guideState.settings = config.settings || {};
        
        // Restore dimensions of resizable modals
        restoreModalDimensions();
        
        // Populate UI elements that depend on settings
        populateTimezoneSelector();
        updateUIFromSettings();

        // Show loading indicator while fetching data
        UIElements.initialLoadingIndicator.classList.remove('hidden');
        UIElements.guidePlaceholder.classList.remove('hidden');

        // Try loading from cache first for a faster startup
        const cachedChannels = await loadDataFromDB('channels');
        const cachedPrograms = await loadDataFromDB('programs');

        if (cachedChannels?.length > 0 && cachedPrograms) {
            guideState.channels = cachedChannels;
            guideState.programs = cachedPrograms;
            finalizeGuideLoad(true);
        } else if (config.m3uContent) {
            // Fallback to network data if cache is empty
            handleGuideLoad(config.m3uContent, config.epgContent);
        } else {
            // If no data from cache or network, show the "no data" message
            UIElements.initialLoadingIndicator.classList.add('hidden');
            UIElements.noDataMessage.classList.remove('hidden');
        }
        
        // Set initial margin for main content to account for the fixed top bar
        setMainMargin();

        // Handle the initial route once the app is ready
        handleRouteChange();

    } catch (e) {
        showNotification("Initialization failed: " + e.message, true);
        UIElements.initialLoadingIndicator.classList.add('hidden');
        UIElements.noDataMessage.classList.remove('hidden');
        switchTab('settings'); // Redirect to settings on failure
    }
}

/**
 * Opens and sets up the IndexedDB database.
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('ViniPlayDB_v3', 1);
        request.onerror = () => reject("Error opening IndexedDB.");
        request.onsuccess = (event) => resolve(event.target.result);
        request.onupgradeneeded = (event) => {
            const dbInstance = event.target.result;
            if (!dbInstance.objectStoreNames.contains('guideData')) {
                dbInstance.createObjectStore('guideData');
            }
        };
    });
}

/**
 * Loads data from IndexedDB.
 */
async function loadDataFromDB(key) {
    if (!appState.db) return null;
    return new Promise((resolve, reject) => {
        const transaction = appState.db.transaction(['guideData'], 'readonly');
        const store = transaction.objectStore('guideData');
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject("Error loading data from DB.");
    });
}


/**
 * Restores the dimensions of resizable modals from saved settings.
 */
function restoreModalDimensions() {
    if (guideState.settings.playerDimensions) {
        const { width, height } = guideState.settings.playerDimensions;
        if (width) UIElements.videoModalContainer.style.width = `${width}px`;
        if (height) UIElements.videoModalContainer.style.height = `${height}px`;
    }
    if (guideState.settings.programDetailsDimensions) {
        const { width, height } = guideState.settings.programDetailsDimensions;
        if (width) UIElements.programDetailsContainer.style.width = `${width}px`;
        if (height) UIElements.programDetailsContainer.style.height = `${height}px`;
    }
}

/**
 * Dynamically sets the margin-top of the main content area to clear the fixed top bar.
 */
const setMainMargin = () => {
    const topBarWrapper = UIElements.topBarWrapper;
    if (topBarWrapper) {
        document.documentElement.style.setProperty('--dynamic-top-margin', `${topBarWrapper.offsetHeight}px`);
    }
};

/**
 * Sets up core application event listeners (navigation, modals, scroll hiding, etc.).
 */
function setupCoreEventListeners() {
    // Main navigation
    ['tabGuide', 'bottomNavGuide'].forEach(id => UIElements[id]?.addEventListener('click', () => switchTab('guide')));
    ['tabSettings', 'bottomNavSettings'].forEach(id => UIElements[id]?.addEventListener('click', () => switchTab('settings')));
    
    // Browser back/forward navigation
    window.addEventListener('popstate', handleRouteChange);

    // Modal controls
    UIElements.confirmCancelBtn.addEventListener('click', () => {
       closeModal(UIElements.confirmModal);
    });
    UIElements.confirmOkBtn.addEventListener('click', handleConfirm);
    UIElements.detailsCloseBtn.addEventListener('click', () => {
        closeModal(UIElements.programDetailsModal);
    });

    // Resizable modals
    makeModalResizable(UIElements.videoResizeHandle, UIElements.videoModalContainer, 400, 300, 'playerDimensions');
    makeModalResizable(UIElements.detailsResizeHandle, UIElements.programDetailsContainer, 320, 250, 'programDetailsDimensions');

    // Scroll handling for header visibility
    let lastScrollTop = 0;
    const topBarWrapper = UIElements.topBarWrapper;

    // Recalculate main margin on window resize, as topBarWrapper height might change
    window.addEventListener('resize', setMainMargin);

    UIElements.guideContainer.addEventListener('scroll', throttle(() => {
        const scrollTop = UIElements.guideContainer.scrollTop;
        const currentTopBarHeight = topBarWrapper.offsetHeight; // Get current height dynamically
        
        // Only hide/show the top bar if on the TV Guide page
        if (window.location.pathname.startsWith('/tvguide') || window.location.pathname === '/') {
            if (scrollTop > lastScrollTop && scrollTop > 0) { // Scrolling down and not at very top
                topBarWrapper.classList.add('top-bar-hidden');
                topBarWrapper.classList.remove('top-bar-visible');
            } else if (scrollTop < lastScrollTop || scrollTop === 0) { // Scrolling up or at top
                topBarWrapper.classList.remove('top-bar-hidden');
                topBarWrapper.classList.add('top-bar-visible');
            }
        } else {
            // If not on guide page, always keep top bar visible
            topBarWrapper.classList.remove('top-bar-hidden');
            topBarWrapper.classList.add('top-bar-visible');
        }
        lastScrollTop = scrollTop;
    }, 100)); // Throttle to prevent performance issues
}

/**
 * Handles client-side routing by showing/hiding pages based on the URL path.
 * This function is also responsible for ensuring the top bar visibility and main content margin
 * are correct upon route changes.
 */
export const handleRouteChange = () => {
    const path = window.location.pathname;
    const isGuide = path.startsWith('/tvguide') || path === '/';

    // Toggle active state for desktop and mobile navigation buttons
    ['tabGuide', 'bottomNavGuide'].forEach(id => UIElements[id]?.classList.toggle('active', isGuide));
    ['tabSettings', 'bottomNavSettings'].forEach(id => UIElements[id]?.classList.toggle('active', !isGuide));

    // Show/hide the relevant page content
    UIElements.pageGuide.classList.toggle('hidden', !isGuide);
    UIElements.pageGuide.classList.toggle('flex', isGuide);
    UIElements.pageSettings.classList.toggle('hidden', isGuide);
    UIElements.pageSettings.classList.toggle('flex', !isGuide);
    
    // Always ensure top bar is visible on route change (it might have been hidden by scroll on guide)
    const topBarWrapper = UIElements.topBarWrapper;
    topBarWrapper.classList.remove('top-bar-hidden');
    topBarWrapper.classList.add('top-bar-visible');
    
    // Recalculate main margin after the top bar's visibility and dimensions settle for the new route
    setTimeout(setMainMargin, 50); // Small delay to allow layout to settle

    // If navigating to the settings page, refresh relevant data
    if (!isGuide) {
        updateUIFromSettings();
        if (appState.currentUser?.isAdmin) {
            refreshUserList();
        }
    }
};


// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    // Setup listeners for the initial auth forms first
    setupAuthEventListeners();
    // Then check the auth status to decide what to show
    checkAuthStatus();
});
