/**
 * notification.js
 * Manages client-side logic for push notifications.
 * Handles subscribing/unsubscribing and interacts with the backend API.
 */

import { showNotification, showConfirm, navigate, openModal, closeModal } from './ui.js';
import { UIElements, guideState, appState } from './state.js';
import { handleSearchAndFilter, scrollToChannel } from './guide.js'; // Import scrollToChannel
import { getVapidKey, subscribeToPush, addProgramNotification, getProgramNotifications, deleteProgramNotification, unsubscribeFromPush } from './api.js';

let isSubscribed = false;

/**
 * Converts a URL-safe base64 string to a Uint8Array.
 * This is needed for the VAPID public key.
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * Subscribes the user to push notifications.
 */
export async function subscribeUserToPush() {
    console.log('[NOTIF] Initiating push subscription process.');
    if (!appState.swRegistration) {
        console.warn('[NOTIF] Service worker not registered yet. Cannot subscribe.');
        // showNotification('Service worker not ready for notifications.', false, 4000);
        return;
    }

    try {
        const subscription = await appState.swRegistration.pushManager.getSubscription();
        isSubscribed = !(subscription === null);

        if (isSubscribed) {
            console.log('[NOTIF] User is already subscribed to push notifications.');
        } else {
            console.log('[NOTIF] User is NOT subscribed. Attempting to subscribe...');
            // Get VAPID key from server
            const vapidPublicKey = await getVapidKey();
            if (!vapidPublicKey) {
                console.error('[NOTIF] Failed to get VAPID public key from server. Cannot subscribe.');
                showNotification('Could not set up notifications: missing server key.', true);
                return;
            }
            const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey); // Corrected function name

            // Subscribe the user
            const newSubscription = await appState.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });

            console.log('[NOTIF] New push subscription created:', newSubscription);
            // Send subscription to the backend
            const success = await subscribeToPush(newSubscription);
            if (success) {
                isSubscribed = true;
                showNotification('Notifications enabled successfully!');
            } else {
                console.error('[NOTIF] Failed to send subscription to backend.');
                // showNotification('Failed to enable notifications.', true); // api.js already shows notification
                isSubscribed = false; // Ensure state is correct if backend fails
            }
        }
    } catch (error) {
        console.error('[NOTIF] Failed to subscribe the user to push notifications: ', error);
        if (Notification.permission === 'denied') {
            showNotification('Notifications are blocked by your browser settings. Please enable them manually.', true, 8000);
        } else {
            showNotification('Failed to set up notifications. Check browser console.', true);
        }
        isSubscribed = false; // Ensure state is correct on client-side errors
    }
}


/**
 * Loads all active and past notifications from the backend to display in the UI.
 */
export const loadAndScheduleNotifications = async () => {
    console.log('[NOTIF] Loading all scheduled notifications from backend.');
    try {
        const notifications = await getProgramNotifications();
        // Store all notifications, client-side will filter for display
        guideState.userNotifications = notifications;
        console.log(`[NOTIF] Loaded ${notifications.length} scheduled notifications from server.`);
        
        renderNotifications(); // Render upcoming notifications
        renderPastNotifications(); // Render past notifications
        handleSearchAndFilter(false); // Update guide with indicators (e.g., yellow border)
    } catch (error) {
        console.error('[NOTIF] Error loading notifications:', error);
        showNotification('An error occurred loading notifications.', true);
    }
};

/**
 * Adds or removes a program notification by calling the backend.
 * @param {object} programDetails - Details of the program.
 */
