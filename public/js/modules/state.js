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
    settings: {
        // Add a default for channelColumnWidth
        channelColumnWidth: window.innerWidth < 768 ? 64 : 180, // Default based on screen size
        notificationLeadTime: 10, // NEW: Default notification lead time in minutes
        multiviewLayouts: [], // ADDED: To store saved layouts for the user
    }, // This will hold both GLOBAL and USER settings, merged.
    guideDurationHours: 48,
    hourWidthPixels: window.innerWidth < 768 ? 200 : 300,
    currentDate: new Date(),
    channelGroups: new Set(),
    channelSources: new Set(), // For the source filter
    visibleChannels: [],
    scrollHandler: null, // NEW: Holds the reference to the throttled scroll handler for virtualization
    userNotifications: [], // NEW: Stores active program notifications for the current user
};

// NEW: State specific to the DVR
export const dvrState = {
    scheduledJobs: [],
    completedRecordings: [],
};


// A cache for frequently accessed DOM elements
// This will be populated by the auth.js module after the main app is visible.
export const UIElements = {};

