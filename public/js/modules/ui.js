/**
 * ui.js
 * * Contains functions for managing the user interface.
 * This includes navigation, modals, notifications, and other DOM manipulations.
 */

import { UIElements, appState, guideState, getEffectivePermissions } from './state.js';
import { refreshUserList, updateUIFromSettings } from './settings.js';
import { loadAndScheduleNotifications, renderNotifications } from './notification.js';
import { initMultiView, isMultiViewActive, cleanupMultiView } from './multiview.js';
import { initDvrPage } from './dvr.js';
import { stopAndCleanupPlayer } from './player.js';
import { initDirectPlayer, isDirectPlayerActive, cleanupDirectPlayer } from './player_direct.js';
// MODIFIED: Import handleGuideLoad and fetchConfig for the refresh logic
import { finalizeGuideLoad, handleGuideLoad } from './guide.js';
import { fetchConfig } from './api.js';
import { initActivityPage } from './admin.js';
import { updateChannelsPage } from './channels.js';
import { updatePopularPage } from './popular.js';


let confirmCallback = null;
let currentPage = '/';
let activeModalCloseListener = null;
let isResizing = false;
// FINAL FIX: Flag to temporarily block config reloads after a setting is saved.
let blockConfigReload = false;

// NEW: Exported variable to track if processing is running
export let isProcessingRunning = false;

let notificationHideTimeout = null;

const hideNotification = () => {
    if (notificationHideTimeout) {
        clearTimeout(notificationHideTimeout);
        notificationHideTimeout = null;
    }
    UIElements.notificationModal?.classList.add('hidden');
};


/**
 * Shows a notification message at the top-right of the screen.
 * @param {string} message - The message to display.
 * @param {boolean} isError - If true, displays a red error notification.
 * @param {number} duration - How long the notification should be visible in ms.
 */
export const showNotification = (message, isError = false, duration = 3000) => {
    if (!UIElements.notificationBox || !UIElements.notificationMessage || !UIElements.notificationModal) {
        console.error('[UI_NOTIF] Notification elements not found in UIElements. Cannot display notification.');
        console.log('[UI_NOTIF] Message attempted: ', message);
        return;
    }

    UIElements.notificationMessage.textContent = message;

    UIElements.notificationBox.classList.remove('success-bg', 'error-bg');
    UIElements.notificationBox.classList.add(isError ? 'error-bg' : 'success-bg');

    UIElements.notificationModal.classList.remove('hidden');

    if (notificationHideTimeout) {
        clearTimeout(notificationHideTimeout);
    }

    notificationHideTimeout = setTimeout(() => {
        hideNotification();
    }, duration);

    if (!UIElements.notificationBox.dataset.dismissListener) {
        UIElements.notificationBox.addEventListener('click', hideNotification);
        UIElements.notificationBox.dataset.dismissListener = 'true';
    }

    UIElements.notificationBox.setAttribute('title', 'Click to dismiss');
};

/**
 * Displays a modal.
 * @param {HTMLElement} modal - The modal element to show.
 */