export const addOrRemoveNotification = async (programDetails) => {
    console.log(`[NOTIF] Attempting to add/remove notification for: ${programDetails.programTitle}`);
    const existingNotification = findNotificationForProgram(programDetails, programDetails.channelId);
    
    if (existingNotification) {
        console.log('[NOTIF] Existing notification found. Prompting to remove.');
        showConfirm(
            'Remove Notification?',
            `Are you sure you want to remove the notification for "${programDetails.programTitle}"?`,
            async () => {
                const success = await deleteProgramNotification(existingNotification.id);
                if (success) {
                    // Remove from local state
                    guideState.userNotifications = guideState.userNotifications.filter(n => n.id !== existingNotification.id);
                    renderNotifications();
                    renderPastNotifications(); // Re-render past notifications too
                    await handleSearchAndFilter(false); // Update guide with indicators
                    showNotification(`Notification for "${programDetails.programTitle}" removed.`); // Manual notification after success
                } else {
                    console.error('[NOTIF] Failed to delete notification on backend.');
                }
            }
        );
    } else {
        console.log('[NOTIF] No existing notification found. Attempting to add new one.');
        if (Notification.permission === 'denied') {
             showNotification('Notifications are blocked by your browser. Please enable them in site settings to receive alerts.', true, 8000);
             console.warn('[NOTIF] Notification permission denied. Cannot add notification.');
             return;
        }

        // Request permission if not already granted
        if (Notification.permission !== 'granted') {
            console.log('[NOTIF] Requesting notification permission.');
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                showNotification('Notification permission denied. Cannot set alert.', true);
                console.warn('[NOTIF] User denied notification permission. Cannot add notification.');
                return;
            } else {
                console.log('[NOTIF] Notification permission granted.');
                // If permission was just granted, try to subscribe immediately
                await subscribeUserToPush();
                if (!isSubscribed) {
                    showNotification('Failed to subscribe to push notifications. Cannot set alert.', true);
                    console.error('[NOTIF] Failed to subscribe to push after permission granted. Cannot add notification.');
                    return;
                }
            }
        }
        
        const notificationLeadTime = guideState.settings.notificationLeadTime || 10;
        const programStartTime = new Date(programDetails.programStart);
        const scheduledTime = new Date(programStartTime.getTime() - notificationLeadTime * 60 * 1000);
        
        if (scheduledTime <= new Date()) {
             showNotification(`Cannot set notification for a program that has already started or passed.`, true);
             console.warn('[NOTIF] Attempted to set notification for a program already in progress or past.');
             return;
        }

        const newNotificationData = {
            channelId: programDetails.channelId,
            channelName: programDetails.channelName,
            channelLogo: programDetails.channelLogo,
            programTitle: programDetails.programTitle,
            programStart: programDetails.programStart,
            programStop: programDetails.programStop,
            programDesc: programDetails.programDesc,
            programId: programDetails.programId, // Unique ID for program within channel
            notificationLeadTime: notificationLeadTime, // Send lead time to backend for logging/future use
            scheduledTime: scheduledTime.toISOString()
        };

        const addedNotification = await addProgramNotification(newNotificationData);
        if (addedNotification) {
            // Add to local state (it will initially be 'pending')
            guideState.userNotifications.push({ ...addedNotification, status: 'pending' });
            renderNotifications();
            await handleSearchAndFilter(false); // Update guide with indicators
            showNotification(`Notification set for "${addedNotification.programTitle}"!`);
            console.log(`[NOTIF] Notification for "${addedNotification.programTitle}" added successfully.`);
        } else {
            console.error('[NOTIF] Failed to add notification via API.');
            // api.js already shows notification
        }
    }
};

/**
 * Checks if a given program has an active notification scheduled.
 * @param {object} program - The program object.
 * @param {string} channelId - The ID of the channel the program belongs to.
 * @returns {object|null} The notification object if found, otherwise null.
 */
export const findNotificationForProgram = (program, channelId) => {
    // A program is considered to have an active notification if it's 'pending'
    return guideState.userNotifications.find(n =>
        n.channelId === channelId &&
        n.programId === program.programId && // Use the unique programId for matching
        n.status === 'pending' // Only consider 'pending' as an active notification for setting/unsetting
    );
};

/**
 * Renders the list of upcoming notifications in the Notification Center.
 */
