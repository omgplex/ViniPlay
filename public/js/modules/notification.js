/**
 * notification.js
 * Manages client-side logic for push notifications.
 * Handles subscribing/unsubscribing and interacts with the backend API.
 */

import { showNotification, showConfirm, navigate, openModal, closeModal } from './ui.js';
import { UIElements, guideState, appState } from './state.js';
import { handleSearchAndFilter, findProgramDetails, openProgramDetailsModal, scrollToProgramInGuide } from './guide.js';
import { getVapidKey, subscribeToPush, addProgramNotification, getProgramNotifications, deleteProgramNotification, unsubscribeFromPush } from './api.js';
import { playChannel } from './player.js';

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
    console.log('[NOTIFICATION] subscribeUserToPush called.');
    if (!appState.swRegistration) {
        console.warn('[NOTIFICATION] Service worker not registered yet. Cannot subscribe to push notifications.');
        showNotification('Service Worker not ready. Push notifications may not work.', false, 4000);
        return;
    }

    try {
        const subscription = await appState.swRegistration.pushManager.getSubscription();
        isSubscribed = !(subscription === null);

        if (isSubscribed) {
            console.log('[NOTIFICATION] User IS already subscribed to push notifications.');
        } else {
            console.log('[NOTIFICATION] User is NOT subscribed. Attempting to subscribe...');
            // Get VAPID key from server
            const vapidPublicKey = await getVapidKey();
            if (!vapidPublicKey) {
                console.error('[NOTIFICATION] Could not get VAPID public key from server. Cannot subscribe.');
                showNotification('Could not get notification key from server.', true);
                return;
            }
            const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
            console.log('[NOTIFICATION] Got VAPID public key. Attempting PushManager.subscribe...');

            // Subscribe the user
            const newSubscription = await appState.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });

            console.log('[NOTIFICATION] User subscribed successfully:', newSubscription);
            // Send subscription to the backend
            const success = await subscribeToPush(newSubscription);
            if (success) {
                isSubscribed = true;
                console.log('[NOTIFICATION] Push subscription successfully sent to backend.');
            } else {
                console.error('[NOTIFICATION] Failed to send push subscription to backend.');
                // If backend failed to save, it's safer to unsubscribe locally to avoid zombie subscriptions
                await newSubscription.unsubscribe();
                isSubscribed = false;
                showNotification('Failed to save push subscription on server.', true);
            }
        }
    } catch (error) {
        console.error('[NOTIFICATION] Failed to subscribe the user to push notifications: ', error);
        showNotification('Failed to set up notifications. Check browser permissions.', true);
    }
}

/**
 * Loads all active and past notifications from the backend.
 */
export const loadAndScheduleNotifications = async () => {
    console.log('[NOTIFICATION] loadAndScheduleNotifications called. Fetching from API...');
    try {
        const notifications = await getProgramNotifications();
        guideState.userNotifications = notifications;
        console.log(`[NOTIFICATION] Loaded ${notifications.active.length} active and ${notifications.past.length} past notifications from server.`);
        
        renderNotifications();
        // The guide needs to be re-rendered to show the visual indicators
        if (UIElements.pageGuide && !UIElements.pageGuide.classList.contains('hidden')) {
             console.log('[NOTIFICATION] Guide page is visible, re-rendering to update notification indicators.');
             handleSearchAndFilter(false);
        }
    } catch (error) {
        console.error('[NOTIFICATION] Error loading notifications:', error);
        showNotification('An error occurred loading notifications.', true);
    }
};

/**
 * Adds or removes a program notification by calling the backend.
 * @param {object} programDetails - Details of the program.
 */
