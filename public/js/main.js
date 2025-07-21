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
import { makeModalResizable, handleRouteChange, switchTab, handleConfirm, closeModal, makeColumnResizable, openMobileMenu, closeMobileMenu } from './modules/ui.js';

/**
 * Initializes the main application after successful authentication.
 */
export async function initMainApp() {
    // UIElements are now initialized at DOMContentLoaded, so no need to call it here.
    // This function runs when the user is logged in and the main app is shown.

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
        // Merge fetched settings into guideState.settings, preserving defaults
        Object.assign(guideState.settings, config.settings || {});

        // Restore dimensions of resizable modals and column
        restoreDimensions();

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

        // Handle the initial route once the app is ready
        // This will also trigger the initial padding calculation for page-guide
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
 * Restores the dimensions of resizable modals and the channel column from saved settings.
 */
function restoreDimensions() {
    // Restore modal dimensions
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
    // Restore channel column width
    if (guideState.settings.channelColumnWidth) {
        UIElements.guideGrid.style.setProperty('--channel-col-width', `${guideState.settings.channelColumnWidth}px`);
    }
}

/**
 * Sets up core application event listeners (navigation, modals, etc.).
 */
function setupCoreEventListeners() {
    // Main navigation (Desktop tabs)
    UIElements.tabGuide?.addEventListener('click', () => switchTab('guide'));
    UIElements.tabSettings?.addEventListener('click', () => switchTab('settings'));

    // Mobile navigation (Hamburger menu and links)
    UIElements.mobileMenuToggle?.addEventListener('click', openMobileMenu);
    UIElements.mobileMenuClose?.addEventListener('click', closeMobileMenu);
    UIElements.mobileMenuOverlay?.addEventListener('click', closeMobileMenu); // Close when clicking overlay
    UIElements.mobileNavGuide?.addEventListener('click', () => switchTab('guide'));
    UIElements.mobileNavSettings?.addEventListener('click', () => switchTab('settings'));
    UIElements.mobileNavLogoutBtn?.addEventListener('click', () => { // Logout button in mobile menu
        // Trigger the existing logout functionality
        const logoutButton = document.getElementById('logout-btn');
        if (logoutButton) {
            logoutButton.click();
        }
        closeMobileMenu();
    });

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

    // Resizable channel column
    // Only enable if the handle and grid exist and it's not a mobile view where column is fixed
    if (UIElements.channelColumnResizeHandle && UIElements.guideGrid && window.innerWidth >= 768) {
        makeColumnResizable(
            UIElements.channelColumnResizeHandle,
            UIElements.guideGrid,
            100, // Minimum width for the channel column
            'channelColumnWidth', // Setting key
            '--channel-col-width' // CSS custom property to update
        );
    }
}


// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize UI elements as soon as the DOM is ready
    // This ensures elements are available for initial auth checks and UI manipulations.
    initializeUIElements();

    // Setup listeners for the initial auth forms first
    setupAuthEventListeners();
    // Then check the auth status to decide what to show
    checkAuthStatus();
});
