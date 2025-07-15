/**
 * ui.js
 * * Contains functions for managing the user interface.
 * This includes navigation, modals, notifications, and other DOM manipulations.
 */

import { UIElements, appState, guideState } from './state.js';
import { refreshUserList, updateUIFromSettings } from './settings.js';

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
 * Handles client-side routing by showing/hiding pages based on the URL path.
 */
export const handleRouteChange = () => {
    const path = window.location.pathname;
    const isGuide = path.startsWith('/tvguide') || path === '/';

    // Toggle active state for desktop and mobile navigation buttons
    ['tabGuide', 'bottomNavGuide'].forEach(id => UIElements[id]?.classList.toggle('active', isGuide));
    ['tabSettings', 'bottomNavSettings'].forEach(id => UIElements[id]?.classList.toggle('active', !isGuide));

    // Show/hide the relevant page content
    UIElements.pageGuide.classList.toggle('hidden', !isGuide);
    UIElements.pageGuide.classList.toggle('flex', isGuide);
    UIElements.pageSettings.classList.toggle('hidden', isGuide);
    UIElements.pageSettings.classList.toggle('flex', !isGuide);
    
    // Manage header visibility based on the active tab
    if (isGuide) {
        // Ensure minimal header is expanded when navigating to guide (initially)
        if (UIElements.minimalGuideHeader) {
            UIElements.minimalGuideHeader.classList.add('expanded');
        }
        // Reset scroll position and header state when entering guide
        // This makes sure the header is fully visible when you come back to the guide tab
        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            appContainer.classList.remove('header-collapsed');
        }
        if (UIElements.guideContainer) {
            UIElements.guideContainer.scrollTop = 0; // Reset scroll position on guide
        }
        if (UIElements.pageGuide) {
            UIElements.pageGuide.style.paddingTop = `0px`; // Reset padding
        }

    } else {
        // If navigating to settings, ensure full header is visible and guide-specific minimal header is hidden/reset
        const appContainer = document.getElementById('app-container');
        if (appContainer) {
            appContainer.classList.remove('header-collapsed');
        }
        if (UIElements.minimalGuideHeader) {
            UIElements.minimalGuideHeader.classList.remove('expanded'); 
        }
        if (UIElements.pageGuide) {
            UIElements.pageGuide.style.paddingTop = `0px`; // Ensure padding is reset when leaving guide page
        }

        // If navigating to the settings page, refresh relevant data
        updateUIFromSettings();
        if (appState.currentUser?.isAdmin) {
            refreshUserList();
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
 * Switches between the 'Guide' and 'Settings' tabs.
 * @param {string} activeTab - The tab to switch to ('guide' or 'settings').
 */
export const switchTab = (activeTab) => {
    const newPath = activeTab === 'guide' ? '/tvguide' : '/settings';
    navigate(newPath);
};