export const addOrRemoveNotification = async (programDetails) => {
    console.log('[NOTIFICATION] addOrRemoveNotification called for program:', programDetails.programTitle);
    const existingNotification = findNotificationForProgram(programDetails, programDetails.channelId);
    
    if (existingNotification && existingNotification.status === 'active') {
        console.log('[NOTIFICATION] Existing active notification found. Prompting to remove.');
        showConfirm(
            'Remove Notification?',
            `Are you sure you want to remove the notification for "${programDetails.programTitle}"?`,
            async () => {
                console.log('[NOTIFICATION] User confirmed removal. Deleting notification ID:', existingNotification.id);
                const success = await deleteProgramNotification(existingNotification.id);
                if (success) {
                    guideState.userNotifications.active = guideState.userNotifications.active.filter(n => n.id !== existingNotification.id);
                    console.log('[NOTIFICATION] Notification removed from active list in state.');
                    renderNotifications(); // Re-render notification list
                    handleSearchAndFilter(false); // Re-render guide to update indicator
                }
            }
        );
    } else {
        if (!isSubscribed) {
             console.warn('[NOTIFICATION] User not subscribed to push. Cannot add notification.');
             showNotification('Please enable notifications for this site to receive alerts.', true);
             return;
        }

        const notificationLeadTime = guideState.settings.notificationLeadTime || 10;
        const programStartTime = new Date(programDetails.programStart);
        const scheduledTime = new Date(programStartTime.getTime() - notificationLeadTime * 60 * 1000);
        
        if (scheduledTime <= new Date()) {
             console.warn('[NOTIFICATION] Cannot set notification: Program starts too soon or has passed.');
             showNotification(`Cannot set notification for a program that is starting soon or has passed.`, true);
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
            notificationLeadTime: notificationLeadTime, // This isn't sent to backend's DB, only used client-side for calculation
            scheduledTime: scheduledTime.toISOString()
        };

        console.log('[NOTIFICATION] Attempting to add new notification via API:', newNotificationData);
        const addedNotification = await addProgramNotification(newNotificationData);
        if (addedNotification) {
            // Remove from past list if it exists (e.g., re-enabling an expired one), then add to active list
            guideState.userNotifications.past = guideState.userNotifications.past.filter(n => n.programId !== addedNotification.programId || n.channelId !== addedNotification.channelId);
            guideState.userNotifications.active = guideState.userNotifications.active.filter(n => n.id !== addedNotification.id); // Ensure no duplicates by ID
            guideState.userNotifications.active.push(addedNotification);

            console.log('[NOTIFICATION] Notification added to state. Re-rendering UI.');
            renderNotifications();
            handleSearchAndFilter(false); // Re-render guide to update indicator
            showNotification(`Notification set for "${addedNotification.programTitle}"!`);
        }
    }
};

/**
 * Checks if a given program has any notification (active or past).
 * Used for the visual indicator in the TV Guide.
 * @param {object} program - The program object.
 * @param {string} channelId - The ID of the channel the program belongs to.
 * @returns {object|null} The notification object if found, otherwise null.
 */
export const findNotificationForProgram = (program, channelId) => {
    const allNotifications = [
        ...(guideState.userNotifications.active || []),
        ...(guideState.userNotifications.past || [])
    ];
    // console.log('[NOTIFICATION] Checking for notification for program:', program.programId, 'on channel:', channelId);
    return allNotifications.find(n =>
        n.channelId === channelId &&
        n.programId === program.programId
    );
};

/**
 * Renders both upcoming and past notifications in the Notification Center.
 */
