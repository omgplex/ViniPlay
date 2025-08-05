/**
 * auth.js
 * * Handles user authentication, including login, logout, and initial setup.
 */

import { UIElements, appState } from './state.js';
import { initMainApp } from '../main.js';
import { showNotification } from './ui.js'; // Import showNotification for consistent error display

/**
 * Populates the UIElements object with references to DOM elements.
 * This is now the definitive list, ensuring all elements are mapped correctly.
 * It runs once after a successful login.
 */
const initializeUIElements = () => {
    console.log('[AUTH_UI] Mapping all DOM elements to UIElements state...');
    
    // Auth
    Object.assign(UIElements, {
        authContainer: document.getElementById('auth-container'),
        loginForm: document.getElementById('login-form'),
        setupForm: document.getElementById('setup-form'),
        loginError: document.getElementById('login-error'),
        setupError: document.getElementById('setup-error'),
        authLoader: document.getElementById('auth-loader')
    });

    // Main App Structure
    Object.assign(UIElements, {
        appContainer: document.getElementById('app-container'),
        mainHeader: document.getElementById('main-header'),
        userDisplay: document.getElementById('user-display'),
        logoutBtn: document.getElementById('logout-btn')
    });

    // Pages
    Object.assign(UIElements, {
        pageGuide: document.getElementById('page-guide'),
        pageMultiview: document.getElementById('page-multiview'),
        pageDvr: document.getElementById('page-dvr'),
        pageNotifications: document.getElementById('page-notifications'),
        pageSettings: document.getElementById('page-settings')
    });

    // Navigation (Desktop & Mobile)
    Object.assign(UIElements, {
        tabGuide: document.getElementById('tab-guide'),
        tabMultiview: document.getElementById('tab-multiview'),
        tabDvr: document.getElementById('tab-dvr'),
        tabNotifications: document.getElementById('tab-notifications'),
        tabSettings: document.getElementById('tab-settings'),
        mobileMenuToggle: document.getElementById('mobile-menu-toggle'),
        mobileNavMenu: document.getElementById('mobile-nav-menu'),
        mobileMenuClose: document.getElementById('mobile-menu-close'),
        mobileMenuOverlay: document.getElementById('mobile-menu-overlay'),
        mobileNavGuide: document.getElementById('mobile-nav-guide'),
        mobileNavMultiview: document.getElementById('mobile-nav-multiview'),
        mobileNavDvr: document.getElementById('mobile-nav-dvr'),
        mobileNavNotifications: document.getElementById('mobile-nav-notifications'),
        mobileNavSettings: document.getElementById('mobile-nav-settings'),
        mobileNavLogoutBtn: document.getElementById('mobile-nav-logout-btn')
    });

    // Guide Page
    Object.assign(UIElements, {
        unifiedGuideHeader: document.getElementById('unified-guide-header'),
        guideDateDisplay: document.getElementById('guide-date-display'),
        guideDatePicker: document.getElementById('guide-date-picker'),
        groupFilter: document.getElementById('group-filter'),
        sourceFilter: document.getElementById('source-filter'),
        searchInput: document.getElementById('search-input'),
        searchResultsContainer: document.getElementById('search-results-container'),
        guideContainer: document.getElementById('guide-container'),
        guidePlaceholder: document.getElementById('guide-placeholder'),
        initialLoadingIndicator: document.getElementById('initial-loading-indicator'),
        noDataMessage: document.getElementById('no-data-message'),
        guideGrid: document.getElementById('guide-grid'),
        channelColumnResizeHandle: document.getElementById('channel-column-resize-handle')
    });
    
    // Multi-View Page & Shared Channel Selector Modal
    Object.assign(UIElements, {
        multiviewHeader: document.getElementById('multiview-header'),
        multiviewContainer: document.getElementById('multiview-container'),
        multiviewAddPlayer: document.getElementById('multiview-add-player'),
        multiviewRemovePlayer: document.getElementById('multiview-remove-player'),
        layoutBtnAuto: document.getElementById('layout-btn-auto'),
        layoutBtn2x2: document.getElementById('layout-btn-2x2'),
        layoutBtn1x3: document.getElementById('layout-btn-1x3'),
        multiviewSaveLayoutBtn: document.getElementById('multiview-save-layout-btn'),
        multiviewLoadLayoutBtn: document.getElementById('multiview-load-layout-btn'),
        multiviewDeleteLayoutBtn: document.getElementById('multiview-delete-layout-btn'),
        savedLayoutsSelect: document.getElementById('saved-layouts-select'),
        multiviewChannelSelectorModal: document.getElementById('multiview-channel-selector-modal'),
        multiviewChannelFilter: document.getElementById('multiview-channel-filter'),
        channelSelectorSearch: document.getElementById('channel-selector-search'),
        channelSelectorList: document.getElementById('channel-selector-list'),
        channelSelectorCancelBtn: document.getElementById('channel-selector-cancel-btn')
    });

    // DVR Page
    Object.assign(UIElements, {
        dvrStorageBarContainer: document.getElementById('dvr-storage-bar-container'),
        dvrStorageText: document.getElementById('dvr-storage-text'),
        dvrStorageBar: document.getElementById('dvr-storage-bar'),
        manualRecordingForm: document.getElementById('manual-recording-form'),
        manualRecChannelSelectBtn: document.getElementById('manual-rec-channel-select-btn'),
        manualRecSelectedChannelName: document.getElementById('manual-rec-selected-channel-name'),
        manualRecChannelId: document.getElementById('manual-rec-channel-id'),
        manualRecChannelName: document.getElementById('manual-rec-channel-name'),
        manualRecStart: document.getElementById('manual-rec-start'),
        manualRecEnd: document.getElementById('manual-rec-end'),
        dvrJobsTbody: document.getElementById('dvr-jobs-tbody'),
        noDvrJobsMessage: document.getElementById('no-dvr-jobs-message'),
        dvrRecordingsTbody: document.getElementById('dvr-recordings-tbody'),
        noDvrRecordingsMessage: document.getElementById('no-dvr-recordings-message')
    });

    // Settings Page
    Object.assign(UIElements, {
        userManagementSection: document.getElementById('user-management-section'),
        addUserBtn: document.getElementById('add-user-btn'),
        userList: document.getElementById('user-list'),
        processSourcesBtn: document.getElementById('process-sources-btn'),
        processSourcesBtnContent: document.getElementById('process-sources-btn-content'),
        addM3uBtn: document.getElementById('add-m3u-btn'),
        m3uSourcesTbody: document.getElementById('m3u-sources-tbody'),
        addEpgBtn: document.getElementById('add-epg-btn'),
        epgSourcesTbody: document.getElementById('epg-sources-tbody'),
        userAgentSelect: document.getElementById('user-agent-select'),
        addUserAgentBtn: document.getElementById('add-user-agent-btn'),
        editUserAgentBtn: document.getElementById('edit-user-agent-btn'),
        deleteUserAgentBtn: document.getElementById('delete-user-agent-btn'),
        streamProfileSelect: document.getElementById('stream-profile-select'),
        addStreamProfileBtn: document.getElementById('add-stream-profile-btn'),
        editStreamProfileBtn: document.getElementById('edit-stream-profile-btn'),
        deleteStreamProfileBtn: document.getElementById('delete-stream-profile-btn'),
        dvrRecordingProfileSelect: document.getElementById('dvr-recording-profile-select'),
        addDvrProfileBtn: document.getElementById('add-dvr-profile-btn'),
        editDvrProfileBtn: document.getElementById('edit-dvr-profile-btn'),
        deleteDvrProfileBtn: document.getElementById('delete-dvr-profile-btn'),
        dvrPreBufferInput: document.getElementById('dvr-pre-buffer-input'),
        dvrPostBufferInput: document.getElementById('dvr-post-buffer-input'),
        dvrMaxStreamsInput: document.getElementById('dvr-max-streams-input'),
        dvrStorageDeleteDays: document.getElementById('dvr-storage-delete-days'),
        timezoneOffsetSelect: document.getElementById('timezone-offset-select'),
        detectedTimezoneInfo: document.getElementById('detected-timezone-info'),
        searchScopeSelect: document.getElementById('search-scope-select'),
        notificationLeadTimeInput: document.getElementById('notification-lead-time-input'),
        clearDataBtn: document.getElementById('clear-data-btn')
    });

    // Modals
    Object.assign(UIElements, {
        videoModal: document.getElementById('video-modal'),
        videoModalContainer: document.getElementById('video-modal-container'),
        videoTitle: document.getElementById('video-title'),
        videoElement: document.getElementById('videoElement'),
        castBtn: document.getElementById('cast-btn'),
        castStatus: document.getElementById('cast-status'),
        castStatusText: document.getElementById('cast-status-text'),
        castStatusChannel: document.getElementById('cast-status-channel'),
        pipBtn: document.getElementById('pip-btn'),
        closeModal: document.getElementById('close-modal'),
        videoResizeHandle: document.getElementById('video-resize-handle'),
        programDetailsModal: document.getElementById('program-details-modal'),
        programDetailsContainer: document.getElementById('program-details-container'),
        detailsTitle: document.getElementById('details-title'),
        detailsTime: document.getElementById('details-time'),
        detailsDesc: document.getElementById('details-desc'),
        detailsPlayBtn: document.getElementById('details-play-btn'),
        detailsFavoriteBtn: document.getElementById('details-favorite-btn'),
        detailsCloseBtn: document.getElementById('details-close-btn'),
        detailsResizeHandle: document.getElementById('details-resize-handle'),
        programDetailsNotifyBtn: document.getElementById('program-details-notify-btn'),
        programDetailsRecordBtn: document.getElementById('details-record-btn'),
        notificationModal: document.getElementById('notification-modal-wrapper'),
        notificationBox: document.getElementById('notification-box'),
        notificationMessage: document.getElementById('notification-message'),
        confirmModal: document.getElementById('confirm-modal'),
        confirmTitle: document.getElementById('confirm-title'),
        confirmMessage: document.getElementById('confirm-message'),
        confirmCancelBtn: document.getElementById('confirm-cancel-btn'),
        confirmOkBtn: document.getElementById('confirm-ok-btn'),
        saveLayoutModal: document.getElementById('save-layout-modal'),
        saveLayoutForm: document.getElementById('save-layout-form'),
        saveLayoutName: document.getElementById('save-layout-name'),
        saveLayoutCancelBtn: document.getElementById('save-layout-cancel-btn'),
        sourceEditorModal: document.getElementById('source-editor-modal'),
        sourceEditorForm: document.getElementById('source-editor-form'),
        sourceEditorTitle: document.getElementById('source-editor-title'),
        sourceEditorId: document.getElementById('source-editor-id'),
        sourceEditorType: document.getElementById('source-editor-type'),
        sourceEditorName: document.getElementById('source-editor-name'),
        sourceEditorIsActive: document.getElementById('source-editor-isActive'),
        sourceEditorTypeBtnUrl: document.getElementById('source-editor-type-btn-url'),
        sourceEditorTypeBtnFile: document.getElementById('source-editor-type-btn-file'),
        sourceEditorUrlContainer: document.getElementById('source-editor-url-container'),
        sourceEditorUrl: document.getElementById('source-editor-url'),
        sourceEditorFileContainer: document.getElementById('source-editor-file-container'),
        sourceEditorFile: document.getElementById('source-editor-file'),
        sourceEditorFileInfo: document.getElementById('source-editor-file-info'),
        sourceEditorRefreshContainer: document.getElementById('source-editor-refresh-container'),
        sourceEditorRefreshInterval: document.getElementById('source-editor-refresh-interval'),
        sourceEditorCancelBtn: document.getElementById('source-editor-cancel-btn'),
        sourceEditorSaveBtn: document.getElementById('source-editor-save-btn'),
        editorModal: document.getElementById('editor-modal'),
        editorTitle: document.getElementById('editor-title'),
        editorForm: document.getElementById('editor-form'),
        editorId: document.getElementById('editor-id'),
        editorType: document.getElementById('editor-type'),
        editorName: document.getElementById('editor-name'),
        editorValueContainer: document.getElementById('editor-value-container'),
        editorValueLabel: document.getElementById('editor-value-label'),
        editorValue: document.getElementById('editor-value'),
        editorCancelBtn: document.getElementById('editor-cancel-btn'),
        editorSaveBtn: document.getElementById('editor-save-btn'),
        userEditorModal: document.getElementById('user-editor-modal'),
        userEditorTitle: document.getElementById('user-editor-title'),
        userEditorForm: document.getElementById('user-editor-form'),
        userEditorId: document.getElementById('user-editor-id'),
        userEditorError: document.getElementById('user-editor-error'),
        userEditorUsername: document.getElementById('user-editor-username'),
        userEditorPassword: document.getElementById('user-editor-password'),
        userEditorIsAdmin: document.getElementById('user-editor-isAdmin'),
        userEditorCanUseDvr: document.getElementById('user-editor-canUseDvr'),
        userEditorCancelBtn: document.getElementById('user-editor-cancel-btn'),
        recordingPlayerModal: document.getElementById('recording-player-modal'),
        recordingTitle: document.getElementById('recording-title'),
        recordingVideoElement: document.getElementById('recording-video-element'),
        closeRecordingPlayerBtn: document.getElementById('close-recording-player-btn'),
        dvrErrorModal: document.getElementById('dvr-error-modal'),
        dvrErrorModalTitle: document.getElementById('dvr-error-modal-title'),
        dvrErrorModalContent: document.getElementById('dvr-error-modal-content'),
        dvrErrorModalCloseBtn: document.getElementById('dvr-error-modal-close-btn'),
        dvrEditModal: document.getElementById('dvr-edit-modal'),
        dvrEditModalTitle: document.getElementById('dvr-edit-modal-title'),
        dvrEditForm: document.getElementById('dvr-edit-form'),
        dvrEditId: document.getElementById('dvr-edit-id'),
        dvrEditStart: document.getElementById('dvr-edit-start'),
        dvrEditEnd: document.getElementById('dvr-edit-end'),
        dvrEditCancelBtn: document.getElementById('dvr-edit-cancel-btn')
    });

    console.log(`[AUTH_UI] All UI elements have been mapped into UIElements state.`);
};


