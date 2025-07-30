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

    // --- NEW: Multi-View Elements ---
    UIElements.pageMultiview = document.getElementById('page-multiview');
    UIElements.tabMultiview = document.getElementById('tab-multiview');
    UIElements.mobileNavMultiview = document.getElementById('mobile-nav-multiview');
    UIElements.multiviewHeader = document.getElementById('multiview-header');
    UIElements.multiviewContainer = document.getElementById('multiview-container');
    UIElements.multiviewAddPlayer = document.getElementById('multiview-add-player');
    UIElements.multiviewRemovePlayer = document.getElementById('multiview-remove-player');
    UIElements.layoutBtnAuto = document.getElementById('layout-btn-auto');
    UIElements.layoutBtn2x2 = document.getElementById('layout-btn-2x2');
    UIElements.layoutBtn1x3 = document.getElementById('layout-btn-1x3');
    UIElements.multiviewChannelSelectorModal = document.getElementById('multiview-channel-selector-modal');
    UIElements.channelSelectorList = document.getElementById('channel-selector-list');
    UIElements.channelSelectorSearch = document.getElementById('channel-selector-search');
    UIElements.channelSelectorCancelBtn = document.getElementById('channel-selector-cancel-btn');
    // CORRECTED: Explicitly add all new Multi-View elements
    UIElements.multiviewSaveLayoutBtn = document.getElementById('multiview-save-layout-btn');
    UIElements.multiviewLoadLayoutBtn = document.getElementById('multiview-load-layout-btn');
    UIElements.multiviewDeleteLayoutBtn = document.getElementById('multiview-delete-layout-btn');
    UIElements.savedLayoutsSelect = document.getElementById('saved-layouts-select');
    UIElements.saveLayoutModal = document.getElementById('save-layout-modal');
    UIElements.saveLayoutForm = document.getElementById('save-layout-form');
    UIElements.saveLayoutName = document.getElementById('save-layout-name');
    UIElements.saveLayoutCancelBtn = document.getElementById('save-layout-cancel-btn');
    UIElements.multiviewChannelFilter = document.getElementById('multiview-channel-filter');
    
    // **FIX**: Explicitly add settings buttons that were not being picked up
    UIElements.addM3uBtn = document.getElementById('add-m3u-btn');
    UIElements.addEpgBtn = document.getElementById('add-epg-btn');
    UIElements.processSourcesBtnContent = document.getElementById('process-sources-btn-content');

    // Removed: UIElements.autoRefreshSelect as it is no longer in the HTML
};
