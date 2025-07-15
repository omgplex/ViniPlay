/**
 * state.js
 * * Manages the shared state of the application.
 * This includes global app status, guide data, and cached UI elements.
 */

// Global state for the application's status
export const appState = {
    currentUser: null, // { username, isAdmin }
    appInitialized: false,
    player: null, // mpegts.js player instance
    searchDebounceTimer: null,
    confirmCallback: null,
    db: null, // IndexedDB instance
    fuseChannels: null, // Fuse.js instance for channels
    fusePrograms: null, // Fuse.js instance for programs
    currentSourceTypeForEditor: 'url',
    // New state for scroll behavior
    lastScrollTop: 0,
    headerVisible: true,
};

// State specific to the TV Guide
export const guideState = {
    channels: [],
    programs: {},
    settings: {}, // This will hold both GLOBAL and USER settings, merged.
    guideDurationHours: 48,
    hourWidthPixels: window.innerWidth < 768 ? 200 : 300,
    currentDate: new Date(),
    channelGroups: new Set(),
    channelSources: new Set(), // For the source filter
    visibleChannels: [],
};

// A cache for frequently accessed DOM elements
export const UIElements = Object.fromEntries(
    [...document.querySelectorAll('[id]')].map(el => [
        // Convert kebab-case id to camelCase for easier access in JS
        el.id.replace(/-(\w)/g, (match, letter) => letter.toUpperCase()),
        el
    ])
);

// Add specific references that might not be picked up by generic ID mapping
UIElements.mainHeader = document.getElementById('main-header');
UIElements.desktopTabs = document.getElementById('desktop-tabs');
UIElements.unifiedGuideHeader = document.getElementById('unified-guide-header'); // NEW unified header

// Manually add elements that might not be auto-mapped or need specific references
UIElements.groupFilter = document.getElementById('group-filter');
UIElements.sourceFilter = document.getElementById('source-filter');
UIElements.searchInput = document.getElementById('search-input');
UIElements.searchResultsContainer = document.getElementById('search-results-container');
UIElements.resetFilterBtn = document.getElementById('reset-filter-btn');

// Mobile specific filter and search elements
UIElements.groupFilterMobile = document.getElementById('group-filter-mobile');
UIElements.sourceFilterMobile = document.getElementById('source-filter-mobile');
UIElements.searchInputMobile = document.getElementById('search-input-mobile');
UIElements.searchResultsContainerMobile = document.getElementById('search-results-container-mobile');
UIElements.resetFilterBtnMobile = document.getElementById('reset-filter-btn-mobile');