/**
 * Shows the login form.
 * @param {string|null} errorMsg - An optional error message to display.
 */
export const showLoginScreen = (errorMsg = null) => {
    // This is called before the main app is visible, so we only need to find the auth elements here.
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');
    const loginForm = document.getElementById('login-form');
    const setupForm = document.getElementById('setup-form');
    const authLoader = document.getElementById('auth-loader');
    const loginError = document.getElementById('login-error');

    console.log('[AUTH_UI] Displaying login screen.');
    authContainer.classList.remove('hidden');
    appContainer.classList.add('hidden');
    loginForm.classList.remove('hidden');
    setupForm.classList.add('hidden');
    authLoader.classList.add('hidden'); // Hide loader
    if (errorMsg) {
        loginError.textContent = errorMsg;
        loginError.classList.remove('hidden');
        console.error(`[AUTH_UI] Login error displayed: ${errorMsg}`);
    } else {
        loginError.classList.add('hidden'); // Ensure error is hidden if no message
    }
};

/**
 * Shows the initial admin setup form.
 */
const showSetupScreen = () => {
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');
    const loginForm = document.getElementById('login-form');
    const setupForm = document.getElementById('setup-form');
    const authLoader = document.getElementById('auth-loader');
    const setupError = document.getElementById('setup-error');
    
    console.log('[AUTH_UI] Displaying setup screen.');
    authContainer.classList.remove('hidden');
    appContainer.classList.add('hidden');
    loginForm.classList.add('hidden');
    setupForm.classList.remove('hidden');
    authLoader.classList.add('hidden'); // Hide loader
    setupError.classList.add('hidden'); // Clear previous setup errors
};

