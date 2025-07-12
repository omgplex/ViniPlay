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
import { makeModalResizable, navigate, switchTab, handleRouteChange, handleConfirm } from './modules/ui.js';

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
        
        restoreModalDimensions();
        
        populateTimezoneSelector();
        updateUIFromSettings();

        UIElements.initialLoadingIndicator.classList.remove('hidden');
        UIElements.guidePlaceholder.classList.remove('hidden');

        const cachedChannels = await loadDataFromDB('channels');
        const cachedPrograms = await loadDataFromDB('programs');

        if (cachedChannels?.length > 0 && cachedPrograms) {
            guideState.channels = cachedChannels;
            guideState.programs = cachedPrograms;
            finalizeGuideLoad(true);
        } else if (config.m3uContent) {
            handleGuideLoad(config.m3uContent, config.epgContent);
        } else {
            UIElements.initialLoadingIndicator.classList.add('hidden');
            UIElements.noDataMessage.classList.remove('hidden');
        }
        
        handleRouteChange();

    } catch (e) {
        showNotification("Initialization failed: " + e.message, true);
        UIElements.initialLoadingIndicator.classList.add('hidden');
        UIElements.noDataMessage.classList.remove('hidden');
        navigate('/settings');
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
 * Sets up core application event listeners (navigation, modals, etc.).
 */
function setupCoreEventListeners() {
    // UPDATED: Main navigation is now in the sidebar
    UIElements.sidebarNavGuide.addEventListener('click', () => {
        switchTab('guide');
        // On mobile, hide sidebar after navigation
        if (window.innerWidth < 1024) {
             import('./modules/ui.js').then(({ toggleSidebar }) => toggleSidebar(false));
        }
    });
    UIElements.sidebarNavSettings.addEventListener('click', () => {
        switchTab('settings');
        // On mobile, hide sidebar after navigation
        if (window.innerWidth < 1024) {
             import('./modules/ui.js').then(({ toggleSidebar }) => toggleSidebar(false));
        }
    });
    
    // Browser back/forward navigation
    window.addEventListener('popstate', handleRouteChange);

    // Sidebar toggles
    UIElements.sidebarToggle.addEventListener('click', () => {
        import('./modules/ui.js').then(({ toggleSidebar }) => toggleSidebar(true));
    });
    UIElements.sidebarOverlay.addEventListener('click', () => {
        import('./modules/ui.js').then(({ toggleSidebar }) => toggleSidebar(false));
    });

    // Modal controls
    UIElements.confirmCancelBtn.addEventListener('click', () => {
        import('./modules/ui.js').then(({ closeModal }) => closeModal(UIElements.confirmModal));
    });
    UIElements.confirmOkBtn.addEventListener('click', handleConfirm);
    UIElements.detailsCloseBtn.addEventListener('click', () => {
        import('./modules/ui.js').then(({ closeModal }) => closeModal(UIElements.programDetailsModal));
    });

    // Resizable modals
    makeModalResizable(UIElements.videoResizeHandle, UIElements.videoModalContainer, 400, 300, 'playerDimensions');
    makeModalResizable(UIElements.detailsResizeHandle, UIElements.programDetailsContainer, 320, 250, 'programDetailsDimensions');
}


// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    setupAuthEventListeners();
    checkAuthStatus();
});