export const openModal = (modal) => {
    modal.classList.replace('hidden', 'flex');
    document.body.classList.add('modal-open');

    const handleBackdropClick = (e) => {
        if (e.target === modal) {
            const onMouseUp = (upEvent) => {
                if (upEvent.target === modal && !isResizing) {
                    if (modal === UIElements.videoModal) {
                        stopAndCleanupPlayer();
                    } else {
                        closeModal(modal);
                    }
                }
                document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mouseup', onMouseUp, { once: true });
        }
    };
    
    if (activeModalCloseListener && activeModalCloseListener.element) {
        activeModalCloseListener.element.removeEventListener('mousedown', activeModalCloseListener.handler);
    }

    modal.addEventListener('mousedown', handleBackdropClick);
    activeModalCloseListener = { element: modal, handler: handleBackdropClick };
};

/**
 * Hides a modal.
 * @param {HTMLElement} modal - The modal element to hide.
 */
export const closeModal = (modal) => {
    modal.classList.replace('flex', 'hidden');
    
    if (activeModalCloseListener && activeModalCloseListener.element === modal) {
        activeModalCloseListener.element.removeEventListener('mousedown', activeModalCloseListener.handler);
        activeModalCloseListener = null;
    }

    if (!document.querySelector('.fixed.inset-0.flex')) {
        document.body.classList.remove('modal-open');
    }
};


/**
 * Shows a confirmation dialog.
 * @param {string} title - The title of the confirmation dialog.
 * @param {string} message - The message body of the dialog.
 * @param {Function} callback - The function to execute if the user confirms.
 */
export const showConfirm = (title, message, callback) => {
    UIElements.confirmTitle.textContent = title;
    UIElements.confirmMessage.innerHTML = message;
    confirmCallback = callback;
    openModal(UIElements.confirmModal);
};

/**
 * NEW: Displays a site-wide broadcast message banner at the top of the page.
 * @param {string} message - The message to display.
 */
export const showBroadcastMessage = (message) => {
    const container = UIElements.broadcastBannerContainer;
    if (!container) return;

    const banner = document.createElement('div');
    banner.className = 'broadcast-banner';
    banner.textContent = message;

    container.appendChild(banner);

    // Use a short timeout to allow the element to be in the DOM before adding the class to trigger the transition
    setTimeout(() => {
        banner.classList.add('visible');
    }, 50);

    // Hide the banner after 10 seconds
    setTimeout(() => {
        banner.classList.remove('visible');
        // Remove the element from the DOM after the transition ends
        banner.addEventListener('transitionend', () => {
            if (banner.parentElement) {
                banner.remove();
            }
        });
    }, 10000);
};

export function handleConfirm() {
    if (confirmCallback) {
        confirmCallback();
    }
    closeModal(UIElements.confirmModal);
}

/**
 * Sets the loading state of a button, showing a spinner.
 * @param {HTMLElement} buttonEl - The button element.
 * @param {boolean} isLoading - True to show loading state, false to restore.
 * @param {string} originalContent - The original HTML content of the button.
 */
export const setButtonLoadingState = (buttonEl, isLoading, originalContent) => {
    if (!buttonEl) return;
    buttonEl.disabled = isLoading;
    const btnContentEl = buttonEl.querySelector('span');
    if (btnContentEl) {
        btnContentEl.innerHTML = isLoading ?
            `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Loading...</span>` :
            originalContent;
    }
};

/**
 * Makes a modal window resizable by dragging a handle.
 */
export const makeModalResizable = (handleEl, containerEl, minWidth, minHeight, settingKey) => {
    import('./api.js').then(({ saveUserSetting }) => {
        let resizeDebounceTimer;
        handleEl.addEventListener('mousedown', e => {
            e.preventDefault();
            isResizing = true; 
            const startX = e.clientX,
                startY = e.clientY;
            const startWidth = containerEl.offsetWidth;
            const startHeight = containerEl.offsetHeight;

            const doResize = (e) => {
                const newWidth = startWidth + e.clientX - startX;
                const newHeight = startHeight + e.clientY - startY;
                containerEl.style.width = `${Math.max(minWidth, newWidth)}px`;
                containerEl.style.height = `${Math.max(minHeight, newHeight)}px`;
            };

            const stopResize = () => {
                window.removeEventListener('mousemove', doResize);
                window.removeEventListener('mouseup', stopResize);
                document.body.style.cursor = '';
                
                isResizing = false;

                clearTimeout(resizeDebounceTimer);
                resizeDebounceTimer = setTimeout(() => {
                    saveUserSetting(settingKey, {
                        width: containerEl.offsetWidth,
                        height: containerEl.offsetHeight,
                    });
                }, 500);
            };

            document.body.style.cursor = 'se-resize';
            window.addEventListener('mousemove', doResize);
            window.addEventListener('mouseup', stopResize);
        }, false);
    });
};

/**
 * Makes a column resizable horizontally by dragging a handle.
 */
export const makeColumnResizable = (handleEl, targetEl, minWidth, settingKey, cssVarName) => {
    import('./api.js').then(({ saveUserSetting }) => {
        let resizeDebounceTimer;
        let startWidth;
        let startX;

        if (!targetEl) {
            console.error('makeColumnResizable: targetEl is null. Cannot apply resize logic.');
            return;
        }

        handleEl.addEventListener('mousedown', e => {
            e.preventDefault();
            isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(getComputedStyle(targetEl).getPropertyValue(cssVarName)) || minWidth;
            
            const doResize = (e) => {
                const newWidth = startWidth + (e.clientX - startX);
                const finalWidth = Math.max(minWidth, newWidth);
                targetEl.style.setProperty(cssVarName, `${finalWidth}px`);
            };

            const stopResize = () => {
                window.removeEventListener('mousemove', doResize);
                window.removeEventListener('mouseup', stopResize);
                document.body.style.cursor = '';
                isResizing = false;

                clearTimeout(resizeDebounceTimer);
                resizeDebounceTimer = setTimeout(() => {
                    const currentWidth = parseInt(getComputedStyle(targetEl).getPropertyValue(cssVarName));
                    saveUserSetting(settingKey, currentWidth);
                }, 500);
            };

            document.body.style.cursor = 'ew-resize';
            window.addEventListener('mousemove', doResize);
            window.addEventListener('mouseup', stopResize);
        }, false);
    });
};

/**
 * Opens the mobile navigation menu.
 */
export const openMobileMenu = () => {
    if (UIElements.mobileNavMenu) {
        UIElements.mobileNavMenu.classList.remove('hidden');
        UIElements.mobileNavMenu.classList.remove('-translate-x-full');
        UIElements.mobileNavMenu.classList.add('translate-x-0');
    }
    if (UIElements.mobileMenuOverlay) {
        UIElements.mobileMenuOverlay.classList.remove('hidden');
    }
    document.body.classList.add('overflow-hidden');
};

/**
 * Closes the mobile navigation menu.
 */
export const closeMobileMenu = () => {
    if (UIElements.mobileNavMenu) {
        UIElements.mobileNavMenu.classList.add('-translate-x-full');
        UIElements.mobileNavMenu.classList.remove('translate-x-0');
        UIElements.mobileNavMenu.addEventListener('transitionend', function handler() {
            UIElements.mobileNavMenu.classList.add('hidden');
            UIElements.mobileNavMenu.removeEventListener('transitionend', handler);
        });
    }
    if (UIElements.mobileMenuOverlay) {
        UIElements.mobileMenuOverlay.classList.add('hidden');
    }
    document.body.classList.remove('overflow-hidden');
};

// FINAL FIX: This function will be called whenever a setting is saved.
/**
 * Temporarily blocks the automatic config reload that happens on navigation.
 * This prevents the UI from overwriting a user's new setting with old data from the server.
 */
export const tempBlockConfigReload = () => {
    blockConfigReload = true;
    console.log(`%c[DEBUG] RACE_CONDITION_FIX: Config reload temporarily BLOCKED.`, 'color: #fca5a5; font-weight: bold;');
    setTimeout(() => {
        blockConfigReload = false;
        console.log(`%c[DEBUG] RACE_CONDITION_FIX: Config reload UNBLOCKED.`, 'color: #86efac; font-weight: bold;');
    }, 1000); // Block for 1 second, plenty of time for the save to complete.
};


/**
 * Handles client-side routing by showing/hiding pages.
 */
export const handleRouteChange = () => {
    const wasMultiView = currentPage.startsWith('/multiview');
    const wasPlayer = currentPage.startsWith('/player');
    const rawPath = window.location.pathname;
    const path = rawPath === '/' ? '/popular' : rawPath;

    if (rawPath === '/') {
        window.history.replaceState({}, document.title, window.location.origin + path);
    }
    
    if (wasMultiView && !path.startsWith('/multiview')) {
        if (isMultiViewActive()) {
            showConfirm(
                'Leave Multi-View?',
                'Leaving this page will stop all streams and clear your current layout. Are you sure?',
                () => {
                    cleanupMultiView();
                    proceedWithRouteChange(path);
                }
            );
            window.history.pushState({}, currentPage, window.location.origin + currentPage);
            return; 
        } else {
            cleanupMultiView();
        }
    }

    if (wasPlayer && !path.startsWith('/player')) {
        if (isDirectPlayerActive()) {
            showConfirm(
                'Leave Player?',
                'Leaving this page will stop the current stream. Are you sure?',
                () => {
                    cleanupDirectPlayer();
                    proceedWithRouteChange(path);
                }
            );
            window.history.pushState({}, currentPage, window.location.origin + currentPage);
            return;
        } else {
            cleanupDirectPlayer();
        }
    }

    proceedWithRouteChange(path);
};

/**
 * The core logic for switching pages after checks have passed.
 * MODIFIED: Now handles visibility of Settings and DVR tabs based on admin/user permissions.
 * @param {string} path - The new path to render.
 */
async function proceedWithRouteChange(path) {
    const isPopular = path.startsWith('/popular');
    const isGuide = path.startsWith('/tvguide');
    const isChannels = path.startsWith('/channels');
    const isMultiView = path.startsWith('/multiview');
    const isPlayer = path.startsWith('/player');
    const isDvr = path.startsWith('/dvr');
    const isActivity = path.startsWith('/activity');
    const isNotifications = path.startsWith('/notifications');
    const isSettings = path.startsWith('/settings');

    const isAdmin = appState.currentUser?.isAdmin;
    const permissions = getEffectivePermissions();
    const canAccess = {
        popular: permissions.popular,
        tvGuide: permissions.tvGuide,
        channels: permissions.channels,
        multiView: permissions.multiView,
        directPlayer: permissions.directPlayer,
        dvr: permissions.dvr,
        notifications: permissions.notifications,
    };

    const routeAllowed =
        (isPopular && canAccess.popular) ||
        (isGuide && canAccess.tvGuide) ||
        (isChannels && canAccess.channels) ||
        (isMultiView && canAccess.multiView) ||
        (isPlayer && canAccess.directPlayer) ||
        (isDvr && canAccess.dvr) ||
        (isNotifications && canAccess.notifications) ||
        (isActivity && isAdmin) ||
        (isSettings && isAdmin);

    if (!routeAllowed) {
        const fallbackOptions = [
            { path: '/popular', allowed: canAccess.popular },
            { path: '/channels', allowed: canAccess.channels },
            { path: '/tvguide', allowed: canAccess.tvGuide },
            { path: '/notifications', allowed: canAccess.notifications },
            { path: '/dvr', allowed: canAccess.dvr },
            { path: '/multiview', allowed: canAccess.multiView },
            { path: '/player', allowed: canAccess.directPlayer },
        ];
        const fallback = fallbackOptions.find((option) => option.allowed);
        if (fallback && fallback.path !== path) {
            showNotification('You do not have access to that page.', true, 3500);
            navigate(fallback.path);
        } else {
            showNotification('No accessible pages configured for your account. Contact an administrator.', true, 5000);
        }
        return;
    }

    closeMobileMenu();

    const showState = {
        popular: isPopular && canAccess.popular,
        tvGuide: isGuide && canAccess.tvGuide,
        channels: isChannels && canAccess.channels,
        multiView: isMultiView && canAccess.multiView,
        directPlayer: isPlayer && canAccess.directPlayer,
        dvr: isDvr && canAccess.dvr,
        notifications: isNotifications && canAccess.notifications,
        activity: isActivity && isAdmin,
        settings: isSettings && isAdmin,
    };

    const updateNavState = (tabEl, mobileEl, canSee, isActive) => {
        if (tabEl) {
            tabEl.classList.toggle('hidden', !canSee);
            tabEl.classList.toggle('active', canSee && isActive);
            if (!canSee) tabEl.classList.remove('active');
        }
        if (mobileEl) {
            mobileEl.classList.toggle('hidden', !canSee);
            mobileEl.classList.toggle('active', canSee && isActive);
            if (!canSee) mobileEl.classList.remove('active');
        }
    };

    updateNavState(UIElements.tabPopular, UIElements.mobileNavPopular, canAccess.popular, showState.popular);
    updateNavState(UIElements.tabGuide, UIElements.mobileNavGuide, canAccess.tvGuide, showState.tvGuide);
    updateNavState(UIElements.tabChannels, UIElements.mobileNavChannels, canAccess.channels, showState.channels);
    updateNavState(UIElements.tabMultiview, UIElements.mobileNavMultiview, canAccess.multiView, showState.multiView);
    updateNavState(UIElements.tabPlayer, UIElements.mobileNavPlayer, canAccess.directPlayer, showState.directPlayer);
    updateNavState(UIElements.tabDvr, UIElements.mobileNavDvr, canAccess.dvr, showState.dvr);
    updateNavState(UIElements.tabNotifications, UIElements.mobileNavNotifications, canAccess.notifications, showState.notifications);
    updateNavState(UIElements.tabActivity, UIElements.mobileNavActivity, isAdmin, showState.activity);
    updateNavState(UIElements.tabSettings, UIElements.mobileNavSettings, isAdmin, showState.settings);

    const togglePage = (pageEl, shouldShow) => {
        if (!pageEl) return;
        pageEl.classList.toggle('hidden', !shouldShow);
        pageEl.classList.toggle('flex', shouldShow);
    };

    togglePage(UIElements.pagePopular, showState.popular);
    togglePage(UIElements.pageGuide, showState.tvGuide);
    togglePage(UIElements.pageChannels, showState.channels);
    togglePage(UIElements.pageMultiview, showState.multiView);
    togglePage(UIElements.pagePlayer, showState.directPlayer);
    togglePage(UIElements.pageDvr, showState.dvr);
    togglePage(UIElements.pageActivity, showState.activity);
    togglePage(UIElements.pageNotifications, showState.notifications);
    togglePage(UIElements.pageSettings, showState.settings);
    
    const appContainer = UIElements.appContainer; 

    if (showState.tvGuide) {
        if (appContainer) appContainer.classList.remove('header-collapsed');
        if (UIElements.guideContainer) UIElements.guideContainer.scrollTop = 0;
        
        if (blockConfigReload) {
            console.log(`%c[DEBUG] RACE_CONDITION_FIX: Navigation to Guide tab occurred while config reload was blocked. Skipping reload.`, 'color: #fca5a5; font-weight: bold;');
            return;
        }

        if (!appState.isNavigating) {
            console.log('[UI] Refreshing TV Guide data on tab switch.');
            const config = await fetchConfig();
            if (config) {
                Object.assign(guideState.settings, config.settings || {});
                finalizeGuideLoad(true);
            }
        } else {
            console.log('[UI] Skipping soft refresh because a navigation action is in progress.');
        }

    } else {
        if (appContainer) appContainer.classList.remove('header-collapsed');
        
        if (showState.settings) {
            if (blockConfigReload) {
                console.log(`%c[DEBUG] RACE_CONDITION_FIX: Navigation to Settings tab occurred while config reload was blocked. Skipping reload.`, 'color: #fca5a5; font-weight: bold;');
            } else {
                updateUIFromSettings();
                if (appState.currentUser?.isAdmin) refreshUserList();
            }
        } else if (showState.notifications) {
            await loadAndScheduleNotifications();
        } else if (showState.popular) {
            updatePopularPage();
        } else if (showState.channels) {
            updateChannelsPage();
        } else if (showState.multiView) {
            initMultiView();
        } else if (showState.directPlayer) {
            initDirectPlayer();
        } else if (showState.dvr) {
            await initDvrPage();
        } else if (showState.activity) {
            await initActivityPage();
        }
    }
    currentPage = path;
}


/**
 * Pushes a new state to the browser history and triggers a route change.
 * @param {string} path - The new path to navigate to.
 */
export const navigate = (path) => {
    if (window.location.pathname !== path) {
        window.history.pushState({}, path, window.location.origin + path);
    }
    handleRouteChange();
};

/**
 * Switches between the tabs.
 * @param {string} activeTab - The tab to switch to.
 */
export const switchTab = (activeTab) => {
    let newPath;
    if (activeTab === 'popular') newPath = '/popular';
    else if (activeTab === 'guide') newPath = '/tvguide';
    else if (activeTab === 'channels') newPath = '/channels';
    else if (activeTab === 'multiview') newPath = '/multiview';
    else if (activeTab === 'player') newPath = '/player';
    else if (activeTab === 'dvr') newPath = '/dvr';
    else if (activeTab === 'activity') newPath = '/activity';
    else if (activeTab === 'notifications') newPath = '/notifications';
    else newPath = '/settings';
    navigate(newPath);
};

// Variable to track the last processing status to determine the action of the main button
// let isProcessingRunning = false; //commenting this out as it's exported above

// MODIFIED: Add export to this function
/**
 * NEW: Initiates a refresh of the TV Guide with new data.
 */
export async function refreshGuideAfterProcessing() {
    console.log('[UI_PROCESS] Finalizing process and refreshing guide...');
    // 1. Fetch the absolute latest config from the server
    const config = await fetchConfig();

    // 2. Update the global state
    if (config) {
        Object.assign(guideState.settings, config.settings || {});
    }

    // 3. Close the modal
    closeModal(UIElements.processingStatusModal);

    // 4. Force a refresh of the TV Guide page with the new data
    // This uses the content from the latest config fetch.
    if (config?.m3uContent) {
        await guideState.settings.timezoneOffset; // Ensure timezone is set before parsing
        await import('./guide.js').then(module => module.handleGuideLoad(config.m3uContent, config.epgContent));
        showNotification('Sources processed. TV Guide updated!', false, 4000);
        navigate('/tvguide');
    } else {
        showNotification('Sources processed, but no guide data found.', true, 4000);
    }

    // 5. Update settings page UI for source status indicators
    import('./settings.js').then(module => module.updateUIFromSettings());
}


/**
 * NEW: Shows and resets the processing status modal.
 */
export function showProcessingModal() {
    const modal = UIElements.processingStatusModal;
    const logContainer = UIElements.processingStatusLog;
    
    if (!modal || !logContainer || !UIElements.processingStatusBackgroundBtn || !UIElements.processingStatusCloseRefreshBtn || !UIElements.processingStatusRunningActions || !UIElements.processingStatusFinishedActions) {
        console.error('[UI_PROCESS] Missing processing modal elements in UIElements.');
        return;
    }

    // Reset the modal state
    logContainer.innerHTML = '';
    isProcessingRunning = true; // Assume running when modal is first opened
    
    // Hide all action buttons initially
    UIElements.processingStatusRunningActions.classList.remove('hidden');
    UIElements.processingStatusFinishedActions.classList.add('hidden');
    UIElements.processingStatusBackgroundBtn.classList.remove('hidden');
    
    // 1. Setup 'Continue in the background' button
    UIElements.processingStatusBackgroundBtn.onclick = () => {
        closeModal(modal);
        showNotification('Processing continued in the background.');
        // The main process-sources-btn listener is set up in settings.js to handle reopening
    };

    // 2. Setup 'Close and refresh' button
    UIElements.processingStatusCloseRefreshBtn.onclick = refreshGuideAfterProcessing;

    openModal(modal);
}

// MODIFIED: updateProcessingStatus function
/**
 * NEW: Updates the content of the processing status modal.
 * @param {string} message - The log message to display.
 * @param {string} type - The type of message ('info', 'success', 'error', 'final_success').
 */
export function updateProcessingStatus(message, type = 'info') {
    const logContainer = UIElements.processingStatusLog;
    const modal = UIElements.processingStatusModal; // Get a reference to the modal

    // --- New Button Logic ---
    const runningActionsEl = UIElements.processingStatusRunningActions;
    const finishedActionsEl = UIElements.processingStatusFinishedActions;
    // --- End New Button Logic ---

    if (!logContainer || !runningActionsEl || !finishedActionsEl || !modal) return;

    const logEntry = document.createElement('p');
    const timestamp = new Date().toLocaleTimeString();
    let typeIndicator = '';
    let colorClass = 'text-gray-400';
    let isFinished = false;

    switch (type) {
        case 'success':
            typeIndicator = '[SUCCESS]';
            colorClass = 'text-green-400';
            break;
        case 'final_success':
            typeIndicator = '[SUCCESS]';
            colorClass = 'text-green-400';
            isFinished = true;
            break;
        case 'error':
            typeIndicator = '[ERROR]';
            colorClass = 'text-red-400';
            isFinished = true;
            break;
        case 'info':
        default:
            typeIndicator = '[INFO]';
            break;
    }

    logEntry.innerHTML = `<span class="text-gray-500">${timestamp}</span> <span class="${colorClass} font-semibold">${typeIndicator}</span> <span class="${colorClass}">${message}</span>`;
    logContainer.appendChild(logEntry);

    // Auto-scroll to the bottom
    logContainer.scrollTop = logContainer.scrollHeight;

    // Update button visibility based on completion
    if (isFinished) {
        isProcessingRunning = false;
        runningActionsEl.classList.add('hidden');
        finishedActionsEl.classList.remove('hidden');

        // *** NEW LOGIC ***
        // If the process is finished and the modal is hidden (running in background),
        // dispatch a global event to notify the app.
        if (modal.classList.contains('hidden')) {
            console.log('[UI_PROCESS] Background process finished. Dispatching event.');
            document.dispatchEvent(new CustomEvent('background-process-finished'));
        }
        // *** END NEW LOGIC ***

    } else {
        runningActionsEl.classList.remove('hidden');
        finishedActionsEl.classList.add('hidden');
    }
}