/**
 * Shows the main application container and hides the auth screen.
 * @param {object} user - The user object { username, isAdmin, canUseDvr }.
 */
const showApp = (user) => {
    appState.currentUser = user;
    
    const authContainer = document.getElementById('auth-container');
    const appContainer = document.getElementById('app-container');

    authContainer.classList.add('hidden');
    appContainer.classList.remove('hidden');
    appContainer.classList.add('flex'); // Ensure flex display for app layout

    initializeUIElements();
    console.log('[AUTH_UI] UI Elements initialized.');

    console.log(`[AUTH_UI] Displaying main app for user: ${user.username} (Admin: ${user.isAdmin}, DVR: ${user.canUseDvr})`);

    UIElements.userDisplay.textContent = user.username;
    UIElements.userDisplay.classList.remove('hidden');
    UIElements.userManagementSection.classList.toggle('hidden', !user.isAdmin);
    // The entire DVR settings section visibility is handled in settings.js, so we don't need a specific element here.
    console.log(`[AUTH_UI] User display set to: ${user.username}. Admin section visibility: ${!user.isAdmin ? 'hidden' : 'visible'}.`);

    if (!appState.appInitialized) {
        console.log('[AUTH_UI] Main app not initialized yet, calling initMainApp().');
        initMainApp();
        appState.appInitialized = true;
    } else {
        console.log('[AUTH_UI] Main app already initialized.');
    }
};

