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
import { loadAndScheduleNotifications, subscribeUserToPush, handleUrlParameters } from './modules/notification.js';

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
        Object.assign(guideState.settings, config.settings || {});

        restoreDimensions();
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
        
        // Load the list of scheduled notifications for the UI
        await loadAndScheduleNotifications();

        // Subscribe to push notifications
        await subscribeUserToPush();

        // Handle initial URL parameters for notifications
        handleUrlParameters();

        // Handle initial page load routing
        handleRouteChange();

    } catch (e) {
        showNotification("Initialization failed: " + e.message, true);
        UIElements.initialLoadingIndicator.classList.add('hidden');
        UIElements.noDataMessage.classList.remove('hidden');
        switchTab('settings');
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
    if (guideState.settings.channelColumnWidth) {
        UIElements.guideGrid.style.setProperty('--channel-col-width', `${guideState.settings.channelColumnWidth}px`);
    }
}

/**
 * Sets up core application event listeners (navigation, modals, etc.).
 */
function setupCoreEventListeners() {
    UIElements.tabGuide?.addEventListener('click', () => switchTab('guide'));
    UIElements.tabNotifications?.addEventListener('click', () => switchTab('notifications'));
    UIElements.tabSettings?.addEventListener('click', () => switchTab('settings'));

    UIElements.mobileMenuToggle?.addEventListener('click', openMobileMenu);
    UIElements.mobileMenuClose?.addEventListener('click', closeMobileMenu);
    UIElements.mobileMenuOverlay?.addEventListener('click', closeMobileMenu);
    UIElements.mobileNavGuide?.addEventListener('click', () => switchTab('guide'));
    UIElements.mobileNavNotifications?.addEventListener('click', () => switchTab('notifications'));
    UIElements.mobileNavSettings?.addEventListener('click', () => switchTab('settings'));
    UIElements.mobileNavLogoutBtn?.addEventListener('click', () => {
        const logoutButton = document.getElementById('logout-btn');
        if (logoutButton) logoutButton.click();
        closeMobileMenu();
    });

    window.addEventListener('popstate', handleRouteChange);

    UIElements.confirmCancelBtn.addEventListener('click', () => closeModal(UIElements.confirmModal));
    UIElements.confirmOkBtn.addEventListener('click', handleConfirm);
    UIElements.detailsCloseBtn.addEventListener('click', () => closeModal(UIElements.programDetailsModal));

    makeModalResizable(UIElements.videoResizeHandle, UIElements.videoModalContainer, 400, 300, 'playerDimensions');
    makeModalResizable(UIElements.detailsResizeHandle, UIElements.programDetailsContainer, 320, 250, 'programDetailsDimensions');

    if (UIElements.channelColumnResizeHandle && UIElements.guideGrid && window.innerWidth >= 768) {
        makeColumnResizable(
            UIElements.channelColumnResizeHandle,
            UIElements.guideGrid,
            100,
            'channelColumnWidth',
            '--channel-col-width'
        );
    }
}


// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    initializeUIElements();

    // Register Service Worker
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        console.log('Service Worker and Push is supported');
        navigator.serviceWorker.register('sw.js')
            .then(swReg => {
                console.log('Service Worker is registered', swReg);
                appState.swRegistration = swReg;
            })
            .catch(error => {
                console.error('Service Worker Error', error);
            });
    } else {
        console.warn('Push messaging is not supported');
    }

    setupAuthEventListeners();
    checkAuthStatus();
});
