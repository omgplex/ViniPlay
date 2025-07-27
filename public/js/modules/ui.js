/**
 * ui.js
 * * Contains functions for managing the user interface.
 * This includes navigation, modals, notifications, and other DOM manipulations.
 */

import { UIElements, appState, guideState } from './state.js';
import { refreshUserList, updateUIFromSettings } from './settings.js';
import { renderNotifications } from './notification.js';

let confirmCallback = null;

/**
 * Shows a notification message at the top-right of the screen.
 * @param {string} message - The message to display.
 * @param {boolean} isError - If true, displays a red error notification.
 * @param {number} duration - How long the notification should be visible in ms.
 */
export const showNotification = (message, isError = false, duration = 3000) => {
    UIElements.notificationMessage.textContent = message;
    UIElements.notificationModal.className = `fixed top-5 right-5 text-white py-2 px-4 rounded-lg shadow-lg z-[100] ${isError ? 'bg-red-500' : 'bg-green-500'}`;
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
};

/**
 * Hides a modal.
 * @param {HTMLElement} modal - The modal element to hide.
 */
export const closeModal = (modal) => {
    modal.classList.replace('flex', 'hidden');
    // Remove the body class only if no other modals are open
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
    UIElements.confirmMessage.textContent = message;
    confirmCallback = callback;
    openModal(UIElements.confirmModal);
};

// Handles the confirmation action.
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
    const btnContentEl = buttonEl.querySelector('span'); // Assumes content is in a span
    if (btnContentEl) {
        btnContentEl.innerHTML = isLoading ?
            `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Loading...</span>` :
            originalContent;
    }
};

/**
 * Makes a modal window resizable by dragging a handle.
 * @param {HTMLElement} handleEl - The handle element to drag.
 * @param {HTMLElement} containerEl - The container element to resize.
 * @param {number} minWidth - The minimum width of the container.
 * @param {number} minHeight - The minimum height of the container.
 * @param {string} settingKey - The key to save the dimensions under in user settings.
 */
export const makeModalResizable = (handleEl, containerEl, minWidth, minHeight, settingKey) => {
    // Lazy import to avoid circular dependencies
    import('./api.js').then(({ saveUserSetting }) => {
        let resizeDebounceTimer;
        handleEl.addEventListener('mousedown', e => {
            e.preventDefault();
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
 * @param {HTMLElement} handleEl - The handle element to drag.
 * @param {HTMLElement} targetEl - The element whose width is being controlled (e.g., the grid container).
 * @param {number} minWidth - The minimum width for the column.
 * @param {string} settingKey - The key to save the width under in user settings.
 * @param {string} cssVarName - The CSS custom property name to update (e.g., '--channel-col-width').
 */
export const makeColumnResizable = (handleEl, targetEl, minWidth, settingKey, cssVarName) => {
    // Lazy import to avoid circular dependencies
    import('./api.js').then(({ saveUserSetting }) => {
        let resizeDebounceTimer;
        let startWidth;
        let startX;

        // Ensure targetEl is not null
        if (!targetEl) {
            console.error('makeColumnResizable: targetEl is null. Cannot apply resize logic.');
            return;
        }

        handleEl.addEventListener('mousedown', e => {
            e.preventDefault();
            startX = e.clientX;
            // Get the current value of the CSS variable or default to minWidth if not set
            startWidth = parseInt(getComputedStyle(targetEl).getPropertyValue(cssVarName)) || minWidth;
            
            const doResize = (e) => {
                const newWidth = startWidth + (e.clientX - startX);
                const finalWidth = Math.max(minWidth, newWidth);
                targetEl.style.setProperty(cssVarName, `${finalWidth}px`);
            };

            const stopResize = () => {
                window.removeEventListener('mousemove', doResize);
                window.removeEventListener('mouseup', stopResize);
                document.body.style.cursor = ''; // Reset cursor

                clearTimeout(resizeDebounceTimer);
                resizeDebounceTimer = setTimeout(() => {
                    const currentWidth = parseInt(getComputedStyle(targetEl).getPropertyValue(cssVarName));
                    saveUserSetting(settingKey, currentWidth);
                }, 500); // Save after 500ms of no activity
            };

            document.body.style.cursor = 'ew-resize'; // East-West resize cursor for column
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
        // Add 'hidden' after transition to allow animation
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
 * Handles client-side routing by showing/hiding pages based on the URL path.
 */
export const handleRouteChange = () => {
    const path = window.location.pathname;
    const isGuide = path.startsWith('/tvguide') || path === '/';
    const isNotifications = path.startsWith('/notifications');
    const isSettings = path.startsWith('/settings');

    // Close mobile menu if it's open when navigating
    closeMobileMenu();

    // Toggle active state for desktop navigation buttons
    UIElements.tabGuide?.classList.toggle('active', isGuide);
    UIElements.tabNotifications?.classList.toggle('active', isNotifications);
    UIElements.tabSettings?.classList.toggle('active', isSettings);
    
    // Toggle active state for mobile navigation buttons
    UIElements.mobileNavGuide?.classList.toggle('active', isGuide);
    UIElements.mobileNavNotifications?.classList.toggle('active', isNotifications);
    UIElements.mobileNavSettings?.classList.toggle('active', isSettings);


    // Show/hide the relevant page content
    UIElements.pageGuide.classList.toggle('hidden', !isGuide);
    UIElements.pageGuide.classList.toggle('flex', isGuide);
    UIElements.pageNotifications.classList.toggle('hidden', !isNotifications);
    UIElements.pageNotifications.classList.toggle('flex', isNotifications);
    UIElements.pageSettings.classList.toggle('hidden', !isSettings);
    UIElements.pageSettings.classList.toggle('flex', isSettings);
    
    // Manage header visibility based on the active tab
    const appContainer = UIElements.appContainer; 

    // When navigating to guide, ensure headers are uncollapsed and set initial padding
    if (isGuide) {
        if (appContainer) {
            appContainer.classList.remove('header-collapsed');
        }
        // Hardcode padding-top to 1px as requested
        UIElements.pageGuide.style.paddingTop = `1px`;

        // Reset guide scroll to top when coming back to it
        if (UIElements.guideContainer) {
            UIElements.guideContainer.scrollTop = 0;
        }
    } else {
        // If navigating to other pages, ensure main header is fully visible (by removing collapsed class)
        if (appContainer) {
            appContainer.classList.remove('header-collapsed');
        }
        // Ensure page-guide padding is reset when leaving guide page
        UIElements.pageGuide.style.paddingTop = `0px`; 

        // If navigating to the settings page, refresh relevant data
        if (isSettings) {
            updateUIFromSettings();
            if (appState.currentUser?.isAdmin) {
                refreshUserList();
            }
        } else if (isNotifications) {
            // NEW: Render notifications when navigating to the notifications page
            renderNotifications(); 
        }
    }
};

/**
 * Pushes a new state to the browser history and triggers a route change.
 * @param {string} path - The new path to navigate to (e.g., '/settings').
 */
export const navigate = (path) => {
    // Only push state if the path is different
    if (window.location.pathname !== path) {
        window.history.pushState({}, path, window.location.origin + path);
    }
    handleRouteChange();
};

/**
 * Switches between the 'Guide', 'Notifications' and 'Settings' tabs.
 * @param {string} activeTab - The tab to switch to ('guide', 'notifications', or 'settings').
 */
export const switchTab = (activeTab) => {
    let newPath;
    if (activeTab === 'guide') {
        newPath = '/tvguide';
    } else if (activeTab === 'notifications') {
        newPath = '/notifications';
    } else {
        newPath = '/settings';
    }
    navigate(newPath);
};
