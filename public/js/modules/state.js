/**
 * state.js
 * * Manages the shared state of the application.
 * This includes global app status, guide data, and cached UI elements.
 */

// Global state for the application's status
export const appState = {
    currentUser: null, // { username, isAdmin, permissions }
    appInitialized: false,
    player: null, // mpegts.js player instance
    searchDebounceTimer: null,
    confirmCallback: null,
    db: null, // IndexedDB instance
    fuseChannels: null, // Fuse.js instance for channels
    fusePrograms: null, // Fuse.js instance for programs
    currentSourceTypeForEditor: 'url',
    swRegistration: null, // To hold the service worker registration
    isNavigating: false, // NEW: Flag to prevent race conditions during navigation
};

export const DEFAULT_USER_PERMISSIONS = Object.freeze({
    popular: true,
    channels: true,
    tvGuide: false,
    multiView: false,
    directPlayer: false,
    dvr: false,
    notifications: true,
});

export const ADMIN_USER_PERMISSIONS = Object.freeze(
    Object.keys(DEFAULT_USER_PERMISSIONS).reduce((acc, key) => {
        acc[key] = true;
        return acc;
    }, {})
);

export const getEffectivePermissions = () => {
    if (!appState.currentUser) return { ...DEFAULT_USER_PERMISSIONS };
    if (appState.currentUser.isAdmin) return { ...ADMIN_USER_PERMISSIONS };
    return { ...DEFAULT_USER_PERMISSIONS, ...(appState.currentUser.permissions || {}) };
};

export const hasPermission = (key) => {
    const permissions = getEffectivePermissions();
    return Boolean(permissions[key]);
};

// State specific to the TV Guide
export const guideState = {
    channels: [],
    programs: {},
    settings: {
        // Add a default for channelColumnWidth
        channelColumnWidth: window.innerWidth < 768 ? 64 : 270, // Default based on screen size
        notificationLeadTime: 10, // Default notification lead time in minutes
        multiviewLayouts: [], // To store saved layouts for the user
        adminPageSize: 25, // NEW: Default page size for the admin history table
    }, // This will hold both GLOBAL and USER settings, merged.
    guideDurationHours: 48,
    hourWidthPixels: window.innerWidth < 768 ? 200 : 300,
    currentDate: new Date(),
    channelGroups: new Set(),
    channelSources: new Set(), // For the source filter
    visibleChannels: [],
    scrollHandler: null, // Holds the reference to the throttled scroll handler for virtualization
    userNotifications: [], // Stores active program notifications for the current user
    popularNow: [], // Tracks currently viewed channels for the Popular page
};

// State specific to the DVR
export const dvrState = {
    scheduledJobs: [],
    completedRecordings: [],
};

// NEW: State specific to the Admin Activity page
export const adminState = {
    live: [],
    history: [],
    liveDurationInterval: null,
    channelSelectorCallback: null,
    pagination: {
        currentPage: 1,
        pageSize: 25,
        totalPages: 1,
        totalItems: 0,
    },
    healthCheckInterval: null
};


// A cache for frequently accessed DOM elements
// This will be populated by the auth.js module after the main app is visible.
export const UIElements = {
    // --- **FIX: Add the new element for notification settings** ---
    notificationSettings: document.getElementById('notification-settings-container'),
};
