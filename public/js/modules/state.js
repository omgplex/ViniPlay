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

// A cache for frequently accessed DOM elements.
// This object will be populated by initUIElements() after the DOM is ready.
export const UIElements = {};

/**
 * Populates the UIElements cache after the DOM is ready.
 * This should be called once on application startup.
 */
export function initUIElements() {
    const elementIds = [...document.querySelectorAll('[id]')];
    elementIds.forEach(el => {
        const camelCaseId = el.id.replace(/-(\w)/g, (match, letter) => letter.toUpperCase());
        UIElements[camelCaseId] = el;
    });
}