/**
 * Checks the user's authentication status with the server.
 * Determines whether to show the login, setup, or main app screen.
 */
export async function checkAuthStatus() {
    console.log('[AUTH] Starting authentication status check...');
    // We only need a few elements for the initial check
    const authLoader = document.getElementById('auth-loader');
    const loginError = document.getElementById('login-error');
    authLoader.classList.remove('hidden'); // Show loader
    loginError.classList.add('hidden'); // Clear any previous errors

    try {
        const res = await fetch('/api/auth/status');
        if (!res.ok) {
            console.warn(`[AUTH] /api/auth/status returned non-OK status: ${res.status} ${res.statusText}`);
        }
        const status = await res.json();
        console.log('[AUTH] /api/auth/status response:', status);

        if (status.isLoggedIn) {
            console.log('[AUTH] User is logged in. Showing app.');
            showApp(status.user);
        } else {
            console.log('[AUTH] User not logged in. Checking if setup is needed...');
            const setupRes = await fetch('/api/auth/needs-setup');
            if (!setupRes.ok) {
                 console.warn(`[AUTH] /api/auth/needs-setup returned non-OK status: ${setupRes.status} ${setupRes.statusText}`);
            }
            const setup = await setupRes.json();
            console.log('[AUTH] /api/auth/needs-setup response:', setup);
            if (setup.needsSetup) {
                console.log('[AUTH] App needs initial admin setup. Showing setup screen.');
                showSetupScreen();
            } else {
                console.log('[AUTH] App does not need setup. Showing login screen.');
                showLoginScreen();
            }
        }
    } catch (e) {
        console.error("[AUTH] Authentication check failed:", e);
        showLoginScreen("Could not verify authentication status. Please check server connection.");
        showNotification("Failed to connect to authentication server.", true);
    } finally {
        authLoader.classList.add('hidden'); // Always hide loader at the end
    }
}

