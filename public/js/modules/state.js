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
    settings: {
        // Add a default for channelColumnWidth
        channelColumnWidth: window.innerWidth < 768 ? 64 : 180, // Default based on screen size
    }, // This will hold both GLOBAL and USER settings, merged.
    guideDurationHours: 48,
    hourWidthPixels: window.innerWidth < 768 ? 200 : 300,
    currentDate: new Date(),
    channelGroups: new Set(),
    channelSources: new Set(), // For the source filter
    visibleChannels: [],
};

// A cache for frequently accessed DOM elements
// Update this section to reflect the new UI structure
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
UIElements.guideDateDisplay = document.getElementById('guide-date-display'); // Ensure date display is mapped
UIElements.stickyCorner = document.querySelector('.sticky-corner'); // Reference to the sticky corner for channel column resize
UIElements.channelColumnResizeHandle = document.getElementById('channel-column-resize-handle');


// No longer directly mapping prev-day-btn, now-btn, next-day-btn here
// as they are dynamically inserted into the sticky-corner by guide.js and handled there.

// Manually add resetFilterBtn if auto-mapping doesn't catch it
UIElements.resetFilterBtn = document.getElementById('reset-filter-btn');

