/**
 * notification.js
 * Manages client-side logic for push notifications.
 * Handles subscribing/unsubscribing and interacts with the backend API.
 */

import { showNotification, showConfirm, navigate, openModal, closeModal } from './ui.js';
import { UIElements, guideState, appState } from './state.js';
import { handleSearchAndFilter, scrollToChannel, openProgramDetails } from './guide.js'; // Import scrollToChannel & openProgramDetails
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
        return;
    }

    try {
        const subscription = await appState.swRegistration.pushManager.getSubscription();
        isSubscribed = !(subscription === null);

        if (isSubscribed) {
            console.log('[NOTIF] User is already subscribed to push notifications.');
        } else {
            console.log('[NOTIF] User is NOT subscribed. Attempting to subscribe...');
            const vapidPublicKey = await getVapidKey();
            if (!vapidPublicKey) {
                console.error('[NOTIF] Failed to get VAPID public key from server. Cannot subscribe.');
                showNotification('Could not set up notifications: missing server key.', true);
                return;
            }
            const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

            const newSubscription = await appState.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });

            console.log('[NOTIF] New push subscription created:', newSubscription);
            const success = await subscribeToPush(newSubscription);
            if (success) {
                isSubscribed = true;
                showNotification('Notifications enabled successfully!');
            } else {
                console.error('[NOTIF] Failed to send subscription to backend.');
                isSubscribed = false;
            }
        }
    } catch (error) {
        console.error('[NOTIF] Failed to subscribe the user to push notifications: ', error);
        if (Notification.permission === 'denied') {
            showNotification('Notifications are blocked by your browser settings. Please enable them manually.', true, 8000);
        } else {
            showNotification('Failed to set up notifications. Check browser console.', true);
        }
        isSubscribed = false;
    }
}


/**
 * Loads all active and past notifications from the backend to display in the UI.
 */