/**
 * Sets up event listeners for the authentication forms (login, setup, logout).
 */
export function setupAuthEventListeners() {
    console.log('[AUTH] Setting up authentication event listeners.');
    // These elements are always present from the start, so it's safe to get them here.
    const loginForm = document.getElementById('login-form');
    const loginUsername = document.getElementById('login-username');
    const loginPassword = document.getElementById('login-password');
    const loginError = document.getElementById('login-error');
    const setupForm = document.getElementById('setup-form');
    const setupUsername = document.getElementById('setup-username');
    const setupPassword = document.getElementById('setup-password');
    const setupError = document.getElementById('setup-error');
    const logoutBtn = document.getElementById('logout-btn');


    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[AUTH_EVENT] Login form submitted.');
        loginError.classList.add('hidden');
        const username = loginUsername.value;
        const password = loginPassword.value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            console.log('[AUTH_EVENT] Login API response:', data);

            if (res.ok) {
                console.log('[AUTH_EVENT] Login successful.');
                showApp(data.user);
            } else {
                console.warn(`[AUTH_EVENT] Login failed: ${data.error}`);
                loginError.textContent = data.error;
                loginError.classList.remove('hidden');
            }
        } catch (error) {
            console.error('[AUTH_EVENT] Login fetch error:', error);
            loginError.textContent = "Failed to connect to server for login.";
            loginError.classList.remove('hidden');
        }
    });

    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('[AUTH_EVENT] Setup form submitted.');
        setupError.classList.add('hidden');
        const username = setupUsername.value;
        const password = setupPassword.value;

        try {
            const res = await fetch('/api/auth/setup-admin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            console.log('[AUTH_EVENT] Setup API response:', data);

            if (res.ok) {
                console.log('[AUTH_EVENT] Admin setup successful.');
                showApp(data.user);
            } else {
                console.warn(`[AUTH_EVENT] Admin setup failed: ${data.error}`);
                setupError.textContent = data.error;
                setupError.classList.remove('hidden');
            }
        } catch (error) {
            console.error('[AUTH_EVENT] Setup fetch error:', error);
            setupError.textContent = "Failed to connect to server for setup.";
            setupError.classList.remove('hidden');
        }
    });

    logoutBtn.addEventListener('click', async () => {
        console.log('[AUTH_EVENT] Logout button clicked.');
        try {
            const res = await fetch('/api/auth/logout', { method: 'POST' });
            if (!res.ok) {
                console.warn(`[AUTH_EVENT] Logout API returned non-OK status: ${res.status}`);
            }
            console.log('[AUTH_EVENT] Logout request sent. Reloading window.');
            window.location.reload(); // Full reload to clear client state
        } catch (error) {
            console.error('[AUTH_EVENT] Logout fetch error:', error);
            showNotification("Failed to log out. Please try again.", true);
        }
    });
}