export const renderNotifications = () => {
    console.log('[NOTIF_UI] Rendering upcoming notifications.');
    const notificationListEl = UIElements.notificationsList;
    if (!notificationListEl) {
        console.warn('[NOTIF_UI] Notifications list element not found.');
        return;
    }

    const now = new Date();
    const upcomingNotifications = guideState.userNotifications
        .filter(n => new Date(n.scheduledTime).getTime() > now.getTime() && n.status === 'pending') // Only pending and future
        .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

    UIElements.noNotificationsMessage.classList.toggle('hidden', upcomingNotifications.length > 0);

    notificationListEl.innerHTML = upcomingNotifications.map(notif => {
        const programStartTime = new Date(notif.programStart);
        const notificationTime = new Date(notif.scheduledTime);
        const formattedProgramTime = programStartTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const formattedNotificationTime = notificationTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        return `
            <div class="flex items-center p-4 border-b border-gray-700/50 hover:bg-gray-800 transition-colors rounded-md" data-notification-id="${notif.id}" data-status="${notif.status}">
                <img src="${notif.channelLogo || 'https://placehold.co/48x48/1f2937/d1d5db?text=?;&font=Inter'}" onerror="this.onerror=null; this.src='https://placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-4 flex-shrink-0 rounded-md bg-gray-700">
                <div class="flex-grow">
                    <p class="font-semibold text-white text-md">${notif.programTitle}</p>
                    <p class="text-gray-400 text-sm">${notif.channelName} • ${formattedProgramTime}</p>
                    <p class="text-blue-400 text-xs mt-1">Will be notified at ${formattedNotificationTime} (${notif.notificationLeadTime} mins before)</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0 ml-4">
                    <button class="action-btn view-program-btn p-2 rounded-full hover:bg-gray-700" title="View in TV Guide" data-channel-id="${notif.channelId}" data-program-start="${notif.programStart}" data-program-id="${notif.programId}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.555-4.555A.5.5 0 0120 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h10l-4 4"></path><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v7a1 1 0 001 1h7"></path></svg>
                    </button>
                    <button class="action-btn delete-notification-btn p-2 rounded-full hover:bg-red-900" title="Delete Notification" data-notification-id="${notif.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    setupNotificationListEventListeners();
};

/**
 * NEW: Renders the list of past/expired notifications.
 */
export const renderPastNotifications = () => {
    console.log('[NOTIF_UI] Rendering past notifications.');
    const pastNotificationsListEl = UIElements.pastNotificationsList;
    if (!pastNotificationsListEl) {
        console.warn('[NOTIF_UI] Past notifications list element not found.');
        return;
    }

    const now = new Date();
    // Filter for 'sent' or 'expired' notifications, sort by triggeredAt descending, and take the latest 10
    const pastNotifications = guideState.userNotifications
        .filter(n => n.status === 'sent' || n.status === 'expired')
        .sort((a, b) => new Date(b.triggeredAt || b.notificationTime) - new Date(a.triggeredAt || a.notificationTime))
        .slice(0, 10); // Limit to 10 past notifications

    UIElements.noPastNotificationsMessage.classList.toggle('hidden', pastNotifications.length > 0);

    pastNotificationsListEl.innerHTML = pastNotifications.map(notif => {
        const programStartTime = new Date(notif.programStart);
        const notificationTriggerTime = new Date(notif.triggeredAt || notif.notificationTime); // Use triggeredAt if available
        const formattedProgramTime = programStartTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const formattedTriggerTime = notificationTriggerTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let statusBadgeClass = '';
        let statusText = '';
        if (notif.status === 'sent') {
            statusBadgeClass = 'bg-green-600';
            statusText = `Notified at ${formattedTriggerTime}`;
        } else if (notif.status === 'expired') {
            statusBadgeClass = 'bg-gray-600';
            statusText = `Expired at ${formattedTriggerTime}`; // Changed to just "Expired" if not triggered
        }

        return `
            <div class="flex items-center p-4 border-b border-gray-700/50 hover:bg-gray-800 transition-colors rounded-md opacity-70" data-notification-id="${notif.id}" data-status="${notif.status}">
                <img src="${notif.channelLogo || 'https://placehold.co/48x48/1f2937/d1d5db?text=?;&font=Inter'}" onerror="this.onerror=null; this.src='https://placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-4 flex-shrink-0 rounded-md bg-gray-700">
                <div class="flex-grow">
                    <p class="font-semibold text-white text-md">${notif.programTitle}</p>
                    <p class="text-gray-400 text-sm">${notif.channelName} • ${formattedProgramTime}</p>
                    <p class="text-xs mt-1 text-gray-500">${statusText}</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0 ml-4">
                    <button class="action-btn view-program-btn p-2 rounded-full hover:bg-gray-700" title="View in TV Guide" data-channel-id="${notif.channelId}" data-program-start="${notif.programStart}" data-program-id="${notif.programId}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.555-4.555A.5.5 0 0120 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h10l-4 4"></path><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v7a1 1 0 001 1h7"></path></svg>
                    </button>
                    <button class="action-btn delete-notification-btn p-2 rounded-full hover:bg-red-900" title="Delete Notification" data-notification-id="${notif.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
};


/**
 * Sets up event listeners for the dynamically rendered notification lists.
 */
const setupNotificationListEventListeners = () => {
    console.log('[NOTIF_UI] Setting up notification list event listeners.');
    // Remove previous listeners to prevent duplicates
    UIElements.notificationsList?.removeEventListener('click', handleNotificationListClick);
    UIElements.pastNotificationsList?.removeEventListener('click', handleNotificationListClick);

    // Add new listeners
    UIElements.notificationsList?.addEventListener('click', handleNotificationListClick);
    UIElements.pastNotificationsList?.addEventListener('click', handleNotificationListClick);
};

/**
 * Handles clicks within the notification lists.
 * @param {Event} e - The click event.
 */
const handleNotificationListClick = (e) => {
    const deleteBtn = e.target.closest('.delete-notification-btn');
    const viewBtn = e.target.closest('.view-program-btn');

    if (deleteBtn) {
        const notificationId = deleteBtn.dataset.notificationId;
        console.log(`[NOTIF_UI_EVENT] Delete notification button clicked for ID: ${notificationId}.`);
        const notification = guideState.userNotifications.find(n => n.id == notificationId);
        if (notification) {
            showConfirm(
                'Delete Notification?',
                `Are you sure you want to delete the notification for "${notification.programTitle}"?`,
                async () => {
                    const success = await deleteProgramNotification(notificationId);
                    if (success) {
                        guideState.userNotifications = guideState.userNotifications.filter(n => n.id != notificationId);
                        renderNotifications();
                        renderPastNotifications(); // Re-render past notifications too
                        await handleSearchAndFilter(false); // Update guide with indicators
                        showNotification(`Notification for "${notification.programTitle}" removed.`);
                    }
                }
            );
        } else {
            console.warn(`[NOTIF_UI_EVENT] Notification with ID ${notificationId} not found in local state.`);
        }
    } else if (viewBtn) {
        const channelId = viewBtn.dataset.channelId;
        const programStart = viewBtn.dataset.programStart;
        const programId = viewBtn.dataset.programId;
        console.log(`[NOTIF_UI_EVENT] View program button clicked. Channel ID: ${channelId}, Program Start: ${programStart}, Program ID: ${programId}.`);
        navigateToProgramInGuide(channelId, programStart, programId);
    }
};


/**
 * Navigates to the TV Guide page and attempts to scroll to and open the program popup.
 * This function is enhanced to handle cases where the program is on a different day
 * or not currently in the DOM due to virtualization.
 * @param {string} channelId - The ID of the channel.
 * @param {string} programStart - The ISO string of the program's start time.
 * @param {string} programId - The unique ID of the program (channelId-programStart-programStop).
 */
export const navigateToProgramInGuide = async (channelId, programStart, programId) => {
    console.log(`[NOTIF_NAV] Navigating to program in guide: Channel ID ${channelId}, Program Start ${programStart}, Program ID ${programId}`);
    // First, navigate to the TV Guide page
    navigate('/tvguide');

    // MODIFIED: This function is now async and uses await to solve the race condition.
    // Introduce a slight delay to ensure the UI route change has initiated
    await new Promise(resolve => setTimeout(resolve, 150));

    const targetProgramStart = new Date(programStart);
    const currentGuideDate = new Date(guideState.currentDate);
    currentGuideDate.setHours(0, 0, 0, 0); // Normalize to midnight for comparison

    // Step 1: Check and adjust guide date if necessary
    if (targetProgramStart.toDateString() !== currentGuideDate.toDateString()) {
        console.log(`[NOTIF_NAV] Program is on a different day. Adjusting guide date to: ${targetProgramStart.toDateString()}`);
        guideState.currentDate = targetProgramStart; // Set the guide date to the program's date
        
        // MODIFIED: Await the handleSearchAndFilter promise. This is the core of the fix.
        // This pauses execution until the guide has finished re-rendering for the new date.
        await handleSearchAndFilter(true);
    }

    // Step 2: Ensure the target channel is vertically visible using scrollToChannel
    console.log(`[NOTIF_NAV] Attempting to scroll channel ${channelId} into view.`);
    const channelScrolled = await scrollToChannel(channelId);

    if (!channelScrolled) {
        console.warn(`[NOTIF_NAV] Channel element for ID ${channelId} could not be made visible.`);
        showNotification("Could not find the channel in the guide. It might be filtered out or took too long to render.", false, 6000);
        return; // Stop if channel isn't found
    }

    // Step 3: Now that the channel is visible, poll for the program element
    // This part of the logic is more reliable now because we've waited for the guide to render.
    const maxProgramAttempts = 30;
    let programAttempts = 0;
    const findProgramInterval = setInterval(() => {
        let programElement;
        if (programId) {
            programElement = UIElements.guideGrid.querySelector(`.programme-item[data-prog-id="${programId}"][data-channel-id="${channelId}"]`);
        }
        if (!programElement) {
            programElement = UIElements.guideGrid.querySelector(`.programme-item[data-prog-start="${programStart}"][data-channel-id="${channelId}"]`);
        }

        if (programElement) {
            console.log(`[NOTIF_NAV] Program element found on attempt ${programAttempts + 1}. Scrolling horizontally and clicking.`);
            clearInterval(findProgramInterval);

            const scrollLeft = programElement.offsetLeft - (UIElements.guideContainer.clientWidth / 4);
            UIElements.guideContainer.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });

            programElement.click(); 
            
            programElement.classList.add('highlighted-search');
            setTimeout(() => { programElement.classList.remove('highlighted-search'); }, 2500);

        } else {
            programAttempts++;
            if (programAttempts >= maxProgramAttempts) {
                clearInterval(findProgramInterval);
                console.warn(`[NOTIF_NAV] Max program attempts reached. Could not find program element in current guide view. (ID: ${programId}).`);
                showNotification("Could not find program in guide to open details. It might be outside the current 48-hour guide window.", false, 6000);
            }
        }
    }, 100);
};
