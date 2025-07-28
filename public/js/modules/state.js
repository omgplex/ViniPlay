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
    firstGuideRenderComplete: false, // NEW: Flag to track initial guide render and positioning
};

// State specific to the TV Guide
export const guideState = {
    channels: [],
    programs: {},
    settings: {
        // Add a default for channelColumnWidth
        channelColumnWidth: window.innerWidth < 768 ? 64 : 180, // Default based on screen size
        notificationLeadTime: 10, // NEW: Default notification lead time in minutes
        epgMinDate: null, // NEW: To store the earliest date available in EPG
        epgMaxDate: null  // NEW: To store the latest date available in EPG
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

// A cache for frequently accessed DOM elements
// Initially empty, will be populated after the DOM is ready and visible
export const UIElements = {};

/**
 * Populates the UIElements object with references to DOM elements.
 * This should be called after the main app container is visible.
 */
export const initializeUIElements = () => {
    // Populate UIElements by querying all elements with an 'id' attribute
    // and converting their kebab-case IDs to camelCase keys.
    Object.assign(UIElements, Object.fromEntries(
        [...document.querySelectorAll('[id]')].map(el => [
            el.id.replace(/-(\w)/g, (match, letter) => letter.toUpperCase()),
            el
        ])
    ));

    // Add specific references that might not be picked up by generic ID mapping
    // or are critical and need direct assignment for clarity.
    UIElements.appContainer = document.getElementById('app-container');
    UIElements.mainHeader = document.getElementById('main-header');
    UIElements.unifiedGuideHeader = document.getElementById('unified-guide-header');
    UIElements.pageGuide = document.getElementById('page-guide');
    UIElements.guideDateDisplay = document.getElementById('guide-date-display');
    UIElements.stickyCorner = document.querySelector('.sticky-corner');
    UIElements.channelColumnResizeHandle = document.getElementById('channel-column-resize-handle');

    // NEW: Program Details Modal Notification Button
    UIElements.programDetailsNotifyBtn = document.getElementById('program-details-notify-btn');

    // Mobile menu elements
    UIElements.mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    UIElements.mobileNavMenu = document.getElementById('mobile-nav-menu');
    UIElements.mobileMenuClose = document.getElementById('mobile-menu-close');
    UIElements.mobileNavGuide = document.getElementById('mobile-nav-guide');
    UIElements.mobileNavSettings = document.getElementById('mobile-nav-settings');
    UIElements.mobileNavLogoutBtn = document.getElementById('mobile-nav-logout-btn');
    UIElements.mobileMenuOverlay = document.getElementById('mobile-menu-overlay');

    // NEW: Notification Tab/Page Elements
    UIElements.tabNotifications = document.getElementById('tab-notifications'); // Desktop Nav
    UIElements.mobileNavNotifications = document.getElementById('mobile-nav-notifications'); // Mobile Nav
    UIElements.pageNotifications = document.getElementById('page-notifications');
    UIElements.notificationsList = document.getElementById('notifications-list');
    UIElements.noNotificationsMessage = document.getElementById('no-notifications-message');
    UIElements.notificationLeadTimeInput = document.getElementById('notification-lead-time-input');
    // NEW: Past Notifications section elements
    UIElements.pastNotificationsList = document.getElementById('past-notifications-list');
    UIElements.noPastNotificationsMessage = document.getElementById('no-past-notifications-message');

    // NEW: Date Picker elements
    UIElements.jumpToDateBtn = document.getElementById('jump-to-date-btn');
    UIElements.datePickerInput = document.getElementById('date-picker-input');

    // Removed: UIElements.resetFilterBtn as the button is removed from HTML
};
