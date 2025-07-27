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
    swRegistration: null, // Added for Service Worker registration
};

// State specific to the TV Guide
export const guideState = {
    channels: [],
    programs: {},
    settings: {
        // Add a default for channelColumnWidth
        channelColumnWidth: window.innerWidth < 768 ? 64 : 180, // Default based on screen size
        notificationLeadTime: 10, // Default notification lead time in minutes
    }, // This will hold both GLOBAL and USER settings, merged.
    guideDurationHours: 48,
    hourWidthPixels: window.innerWidth < 768 ? 200 : 300,
    currentDate: new Date(),
    channelGroups: new Set(),
    channelSources: new Set(), // For the source filter
    visibleChannels: [],
    scrollHandler: null, // Holds the reference to the throttled scroll handler for virtualization
    // NEW: userNotifications is now an object to hold both active and past notifications
    userNotifications: {
        active: [],
        past: []
    },
};

// A cache for frequently accessed DOM elements
// Initially empty, will be populated after the DOM is ready and visible
export const UIElements = {};

/**
 * Populates the UIElements object with references to DOM elements.
 * This should be called after the main app container is visible.
 */
export const initializeUIElements = () => {
    console.log('[STATE] Initializing UIElements by querying DOM...');
    // Populate UIElements by querying all elements with an 'id' attribute
    // and converting their kebab-case IDs to camelCase keys.
    Object.assign(UIElements, Object.fromEntries(
        [...document.querySelectorAll('[id]')].map(el => [
            el.id.replace(/-(\w)/g, (match, letter) => letter.toUpperCase()),
            el
        ])
    ));

    // Explicitly add specific critical elements, or ensure they are properly
    // caught by the generic ID mapping. This acts as a double-check.
    UIElements.appContainer = document.getElementById('app-container');
    UIElements.mainHeader = document.getElementById('main-header');
    UIElements.unifiedGuideHeader = document.getElementById('unified-guide-header');
    UIElements.pageGuide = document.getElementById('page-guide');
    UIElements.guideDateDisplay = document.getElementById('guide-date-display');
    UIElements.stickyCorner = document.querySelector('.sticky-corner');
    UIElements.channelColumnResizeHandle = document.getElementById('channel-column-resize-handle');

    // Program Details Modal Notification Button
    UIElements.programDetailsNotifyBtn = document.getElementById('program-details-notify-btn');

    // Mobile menu elements
    UIElements.mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    UIElements.mobileNavMenu = document.getElementById('mobile-nav-menu');
    UIElements.mobileMenuClose = document.getElementById('mobile-menu-close');
    UIElements.mobileNavGuide = document.getElementById('mobile-nav-guide');
    UIElements.mobileNavSettings = document.getElementById('mobile-nav-settings');
    UIElements.mobileNavLogoutBtn = document.getElementById('mobile-nav-logout-btn');
    UIElements.mobileMenuOverlay = document.getElementById('mobile-menu-overlay');

    // Notification Tab/Page Elements
    UIElements.tabNotifications = document.getElementById('tab-notifications'); // Desktop Nav
    UIElements.mobileNavNotifications = document.getElementById('mobile-nav-notifications'); // Mobile Nav
    UIElements.pageNotifications = document.getElementById('page-notifications');
    UIElements.notificationsList = document.getElementById('notifications-list');
    UIElements.noNotificationsMessage = document.getElementById('no-notifications-message');
    UIElements.notificationLeadTimeInput = document.getElementById('notification-lead-time-input');

    // Past Notification elements
    UIElements.pastNotificationsHeader = document.getElementById('past-notifications-header');
    UIElements.pastNotificationsList = document.getElementById('past-notifications-list');

    // Auth screen elements
    UIElements.authContainer = document.getElementById('auth-container');
    UIElements.authLoader = document.getElementById('auth-loader');
    UIElements.loginForm = document.getElementById('login-form');
    UIElements.loginUsername = document.getElementById('login-username');
    UIElements.loginPassword = document.getElementById('login-password');
    UIElements.loginError = document.getElementById('login-error');
    UIElements.setupForm = document.getElementById('setup-form');
    UIElements.setupUsername = document.getElementById('setup-username');
    UIElements.setupPassword = document.getElementById('setup-password');
    UIElements.setupError = document.getElementById('setup-error');

    // Other core UI elements
    UIElements.userDisplay = document.getElementById('user-display');
    UIElements.userManagementSection = document.getElementById('user-management-section');
    UIElements.logoutBtn = document.getElementById('logout-btn');
    UIElements.guidePlaceholder = document.getElementById('guide-placeholder');
    UIElements.initialLoadingIndicator = document.getElementById('initial-loading-indicator');
    UIElements.noDataMessage = document.getElementById('no-data-message');
    UIElements.guideGrid = document.getElementById('guide-grid');
    UIElements.videoModalContainer = document.getElementById('video-modal-container');
    UIElements.programDetailsContainer = document.getElementById('program-details-container');
    UIElements.videoResizeHandle = document.getElementById('video-resize-handle');
    UIElements.detailsResizeHandle = document.getElementById('details-resize-handle');
    UIElements.confirmModal = document.getElementById('confirm-modal');
    UIElements.confirmCancelBtn = document.getElementById('confirm-cancel-btn');
    UIElements.confirmOkBtn = document.getElementById('confirm-ok-btn');
    UIElements.programDetailsModal = document.getElementById('program-details-modal');
    UIElements.detailsTitle = document.getElementById('details-title');
    UIElements.detailsTime = document.getElementById('details-time');
    UIElements.detailsDesc = document.getElementById('details-desc');
    UIElements.detailsPlayBtn = document.getElementById('details-play-btn');
    UIElements.detailsCloseBtn = document.getElementById('details-close-btn');

    // Settings page elements
    UIElements.timezoneOffsetSelect = document.getElementById('timezone-offset-select');
    UIElements.autoRefreshSelect = document.getElementById('auto-refresh-select');
    UIElements.searchScopeSelect = document.getElementById('search-scope-select');
    UIElements.processSourcesBtn = document.getElementById('process-sources-btn');
    UIElements.processSourcesBtnContent = document.getElementById('process-sources-btn-content');
    UIElements.addM3uBtn = document.getElementById('add-m3u-btn');
    UIElements.addEpgBtn = document.getElementById('add-epg-btn');
    UIElements.m3uSourcesTbody = document.getElementById('m3u-sources-tbody');
    UIElements.epgSourcesTbody = document.getElementById('epg-sources-tbody');
    UIElements.sourceEditorModal = document.getElementById('source-editor-modal');
    UIElements.sourceEditorTitle = document.getElementById('source-editor-title');
    UIElements.sourceEditorForm = document.getElementById('source-editor-form');
    UIElements.sourceEditorId = document.getElementById('source-editor-id');
    UIElements.sourceEditorType = document.getElementById('source-editor-type');
    UIElements.sourceEditorName = document.getElementById('source-editor-name');
    UIElements.sourceEditorIsActive = document.getElementById('source-editor-isActive');
    UIElements.sourceEditorUrlContainer = document.getElementById('source-editor-url-container');
    UIElements.sourceEditorUrl = document.getElementById('source-editor-url');
    UIElements.sourceEditorFileContainer = document.getElementById('source-editor-file-container');
    UIElements.sourceEditorFile = document.getElementById('source-editor-file');
    UIElements.sourceEditorFileInfo = document.getElementById('source-editor-file-info');
    UIElements.sourceEditorTypeBtnUrl = document.getElementById('source-editor-type-btn-url');
    UIElements.sourceEditorTypeBtnFile = document.getElementById('source-editor-type-btn-file');
    UIElements.sourceEditorCancelBtn = document.getElementById('source-editor-cancel-btn');
    UIElements.sourceEditorSaveBtn = document.getElementById('source-editor-save-btn');
    UIElements.addUserAgentBtn = document.getElementById('add-user-agent-btn');
    UIElements.editUserAgentBtn = document.getElementById('edit-user-agent-btn');
    UIElements.deleteUserAgentBtn = document.getElementById('delete-user-agent-btn');
    UIElements.addStreamProfileBtn = document.getElementById('add-stream-profile-btn');
    UIElements.editStreamProfileBtn = document.getElementById('edit-stream-profile-btn');
    UIElements.deleteStreamProfileBtn = document.getElementById('delete-stream-profile-btn');
    UIElements.userAgentSelect = document.getElementById('user-agent-select');
    UIElements.streamProfileSelect = document.getElementById('stream-profile-select');
    UIElements.editorModal = document.getElementById('editor-modal');
    UIElements.editorTitle = document.getElementById('editor-title');
    UIElements.editorForm = document.getElementById('editor-form');
    UIElements.editorId = document.getElementById('editor-id');
    UIElements.editorType = document.getElementById('editor-type');
    UIElements.editorName = document.getElementById('editor-name');
    UIElements.editorValueLabel = document.getElementById('editor-value-label');
    UIElements.editorValue = document.getElementById('editor-value');
    UIElements.editorCancelBtn = document.getElementById('editor-cancel-btn');
    UIElements.editorSaveBtn = document.getElementById('editor-save-btn');
    UIElements.addUserBtn = document.getElementById('add-user-btn');
    UIElements.userEditorModal = document.getElementById('user-editor-modal');
    UIElements.userEditorTitle = document.getElementById('user-editor-title');
    UIElements.userEditorForm = document.getElementById('user-editor-form');
    UIElements.userEditorId = document.getElementById('user-editor-id');
    UIElements.userEditorUsername = document.getElementById('user-editor-username');
    UIElements.userEditorPassword = document.getElementById('user-editor-password');
    UIElements.userEditorIsAdmin = document.getElementById('user-editor-isAdmin');
    UIElements.userEditorError = document.getElementById('user-editor-error');
    UIElements.userEditorCancelBtn = document.getElementById('user-editor-cancel-btn');
    UIElements.userList = document.getElementById('user-list');
    UIElements.clearDataBtn = document.getElementById('clear-data-btn');
    UIElements.searchInput = document.getElementById('search-input');
    UIElements.searchResultsContainer = document.getElementById('search-results-container');
    UIElements.groupFilter = document.getElementById('group-filter');
    UIElements.sourceFilter = document.getElementById('source-filter');
    UIElements.notificationModal = document.getElementById('notification-modal');
    UIElements.notificationMessage = document.getElementById('notification-message');


    console.log('[STATE] UIElements initialized. Keys:', Object.keys(UIElements).length);
    // You can add a check here to see if critical elements are indeed found
    if (!UIElements.notificationsList) {
        console.error('[STATE] CRITICAL: UIElements.notificationsList is null after initialization! This might indicate a problem with the DOM structure or ID.');
    }
};