export const renderNotifications = () => {
    console.log('[NOTIFICATION] Rendering notifications...');
    const now = new Date();
    
    // Render Upcoming Notifications
    const notificationListEl = UIElements.notificationsList;
    if (notificationListEl) { // Added null check
        const upcomingNotifications = (guideState.userNotifications.active || [])
            .filter(n => new Date(n.scheduledTime).getTime() > now.getTime()) 
            .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

        if (UIElements.noNotificationsMessage) { // Added null check
            UIElements.noNotificationsMessage.classList.toggle('hidden', upcomingNotifications.length > 0);
        }
        
        notificationListEl.innerHTML = upcomingNotifications.map(notif => {
            const programStartTime = new Date(notif.programStart);
            const notificationTime = new Date(notif.scheduledTime);
            const formattedProgramTime = programStartTime.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const formattedNotificationTime = notificationTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return `
                <div class="flex items-center p-4 border-b border-gray-700/50 hover:bg-gray-800 transition-colors rounded-md" data-notification-id="${notif.id}">
                    <img src="${notif.channelLogo || 'https://placehold.co/48x48/1f2937/d1d5db?text=?;&font=Inter'}" onerror="this.onerror=null; this.src='https://placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-4 flex-shrink-0 rounded-md bg-gray-700">
                    <div class="flex-grow">
                        <p class="font-semibold text-white text-md">${notif.programTitle}</p>
                        <p class="text-gray-400 text-sm">${notif.channelName} • ${formattedProgramTime}</p>
                        <p class="text-blue-400 text-xs mt-1">Will be notified at ${formattedNotificationTime} (${guideState.settings.notificationLeadTime} mins before)</p>
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
        console.log(`[NOTIFICATION] Rendered ${upcomingNotifications.length} upcoming notifications.`);
    } else {
        console.warn('[NOTIFICATION] UIElements.notificationsList is null. Cannot render upcoming notifications.');
    }

    // Render Past Notifications
    const pastListEl = UIElements.pastNotificationsList;
    const pastHeaderEl = UIElements.pastNotificationsHeader;
    if (pastListEl && pastHeaderEl) { // Added null checks
        const pastNotifications = guideState.userNotifications.past || [];
        pastHeaderEl.classList.toggle('hidden', pastNotifications.length === 0);
        pastListEl.innerHTML = pastNotifications.map(notif => {
            const programStartTime = new Date(notif.programStart);
            const notifiedTime = new Date(notif.notifiedAt);
            const formattedProgramTime = programStartTime.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const formattedNotifiedTime = notifiedTime.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
            
            const statusClass = notif.status === 'sent' ? 'text-green-400' : 'text-yellow-500';
            const statusText = notif.status === 'sent' ? `Notified at ${formattedNotifiedTime}` : 'Notification expired (browser offline)';

            return `
                <div class="flex items-center p-4 border-b border-gray-700/50 hover:bg-gray-800 transition-colors rounded-md opacity-70" data-notification-id="${notif.id}">
                    <img src="${notif.channelLogo || 'https://placehold.co/48x48/1f2937/d1d5db?text=?;&font=Inter'}" onerror="this.onerror=null; this.src='https://placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-4 flex-shrink-0 rounded-md bg-gray-700">
                    <div class="flex-grow">
                        <p class="font-semibold text-white text-md">${notif.programTitle}</p>
                        <p class="text-gray-400 text-sm">${notif.channelName} • Started at ${formattedProgramTime}</p>
                        <p class="${statusClass} text-xs mt-1">${statusText}</p>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0 ml-4">
                         <button class="action-btn view-program-btn p-2 rounded-full hover:bg-gray-700" title="View Program Details" data-channel-id="${notif.channelId}" data-program-id="${notif.programId}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 hover:text-white" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" /></svg>
                        </button>
                        <button class="action-btn delete-notification-btn p-2 rounded-full hover:bg-red-900" title="Delete Notification" data-notification-id="${notif.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        console.log(`[NOTIFICATION] Rendered ${pastNotifications.length} past notifications.`);
    } else {
        console.warn('[NOTIFICATION] UIElements.pastNotificationsList or pastNotificationsHeader is null. Cannot render past notifications.');
    }

    setupNotificationListEventListeners();
};

/**
 * Sets up event listeners for the dynamically rendered notification lists.
 */
const setupNotificationListEventListeners = () => {
    const activeList = UIElements.notificationsList;
    const pastList = UIElements.pastNotificationsList;
    if (activeList) {
        activeList.removeEventListener('click', handleNotificationListClick); // Remove existing listener to prevent duplicates
        activeList.addEventListener('click', handleNotificationListClick);
    }
    if (pastList) {
        pastList.removeEventListener('click', handleNotificationListClick); // Remove existing listener to prevent duplicates
        pastList.addEventListener('click', handleNotificationListClick);
    }
};

/**
 * Handles clicks within the notification lists (both active and past).
 * @param {Event} e - The click event.
 */
const handleNotificationListClick = (e) => {
    const deleteBtn = e.target.closest('.delete-notification-btn');
    const viewBtn = e.target.closest('.view-program-btn');
    const notificationRow = e.target.closest('[data-notification-id]');

    if (!notificationRow) return;
    const notificationId = notificationRow.dataset.notificationId;

    const allNotifications = [...(guideState.userNotifications.active || []), ...(guideState.userNotifications.past || [])];
    const notification = allNotifications.find(n => n.id == notificationId);
    if (!notification) {
        console.warn('[NOTIFICATION] Clicked notification row but notification object not found in state:', notificationId);
        return;
    }

    if (deleteBtn) {
        console.log('[NOTIFICATION] Delete button clicked for notification ID:', notificationId);
        showConfirm(
            'Delete Notification?',
            `Are you sure you want to delete the notification record for "${notification.programTitle}"? This cannot be undone.`,
            async () => {
                const success = await deleteProgramNotification(notificationId);
                if (success) {
                    guideState.userNotifications.active = guideState.userNotifications.active.filter(n => n.id != notificationId);
                    guideState.userNotifications.past = guideState.userNotifications.past.filter(n => n.id != notificationId);
                    console.log('[NOTIFICATION] Notification successfully deleted and state updated.');
                    renderNotifications();
                    handleSearchAndFilter(false); // Update guide in case it was a past notification
                }
            }
        );
    } else if (viewBtn) {
        console.log('[NOTIFICATION] View program button clicked for notification ID:', notificationId);
        const { channelId, programStart, programId } = notification;
        navigateToProgramInGuide(channelId, programStart, programId);
    }
};


/**
 * Navigates to the TV Guide page and attempts to show the program's details.
 * @param {string} channelId
 * @param {string} programStart
 * @param {string} programId
 */
export const navigateToProgramInGuide = (channelId, programStart, programId) => {
    console.log(`[NOTIFICATION] Navigating to TV Guide for Channel ID: ${channelId}, Program ID: ${programId}`);
    navigate('/tvguide');

    setTimeout(() => {
        const programData = findProgramDetails(channelId, programId);
        if (programData) {
            console.log('[NOTIFICATION] Program data found, opening details modal.');
            openProgramDetailsModal(programData, channelId);
        } else {
            console.warn("[NOTIFICATION] Program details not found in current guide view. Falling back to scroll.");
            scrollToProgramInGuide(channelId, programStart, programId);
        }
    }, 150);
};

