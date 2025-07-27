/**
 * notification.js
 * Manages client-side logic for push notifications.
 * Handles subscribing/unsubscribing and interacts with the backend API.
 */

import { showNotification, showConfirm, navigate, openModal, closeModal } from './ui.js'; // Added openModal, closeModal
import { UIElements, guideState, appState } from './state.js';
import { handleSearchAndFilter } from './guide.js';
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
    if (!appState.swRegistration) {
        console.warn('Service worker not registered yet. Cannot subscribe.');
        return;
    }

    try {
        const subscription = await appState.swRegistration.pushManager.getSubscription();
        isSubscribed = !(subscription === null);

        if (isSubscribed) {
            console.log('User IS subscribed.');
        } else {
            console.log('User is NOT subscribed.');
            // Get VAPID key from server
            const vapidPublicKey = await getVapidKey();
            if (!vapidPublicKey) {
                showNotification('Could not get notification key from server.', true);
                return;
            }
            const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

            // Subscribe the user
            const newSubscription = await appState.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });

            console.log('User is subscribed:', newSubscription);
            // Send subscription to the backend
            await subscribeToPush(newSubscription);
            isSubscribed = true;
        }
    } catch (error) {
        console.error('Failed to subscribe the user: ', error);
        showNotification('Failed to set up notifications.', true);
    }
}


/**
 * Loads all active and past notifications from the backend to display in the UI.
 */
export const loadAndScheduleNotifications = async () => {
    try {
        const notifications = await getProgramNotifications();
        // Store all notifications, client-side will filter for display
        guideState.userNotifications = notifications; 
        console.log(`[Notifications] Loaded ${notifications.length} scheduled notifications from server.`);
        
        renderNotifications(); // Render upcoming notifications
        renderPastNotifications(); // NEW: Render past notifications
        handleSearchAndFilter(false); // Update guide with indicators
    } catch (error) {
        console.error('Error loading notifications:', error);
        showNotification('An error occurred loading notifications.', true);
    }
};

/**
 * Adds or removes a program notification by calling the backend.
 * @param {object} programDetails - Details of the program.
 */
export const addOrRemoveNotification = async (programDetails) => {
    const existingNotification = findNotificationForProgram(programDetails, programDetails.channelId);
    
    if (existingNotification) {
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
                    handleSearchAndFilter(false);
                }
            }
        );
    } else {
        if (!isSubscribed) {
             showNotification('Please enable notifications for this site to receive alerts.', true);
             return;
        }

        const notificationLeadTime = guideState.settings.notificationLeadTime || 10;
        const programStartTime = new Date(programDetails.programStart);
        const scheduledTime = new Date(programStartTime.getTime() - notificationLeadTime * 60 * 1000);
        
        if (scheduledTime <= new Date()) {
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
            notificationLeadTime: notificationLeadTime,
            scheduledTime: scheduledTime.toISOString()
        };

        const addedNotification = await addProgramNotification(newNotificationData);
        if (addedNotification) {
            // Add to local state (it will initially be 'pending')
            guideState.userNotifications.push({ ...addedNotification, status: 'pending' });
            renderNotifications();
            handleSearchAndFilter(false);
            showNotification(`Notification set for "${addedNotification.programTitle}"!`);
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
        n.status === 'pending' // Only consider 'pending' as an active notification for setting/unsetting
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
    const pastNotificationsListEl = UIElements.pastNotificationsList;
    if (!pastNotificationsListEl) return;

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
            statusText = `Expired before notification at ${formattedTriggerTime}`;
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
    // Remove previous listeners to prevent duplicates
    UIElements.notificationsList.removeEventListener('click', handleNotificationListClick);
    UIElements.pastNotificationsList.removeEventListener('click', handleNotificationListClick);

    // Add new listeners
    UIElements.notificationsList.addEventListener('click', handleNotificationListClick);
    UIElements.pastNotificationsList.addEventListener('click', handleNotificationListClick);
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
                        handleSearchAndFilter(false);
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


/**
 * Navigates to the TV Guide page and attempts to scroll to and open the program popup.
 * @param {string} channelId
 * @param {string} programStart
 * @param {string} programId
 */
export const navigateToProgramInGuide = (channelId, programStart, programId) => {
    // First, navigate to the TV Guide page
    navigate('/tvguide');

    // Allow a small delay for the guide page to render and data to load
    setTimeout(() => {
        const progStart = new Date(programStart);
        const guideStart = new Date(guideState.currentDate);
        guideStart.setHours(0,0,0,0);

        // If the program is on a different day, update guideState.currentDate and re-render the guide
        const dateDiff = Math.floor((progStart - guideStart) / (1000 * 60 * 60 * 24));
        if (dateDiff !== 0) {
            guideState.currentDate.setDate(guideState.currentDate.getDate() + dateDiff);
            handleSearchAndFilter(); // This will re-render the guide for the new date
        }

        // After navigating and potentially changing date, wait for render, then find and click the program
        setTimeout(() => {
            let programElement;
            if (programId) {
                // Try to find by unique programId first
                programElement = UIElements.guideGrid.querySelector(`.programme-item[data-prog-id="${programId}"][data-channel-id="${channelId}"]`);
            }
            if (!programElement) {
                // Fallback to channelId and programStart if programId isn't found
                programElement = UIElements.guideGrid.querySelector(`.programme-item[data-prog-start="${programStart}"][data-channel-id="${channelId}"]`);
            }

            if(programElement) {
                // Scroll to the program element
                const scrollLeft = programElement.offsetLeft - (UIElements.guideContainer.clientWidth / 4);
                UIElements.guideContainer.scrollTo({ left: scrollLeft, behavior: 'smooth' });

                // Programmatically click the element to open the modal
                // This simulates a user click, triggering the modal logic in guide.js
                programElement.click(); 
                
                // Optional: Add a brief visual highlight after clicking
                programElement.style.transition = 'outline 0.5s, box-shadow 0.5s, transform 0.5s';
                programElement.classList.add('highlighted-search');
                setTimeout(() => { programElement.classList.remove('highlighted-search'); }, 2500);

            } else {
                showNotification("Could not find program in current guide view to open popup.", false, 4000);
            }
        }, 500); // Increased delay to ensure the guide is fully rendered and virtualized elements exist
    }, 100); // Initial delay for page navigation
};
```
