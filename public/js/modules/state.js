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
    fuseChannels: null, // Fuse.js instance for channels (now managed by ReactGuide internally)
    fusePrograms: null, // Fuse.js instance for programs (now managed by ReactGuide internally)
    currentSourceTypeForEditor: 'url',
};

// State specific to the TV Guide
export const guideState = {
    channels: [], // Raw channel data (passed to React)
    programs: {}, // Raw program data (passed to React)
    settings: {
        // Add a default for channelColumnWidth
        channelColumnWidth: window.innerWidth < 768 ? 64 : 180, // Default based on screen size
        guideDurationHours: 48,
        hourWidthPixels: window.innerWidth < 768 ? 200 : 300,
        searchScope: 'channels_programs',
        autoRefresh: 0,
        timezoneOffset: Math.round(-(new Date().getTimezoneOffset() / 60))
    }, // This will hold both GLOBAL and USER settings, merged.
    currentDate: new Date(), // Managed by main.js and passed to React
    channelGroups: new Set(), // Populated in guide.js, used for vanilla JS filter dropdowns
    channelSources: new Set(), // Populated in guide.js, used for vanilla JS filter dropdowns
    // visibleChannels: [], // No longer needed directly here, managed by React
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
UIElements.appContainer = document.getElementById('app-container'); // Ensure appContainer is mapped
UIElements.mainHeader = document.getElementById('main-header');
UIElements.unifiedGuideHeader = document.getElementById('unified-guide-header'); // NEW unified header
UIElements.pageGuide = document.getElementById('page-guide'); // Ensure pageGuide is mapped
UIElements.guideDateDisplay = document.getElementById('guide-date-display'); // Ensure date display is mapped

// Removed direct references to guide-grid, sticky-corner, channel-column-resize-handle
// as these are now managed within the React component's DOM.
// The `react-guide-root` will be the mount point.
UIElements.reactGuideRoot = document.getElementById('react-guide-root');

// Manually add resetFilterBtn if auto-mapping doesn't catch it
UIElements.resetFilterBtn = document.getElementById('reset-filter-btn');

// Also expose functions from other modules that might be passed as callbacks
// This is for convenience and avoids circular dependencies if these are needed
// directly in UIElements (e.g., in main.js for initial setup).
import { saveUserSetting as _saveUserSetting } from './api.js';
import { showConfirm as _showConfirm } from './ui.js';
import { showProgramDetails as _showProgramDetails } from './ui.js';

UIElements.saveUserSetting = _saveUserSetting;
UIElements.showConfirm = _showConfirm;
UIElements.showProgramDetails = _showProgramDetails;