export const loadAndScheduleNotifications = async () => {
    console.log('[NOTIF] Loading all scheduled notifications from backend.');
    try {
        const notifications = await getProgramNotifications();
        guideState.userNotifications = notifications;
        console.log(`[NOTIF] Loaded ${notifications.length} scheduled notifications from server.`);
        
        renderNotifications();
        renderPastNotifications();
        await handleSearchAndFilter(false);
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
                    guideState.userNotifications = guideState.userNotifications.filter(n => n.id !== existingNotification.id);
                    renderNotifications();
                    renderPastNotifications();
                    await handleSearchAndFilter(false);
                    showNotification(`Notification for "${programDetails.programTitle}" removed.`);
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

        if (Notification.permission !== 'granted') {
            console.log('[NOTIF] Requesting notification permission.');
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                showNotification('Notification permission denied. Cannot set alert.', true);
                console.warn('[NOTIF] User denied notification permission. Cannot add notification.');
                return;
            } else {
                console.log('[NOTIF] Notification permission granted.');
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
            programId: programDetails.programId,
            notificationLeadTime: notificationLeadTime,
            scheduledTime: scheduledTime.toISOString()
        };

        const addedNotification = await addProgramNotification(newNotificationData);
        if (addedNotification) {
            guideState.userNotifications.push({ ...addedNotification, status: 'pending' });
            renderNotifications();
            await handleSearchAndFilter(false);
            showNotification(`Notification set for "${addedNotification.programTitle}"!`);
            console.log(`[NOTIF] Notification for "${addedNotification.programTitle}" added successfully.`);
        } else {
            console.error('[NOTIF] Failed to add notification via API.');
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
    return guideState.userNotifications.find(n =>
        n.channelId === channelId &&
        n.programId === program.programId &&
        n.status === 'pending'
    );
};

/**
 * Renders the list of upcoming notifications in the Notification Center.
 */
export const renderNotifications = () => {
    const notificationListEl = UIElements.notificationsList;
    if (!notificationListEl) return;

    const now = new Date();
    const upcomingNotifications = guideState.userNotifications
        .filter(n => new Date(n.scheduledTime).getTime() > now.getTime() && n.status === 'pending')
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
 * Renders the list of past/expired notifications.
 */
export const renderPastNotifications = () => {
    const pastNotificationsListEl = UIElements.pastNotificationsList;
    if (!pastNotificationsListEl) return;

    const now = new Date();
    const pastNotifications = guideState.userNotifications
        .filter(n => n.status === 'sent' || n.status === 'expired')
        .sort((a, b) => new Date(b.triggeredAt || b.notificationTime) - new Date(a.triggeredAt || a.notificationTime))
        .slice(0, 10);

    UIElements.noPastNotificationsMessage.classList.toggle('hidden', pastNotifications.length > 0);

    pastNotificationsListEl.innerHTML = pastNotifications.map(notif => {
        const programStartTime = new Date(notif.programStart);
        const notificationTriggerTime = new Date(notif.triggeredAt || notif.notificationTime);
        const formattedProgramTime = programStartTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const formattedTriggerTime = notificationTriggerTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let statusText = '';
        if (notif.status === 'sent') {
            statusText = `Notified at ${formattedTriggerTime}`;
        } else if (notif.status === 'expired') {
            statusText = `Expired at ${formattedTriggerTime}`;
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
    const handleClicks = (e) => {
        const deleteBtn = e.target.closest('.delete-notification-btn');
        const viewBtn = e.target.closest('.view-program-btn');

        if (deleteBtn) {
            const notificationId = deleteBtn.dataset.notificationId;
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
                            renderPastNotifications();
                            await handleSearchAndFilter(false);
                            showNotification(`Notification for "${notification.programTitle}" removed.`);
                        }
                    }
                );
            }
        } else if (viewBtn) {
            const channelId = viewBtn.dataset.channelId;
            const programStart = viewBtn.dataset.programStart;
            const programId = viewBtn.dataset.programId;
            navigateToProgramInGuide(channelId, programStart, programId);
        }
    };

    UIElements.notificationsList?.removeEventListener('click', handleClicks);
    UIElements.pastNotificationsList?.removeEventListener('click', handleClicks);
    
    UIElements.notificationsList?.addEventListener('click', handleClicks);
    UIElements.pastNotificationsList?.addEventListener('click', handleClicks);
};

/**
 * Navigates to the TV Guide, scrolls to the channel, and opens the program details.
 * @param {string} channelId - The full, dynamic channel ID from the notification.
 * @param {string} programStart - The ISO string of the program's start time.
 * @param {string} programId - The unique program ID (can be ignored as it's also dynamic).
 */
export const navigateToProgramInGuide = async (channelId, programStart, programId) => {
    console.log(`[NOTIF_NAV] Navigating to program. Original Channel ID: ${channelId}, Start: ${programStart}`);
    const stableChannelIdSuffix = channelId.includes('_') ? '_' + channelId.split('_').pop() : channelId;
    console.log(`[NOTIF_NAV] Using stable channel ID suffix for matching: "${stableChannelIdSuffix}"`);

    // 1. Navigate to the guide page
    navigate('/tvguide');
    await new Promise(resolve => setTimeout(resolve, 50));

    // 2. Adjust date if necessary
    const targetProgramStart = new Date(programStart);
    const currentGuideDate = new Date(guideState.currentDate);
    currentGuideDate.setHours(0, 0, 0, 0);

    if (targetProgramStart.toDateString() !== currentGuideDate.toDateString()) {
        console.log(`[NOTIF_NAV] Program is on a different day. Adjusting guide date.`);
        guideState.currentDate = targetProgramStart;
        await handleSearchAndFilter(true);
    }

    // 3. Scroll vertically and wait for the channel row to be rendered
    console.log('[NOTIF_DEBUG] Awaiting scrollToChannel to confirm vertical scroll and render.');
    const channelScrolledAndRendered = await scrollToChannel(stableChannelIdSuffix);
    
    if (!channelScrolledAndRendered) {
        showNotification("Could not find the channel in the guide. It might be filtered out.", false, 6000);
        return;
    }
    console.log('[NOTIF_DEBUG] scrollToChannel confirmed channel row is rendered.');

    // 4. Now that the row is rendered, find the program element directly with a FRESH query.
    // This is crucial to avoid stale DOM references after potential re-renders from virtualization.
    const currentChannelElement = UIElements.guideGrid.querySelector(`.channel-info[data-id$="${stableChannelIdSuffix}"]`);
    if (!currentChannelElement) {
        console.error(`[NOTIF_DEBUG] CRITICAL: Channel element with suffix ${stableChannelIdSuffix} not found after scrollToChannel resolved true.`);
        showNotification("An unexpected error occurred while locating the channel.", true);
        return;
    }
    const currentDynamicChannelId = currentChannelElement.dataset.id; // Get the full dynamic ID

    // Use a more specific selector now that we have the actual rendered channel's ID
    const programElement = UIElements.guideGrid.querySelector(
        `.programme-item[data-prog-start="${programStart}"][data-channel-id="${currentDynamicChannelId}"]`
    );

    if (!programElement) {
        console.warn(`[NOTIF_DEBUG] Channel row found, but program element not found for start time ${programStart} and channel ${currentDynamicChannelId}. It may be out of view horizontally or data is missing.`);
        showNotification("Could not find the specific program in the guide's timeline.", false, 6000);
        return;
    }

    console.log('[NOTIF_DEBUG] Program element found. Proceeding with centering and opening details.');

    // --- 5. Centering and Opening Logic ---
    const guideContainer = UIElements.guideContainer;
    
    // Use getBoundingClientRect for accurate positioning relative to the viewport
    const programRect = programElement.getBoundingClientRect();
    const containerRect = guideContainer.getBoundingClientRect();
    
    // Calculate the desired scroll position to center the element
    const desiredScrollTop = guideContainer.scrollTop + programRect.top - containerRect.top - (containerRect.height / 2) + (programRect.height / 2);
    const desiredScrollLeft = guideContainer.scrollLeft + programRect.left - containerRect.left - (containerRect.width / 2) + (programRect.width / 2);

    guideContainer.scrollTo({
        top: Math.max(0, desiredScrollTop),
        left: Math.max(0, desiredScrollLeft),
        behavior: 'smooth'
    });

    // Wait for the smooth scroll to have an effect before opening details
    setTimeout(() => {
        console.log('[NOTIF_DEBUG] Calling openProgramDetails directly.');
        // Pass the re-queried programElement to ensure it's a live DOM node
        openProgramDetails(programElement);
        
        programElement.classList.add('highlighted-search');
        setTimeout(() => { programElement.classList.remove('highlighted-search'); }, 2500);
    }, 300); // 300ms should be enough for the scroll animation to start
};
