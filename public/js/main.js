/**
 * main.js
 *
 * Main entry point for the ViniPlay application.
 * Initializes the app by setting up authentication, event listeners, and loading initial data.
 */

import { appState, guideState, UIElements } from './modules/state.js';
import { apiFetch } from './modules/api.js';
import { checkAuthStatus, setupAuthEventListeners } from './modules/auth.js';
import { handleGuideLoad, renderReactGuide, setupGuideEventListeners } from './modules/guide.js'; // Import renderReactGuide and setupGuideEventListeners
import { setupPlayerEventListeners, playChannel } from './modules/player.js'; // Import playChannel
import { setupSettingsEventListeners, populateTimezoneSelector, updateUIFromSettings } from './modules/settings.js';
import { makeModalResizable, handleRouteChange, switchTab, handleConfirm, closeModal, showProgramDetails, showNotification } from './modules/ui.js'; // Import showProgramDetails, showNotification
import { saveUserSetting } from './modules/api.js'; // Ensure saveUserSetting is available

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
    setupPlayerEventListeners();
    setupSettingsEventListeners();
    setupGuideEventListeners(); // Setup event listeners for guide filters/search (vanilla JS)

    // 3. Load initial configuration and guide data
    try {
        const response = await apiFetch(`/api/config?t=${Date.now()}`);
        if (!response || !response.ok) throw new Error('Could not connect to the server.');
        
        const config = await response.json();
        // Merge fetched settings into guideState.settings, preserving defaults
        Object.assign(guideState.settings, config.settings || {});
        
        // Restore dimensions of resizable modals
        restoreDimensions();

        // Populate UI elements that depend on settings
        populateTimezoneSelector();
        updateUIFromSettings();

        // Show loading indicator while fetching data
        UIElements.initialLoadingIndicator.classList.remove('hidden');
        UIElements.guidePlaceholder.classList.remove('hidden');
        UIElements.noDataMessage.classList.add('hidden'); // Hide no data message initially

        // Try loading from cache first for a faster startup
        const cachedChannels = await loadDataFromDB('channels');
        const cachedPrograms = await loadDataFromDB('programs');

        if (cachedChannels?.length > 0 && cachedPrograms) {
            guideState.channels = cachedChannels;
            guideState.programs = cachedPrograms;
            
            // Pass the loaded data to the React guide component
            renderReactGuide(
                guideState.channels,
                guideState.programs,
                guideState.settings,
                {
                    playChannel: playChannel,
                    showConfirm: showConfirm,
                    saveUserSetting: saveUserSetting,
                    showProgramDetailsModal: showProgramDetails,
                    onDateChange: (newDate) => { // Callback from React Guide to update parent date
                        guideState.currentDate = newDate;
                        // Update date display in vanilla JS header
                        UIElements.guideDateDisplay.textContent = newDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });
                        // Re-render React guide with new date
                        renderReactGuide(guideState.channels, guideState.programs, guideState.settings, {
                            playChannel, showConfirm, saveUserSetting, showProgramDetailsModal: showProgramDetails, onDateChange,
                            guideDateDisplay: guideState.currentDate.toISOString(), onSearchAndFilter: handleSearchAndFilterProxy,
                            channelGroups: guideState.channelGroups, channelSources: guideState.channelSources, onToggleHeaderVisibility
                        });
                    },
                    guideDateDisplay: guideState.currentDate.toISOString(),
                    // Proxy search/filter updates from React component to main.js for dropdowns
                    onSearchAndFilter: handleSearchAndFilterProxy,
                    channelGroups: guideState.channelGroups, // Pass sets for populating options
                    channelSources: guideState.channelSources,
                    onToggleHeaderVisibility: onToggleHeaderVisibility
                }
            );
            
            UIElements.initialLoadingIndicator.classList.add('hidden'); // Hide general loading indicator

        } else if (config.m3uContent) {
            // Fallback to network data if cache is empty
            handleGuideLoad(config.m3uContent, config.epgContent); // This now calls renderReactGuide internally
        } else {
            // If no data from cache or network, show the "no data" message
            UIElements.initialLoadingIndicator.classList.add('hidden');
            UIElements.noDataMessage.classList.remove('hidden');
            // Ensure the React root is empty or shows its own message
            renderReactGuide([], {}, guideState.settings, {
                playChannel, showConfirm, saveUserSetting, showProgramDetailsModal: showProgramDetails, onDateChange: () => {},
                guideDateDisplay: guideState.currentDate.toISOString(), onSearchAndFilter: handleSearchAndFilterProxy,
                channelGroups: new Set(), channelSources: new Set(), onToggleHeaderVisibility
            });
        }
        
        // Handle the initial route once the app is ready
        handleRouteChange();

    } catch (e) {
        showNotification("Initialization failed: " + e.message, true);
        console.error("Initialization failed:", e);
        UIElements.initialLoadingIndicator.classList.add('hidden');
        UIElements.noDataMessage.classList.remove('hidden');
        switchTab('settings'); // Redirect to settings on failure
    }
}

/**
 * Handles proxying search and filter updates from React to the vanilla JS elements.
 * This function updates the vanilla JS dropdowns and search input to reflect the state managed by React.
 * It's important because these elements are outside the React component's direct control.
 */
function handleSearchAndFilterProxy(searchTerm, selectedGroup, selectedSource) {
    // Update vanilla JS elements
    if (UIElements.searchInput) UIElements.searchInput.value = searchTerm;
    if (UIElements.groupFilter) UIElements.groupFilter.value = selectedGroup;
    if (UIElements.sourceFilter) UIElements.sourceFilter.value = selectedSource;
    // Note: The actual filtering and rendering within the ReactGrid is handled by ReactGuide's internal state.
    // This function primarily keeps the vanilla JS UI in sync.
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
 * Channel column width is handled by React component and `guideState.settings.channelColumnWidth`
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
}

let lastScrollTop = 0;
let initialHeaderHeight = 0;

const calculateInitialHeaderHeight = () => {
    let height = 0;
    if (UIElements.mainHeader) height += UIElements.mainHeader.offsetHeight;
    if (UIElements.unifiedGuideHeader) height += UIElements.unifiedGuideHeader.offsetHeight;
    return height;
};

// This function is now controlled by the ReactGuide component's scroll handler
// It updates the `header-collapsed` class on the `app-container`
const onToggleHeaderVisibility = (collapse) => {
    const appContainer = UIElements.appContainer;
    if (!appContainer) return;

    if (collapse && !appContainer.classList.contains('header-collapsed')) {
        appContainer.classList.add('header-collapsed');
        // Maintain a minimum padding when collapsed to avoid layout jumps
        UIElements.pageGuide.style.paddingTop = `1px`; 
    } else if (!collapse && appContainer.classList.contains('header-collapsed')) {
        appContainer.classList.remove('header-collapsed');
        // Restore padding when expanded
        UIElements.pageGuide.style.paddingTop = `1px`; 
    }
};

/**
 * Sets up core application event listeners (navigation, modals, etc.).
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
}

// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    // Setup listeners for the initial auth forms first
    setupAuthEventListeners();
    // Then check the auth status to decide what to show
    checkAuthStatus();
});
```
