/**
 * ui.js
 * * Contains functions for managing the user interface.
 * This includes navigation, modals, notifications, and other DOM manipulations.
 */

import { UIElements, appState, guideState } from './state.js';
import { refreshUserList, updateUIFromSettings } from './settings.js';
import { loadAndScheduleNotifications, renderNotifications } from './notification.js';
import { initMultiView, isMultiViewActive, cleanupMultiView } from './multiview.js';
import { initDvrPage } from './dvr.js';
import { stopAndCleanupPlayer } from './player.js';
import { initDirectPlayer, isDirectPlayerActive, cleanupDirectPlayer } from './player_direct.js';
import { finalizeGuideLoad } from './guide.js';
import { fetchConfig } from './api.js';


let confirmCallback = null;
let currentPage = '/';
let activeModalCloseListener = null;
let isResizing = false;
let beforeUnloadListener = null; // NEW: To hold the beforeunload listener


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

    setTimeout(() => { UIElements.notificationModal.classList.add('hidden'); }, duration);
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


/**
 * Handles client-side routing by showing/hiding pages.
 */
export const handleRouteChange = () => {
    const wasMultiView = currentPage.startsWith('/multiview');
    const wasPlayer = currentPage.startsWith('/player');
    const path = window.location.pathname;
    
    // NEW: Remove the beforeunload warning if we are navigating within the app
    if (beforeUnloadListener) {
        window.removeEventListener('beforeunload', beforeUnloadListener);
        beforeUnloadListener = null;
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
 * @param {string} path - The new path to render.
 */
async function proceedWithRouteChange(path) {
    const isGuide = path.startsWith('/tvguide') || path === '/';
    const isMultiView = path.startsWith('/multiview');
    const isPlayer = path.startsWith('/player');
    const isDvr = path.startsWith('/dvr');
    const isNotifications = path.startsWith('/notifications');
    const isSettings = path.startsWith('/settings');

    closeMobileMenu();

    const hasDvrAccess = appState.currentUser?.isAdmin || appState.currentUser?.canUseDvr;

    UIElements.tabGuide?.classList.toggle('active', isGuide);
    UIElements.tabMultiview?.classList.toggle('active', isMultiView);
    UIElements.tabPlayer?.classList.toggle('active', isPlayer);
    if (UIElements.tabDvr) {
        UIElements.tabDvr.classList.toggle('active', isDvr && hasDvrAccess);
        UIElements.tabDvr.classList.toggle('hidden', !hasDvrAccess);
    }
    UIElements.tabNotifications?.classList.toggle('active', isNotifications);
    UIElements.tabSettings?.classList.toggle('active', isSettings);
    
    UIElements.mobileNavGuide?.classList.toggle('active', isGuide);
    UIElements.mobileNavMultiview?.classList.toggle('active', isMultiView);
    UIElements.mobileNavPlayer?.classList.toggle('active', isPlayer);
    if (UIElements.mobileNavDvr) {
        UIElements.mobileNavDvr.classList.toggle('active', isDvr && hasDvrAccess);
        UIElements.mobileNavDvr.classList.toggle('hidden', !hasDvrAccess);
    }
    UIElements.mobileNavNotifications?.classList.toggle('active', isNotifications);
    UIElements.mobileNavSettings?.classList.toggle('active', isSettings);

    UIElements.pageGuide.classList.toggle('hidden', !isGuide);
    UIElements.pageGuide.classList.toggle('flex', isGuide);
    UIElements.pageMultiview.classList.toggle('hidden', !isMultiView);
    UIElements.pageMultiview.classList.toggle('flex', isMultiView);
    UIElements.pagePlayer.classList.toggle('hidden', !isPlayer);
    UIElements.pagePlayer.classList.toggle('flex', isPlayer);
    UIElements.pageDvr.classList.toggle('hidden', !isDvr || !hasDvrAccess); 
    UIElements.pageDvr.classList.toggle('flex', isDvr && hasDvrAccess);
    UIElements.pageNotifications.classList.toggle('hidden', !isNotifications);
    UIElements.pageNotifications.classList.toggle('flex', isNotifications);
    UIElements.pageSettings.classList.toggle('hidden', !isSettings);
    UIElements.pageSettings.classList.toggle('flex', isSettings);
    
    const appContainer = UIElements.appContainer; 

    if (isGuide) {
        if (appContainer) appContainer.classList.remove('header-collapsed');
        if (UIElements.guideContainer) UIElements.guideContainer.scrollTop = 0;
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

        if (isSettings) {
            updateUIFromSettings();
            if (appState.currentUser?.isAdmin) refreshUserList();
        } else if (isNotifications) {
            console.log('[UI] Refreshing Notifications data...');
            await loadAndScheduleNotifications();
        } else if (isMultiView) {
            initMultiView();
            // NEW: Add beforeunload listener when entering multiview
            beforeUnloadListener = (e) => {
                if (isMultiViewActive()) {
                    e.preventDefault();
                    e.returnValue = 'Leaving this page will stop all active streams. Are you sure?';
                }
            };
            window.addEventListener('beforeunload', beforeUnloadListener);
        } else if (isPlayer) {
            initDirectPlayer();
        } else if (isDvr && hasDvrAccess) {
            console.log('[UI] Refreshing DVR data...');
            await initDvrPage();
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
    if (activeTab === 'guide') newPath = '/tvguide';
    else if (activeTab === 'multiview') newPath = '/multiview';
    else if (activeTab === 'player') newPath = '/player';
    else if (activeTab === 'dvr') newPath = '/dvr';
    else if (activeTab === 'notifications') newPath = '/notifications';
    else newPath = '/settings';
    navigate(newPath);
};
