/**
 * notification.js
 * * Manages client-side browser notifications for upcoming programs.
 * Handles permission requests, scheduling, display, and interaction with backend API.
 */

import { apiFetch } from './api.js';
import { showNotification, navigate, showConfirm } from './ui.js';
import { UIElements, guideState } from './state.js';
import { handleSearchAndFilter } from './guide.js'; // To re-render guide for visual indicators

// Store scheduled notification timers
const scheduledNotificationTimers = new Map(); // Map<notification.id, setTimeoutId>

/**
 * Requests notification permission from the browser.
 * @returns {Promise<string>} The permission status ('granted', 'denied', or 'default').
 */
export const requestNotificationPermission = async () => {
    if (!('Notification' in window)) {
        showNotification("This browser does not support desktop notifications.", true);
        return 'unsupported';
    }

    if (Notification.permission === 'granted') {
        return 'granted';
    } else if (Notification.permission === 'denied') {
        showNotification("Notification permission denied. Please enable it in your browser settings.", true);
        return 'denied';
    } else {
        // Ask for permission
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            showNotification("Notification permission granted!");
        } else {
            showNotification("Notification permission denied.", true);
        }
        return permission;
    }
};

/**
 * Schedules a single browser notification.
 * @param {object} notification - The notification object from the backend.
 */
const scheduleBrowserNotification = (notification) => {
    // Clear any existing timer for this notification to prevent duplicates
    cancelBrowserNotification(notification.id);

    const now = new Date();
    const notificationTime = new Date(notification.scheduledTime);
    const delay = notificationTime.getTime() - now.getTime();

    if (delay > 0) {
        console.log(`[Notifications] Scheduling notification for "${notification.programTitle}" in ${delay / 1000} seconds.`);
        const timeoutId = setTimeout(() => {
            sendNotification(notification);
            // After sending, remove from local state and re-render
            guideState.userNotifications = guideState.userNotifications.filter(n => n.id !== notification.id);
            renderNotifications();
            handleSearchAndFilter(false); // Re-render guide to remove visual indicator
            scheduledNotificationTimers.delete(notification.id);
        }, delay);
        scheduledNotificationTimers.set(notification.id, timeoutId);
    } else {
        console.warn(`[Notifications] Notification for "${notification.programTitle}" is in the past or too soon to schedule.`);
        // If it's in the past, remove it from local state to clean up.
        guideState.userNotifications = guideState.userNotifications.filter(n => n.id !== notification.id);
        renderNotifications();
        handleSearchAndFilter(false);
        // Optionally send it immediately if it was just slightly in the past but still relevant (e.g., within 1-2 mins)
        // const gracePeriod = 120 * 1000; // 2 minutes
        // if (Math.abs(delay) < gracePeriod) {
        //     sendNotification(notification);
        // }
    }
};

/**
 * Cancels a scheduled browser notification timer.
 * @param {string} notificationId - The ID of the notification to cancel.
 */
const cancelBrowserNotification = (notificationId) => {
    const timeoutId = scheduledNotificationTimers.get(notificationId);
    if (timeoutId) {
        clearTimeout(timeoutId);
        scheduledNotificationTimers.delete(notificationId);
        console.log(`[Notifications] Canceled scheduled browser notification for ID: ${notificationId}`);
    }
};

/**
 * Displays a desktop notification.
 * @param {object} notification - The notification object.
 */
const sendNotification = (notification) => {
    if (Notification.permission === 'granted') {
        const programStartTime = new Date(notification.programStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const programStopTime = new Date(notification.programStop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const options = {
            body: `${notification.programTitle}\n${programStartTime} - ${programStopTime} on ${notification.channelName}\n${notification.programDesc || 'No description available.'}`,
            icon: notification.channelLogo || 'https://placehold.co/48x48/1f2937/d1d5db?text=?;&font=Inter',
            data: {
                notificationId: notification.id,
                channelId: notification.channelId,
                programStart: notification.programStart
            }
        };

        const notif = new Notification(`Upcoming: ${notification.programTitle}`, options);

        notif.onclick = (event) => {
            event.preventDefault(); // Prevent the browser from focusing the current tab
            window.focus(); // Bring the current window to focus
            const { channelId, programStart } = notif.data;
            navigateToProgramInGuide(channelId, programStart);
            notif.close(); // Close the notification after click
        };
    } else {
        console.warn('Notification permission not granted, cannot send notification.');
    }
};

/**
 * Loads all active notifications from the backend and schedules them.
 */
export const loadAndScheduleNotifications = async () => {
    const permissionStatus = await requestNotificationPermission();
    if (permissionStatus !== 'granted') {
        console.warn('Notifications will not be scheduled due to permission issues.');
        // If permission is denied, clear any pending notifications in state as they can't be delivered
        guideState.userNotifications = [];
        renderNotifications(); // Clear list
        handleSearchAndFilter(false); // Update guide indicators
        return;
    }

    try {
        const response = await apiFetch('/api/notifications');
        if (response && response.ok) {
            const notifications = await response.json();
            guideState.userNotifications = notifications;
            console.log(`[Notifications] Loaded ${notifications.length} notifications from server.`);
            
            // Clear all existing timeouts before scheduling new ones
            scheduledNotificationTimers.forEach(timeoutId => clearTimeout(timeoutId));
            scheduledNotificationTimers.clear();

            notifications.forEach(notif => {
                scheduleBrowserNotification(notif);
            });
            renderNotifications(); // Render notification list immediately
            handleSearchAndFilter(false); // Update guide with indicators
        } else {
            showNotification('Failed to load notifications.', true);
        }
    } catch (error) {
        console.error('Error loading and scheduling notifications:', error);
        showNotification('An error occurred loading notifications.', true);
    }
};

/**
 * Adds or removes a program notification.
 * @param {object} programDetails - Details of the program.
 * @param {string} programDetails.channelId
 * @param {string} programDetails.channelName
 * @param {string} programDetails.channelLogo
 * @param {string} programDetails.programTitle
 * @param {string} programDetails.programStart - ISO string
 * @param {string} programDetails.programStop - ISO string
 * @param {string} programDetails.programDesc
 * @param {string} programDetails.programId - Unique ID for program within channel
 * @param {string} [programDetails.id] - Existing notification ID if removing.
 */
export const addOrRemoveNotification = async (programDetails) => {
    const existingNotification = findNotificationForProgram(programDetails, programDetails.channelId);
    
    if (existingNotification) {
        // If notification exists, confirm and then delete it
        showConfirm(
            'Remove Notification?',
            `Are you sure you want to remove the notification for "${programDetails.programTitle}"?`,
            async () => {
                await deleteProgramNotification(existingNotification.id);
                showNotification(`Notification for "${programDetails.programTitle}" removed.`);
            }
        );
    } else {
        // If no notification exists, add a new one
        const permission = await requestNotificationPermission();
        if (permission !== 'granted') {
            showNotification('Notification permission required to set notifications.', true);
            return;
        }

        const notificationLeadTime = guideState.settings.notificationLeadTime || 10; // Default to 10 minutes
        const programStartTime = new Date(programDetails.programStart);
        const scheduledTime = new Date(programStartTime.getTime() - notificationLeadTime * 60 * 1000);
        
        const now = new Date();
        if (scheduledTime.getTime() <= now.getTime()) {
             showNotification(`Cannot set notification for past or immediate program.`, true);
             return;
        }

        const newNotification = {
            channelId: programDetails.channelId,
            channelName: programDetails.channelName,
            channelLogo: programDetails.channelLogo,
            programTitle: programDetails.programTitle,
            programStart: programDetails.programStart,
            programStop: programDetails.programStop,
            programDesc: programDetails.programDesc,
            programId: programDetails.programId,
            notificationLeadTime: notificationLeadTime,
            scheduledTime: scheduledTime.toISOString(),
            createdAt: new Date().toISOString()
        };

        try {
            const response = await apiFetch('/api/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newNotification)
            });

            if (response && response.ok) {
                const addedNotification = await response.json();
                guideState.userNotifications.push(addedNotification);
                scheduleBrowserNotification(addedNotification);
                showNotification(`Notification set for "${addedNotification.programTitle}"!`);
            } else {
                const errorData = await response.json();
                showNotification(`Failed to add notification: ${errorData.error}`, true);
            }
        } catch (error) {
            console.error('Error adding notification:', error);
            showNotification('An error occurred while setting notification.', true);
        }
    }
    // Always re-render notifications list and guide indicators after any action
    renderNotifications();
    handleSearchAndFilter(false);
};

/**
 * Deletes a program notification by its ID.
 * @param {string} notificationId - The ID of the notification to delete.
 */
export const deleteProgramNotification = async (notificationId) => {
    try {
        const response = await apiFetch(`/api/notifications/${notificationId}`, {
            method: 'DELETE'
        });

        if (response && response.ok) {
            // Remove from local state and cancel browser timer
            guideState.userNotifications = guideState.userNotifications.filter(n => n.id !== notificationId);
            cancelBrowserNotification(notificationId);
            showNotification('Notification removed successfully.');
        } else {
            const errorData = await response.json();
            showNotification(`Failed to delete notification: ${errorData.error}`, true);
        }
    } catch (error) {
        console.error('Error deleting notification:', error);
        showNotification('An error occurred while removing notification.', true);
    }
    renderNotifications(); // Re-render notification list
    handleSearchAndFilter(false); // Update guide indicators
};

/**
 * Checks if a given program has an active notification set.
 * @param {object} program - The program object with title, start, stop.
 * @param {string} channelId - The ID of the channel the program belongs to.
 * @returns {object|null} The notification object if found, otherwise null.
 */
export const findNotificationForProgram = (program, channelId) => {
    // We need a stable identifier for a program. Using title + start + stop is usually reliable.
    const programIdentifier = `${program.title}-${program.start}-${program.stop}`;
    return guideState.userNotifications.find(n => 
        n.channelId === channelId &&
        n.programTitle === program.title &&
        n.programStart === program.start &&
        n.programStop === program.stop
    );
};

/**
 * Renders the list of upcoming notifications in the Notification Center.
 */
export const renderNotifications = () => {
    const notificationListEl = UIElements.notificationsList;
    if (!notificationListEl) return;

    // Filter out past notifications and sort by scheduled time
    const now = new Date();
    const upcomingNotifications = guideState.userNotifications
        .filter(n => new Date(n.scheduledTime).getTime() > now.getTime() - (5 * 60 * 1000)) // Keep notifications that were scheduled for up to 5 mins ago in case of slight delay
        .sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

    if (upcomingNotifications.length === 0) {
        notificationListEl.innerHTML = `<p class="text-center text-gray-500 py-4">No upcoming notifications.</p>`;
        return;
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
                    <p class="text-blue-400 text-xs mt-1">Notification at ${formattedNotificationTime} (${notif.notificationLeadTime} mins before)</p>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0 ml-4">
                    <button class="action-btn view-program-btn p-2 rounded-full hover:bg-gray-700" title="View in TV Guide" data-channel-id="${notif.channelId}" data-program-start="${notif.programStart}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.555-4.555A.5.5 0 0120 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h10l-4 4"></path><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v7a1 1 0 001 1h7"></path></svg>
                    </button>
                    <button class="action-btn delete-notification-btn p-2 rounded-full hover:bg-red-900" title="Delete Notification" data-notification-id="${notif.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Attach event listeners for the rendered notifications
    setupNotificationListEventListeners();
};

/**
 * Sets up event listeners for the dynamically rendered notification list.
 */
const setupNotificationListEventListeners = () => {
    // Clear previous listeners to avoid duplicates
    UIElements.notificationsList.removeEventListener('click', handleNotificationListClick);
    // Add the new listener
    UIElements.notificationsList.addEventListener('click', handleNotificationListClick);
};

/**
 * Handles clicks within the notification list.
 * @param {Event} e - The click event.
 */
const handleNotificationListClick = (e) => {
    const deleteBtn = e.target.closest('.delete-notification-btn');
    const viewBtn = e.target.closest('.view-program-btn');

    if (deleteBtn) {
        const notificationId = deleteBtn.dataset.notificationId;
        const notification = guideState.userNotifications.find(n => n.id === notificationId);
        if (notification) {
            showConfirm(
                'Delete Notification?',
                `Are you sure you want to delete the notification for "${notification.programTitle}"?`,
                () => deleteProgramNotification(notificationId)
            );
        }
    } else if (viewBtn) {
        const channelId = viewBtn.dataset.channelId;
        const programStart = viewBtn.dataset.programStart;
        navigateToProgramInGuide(channelId, programStart);
    }
};


/**
 * Navigates to the TV Guide page and attempts to scroll to and highlight a specific program.
 * @param {string} channelId - The ID of the channel.
 * @param {string} programStart - The ISO string start time of the program.
 */
export const navigateToProgramInGuide = (channelId, programStart) => {
    navigate('/tvguide'); // Switch to the TV Guide tab first

    // Use a timeout to ensure the guide has rendered before attempting to scroll/highlight
    setTimeout(() => {
        const progStart = new Date(programStart);
        const guideStart = new Date(guideState.currentDate);
        guideStart.setHours(0,0,0,0);

        const dateDiff = Math.floor((progStart - guideStart) / (1000 * 60 * 60 * 24));
        if (dateDiff !== 0) {
            guideState.currentDate.setDate(guideState.currentDate.getDate() + dateDiff);
            // Re-call handleSearchAndFilter to re-render the guide for the correct date
            handleSearchAndFilter();
        }

        setTimeout(() => {
            const programElement = UIElements.guideGrid.querySelector(`.programme-item[data-prog-start="${programStart}"][data-channel-id="${channelId}"]`);
            if(programElement) {
                const scrollLeft = programElement.offsetLeft - (UIElements.guideContainer.clientWidth / 4);
                UIElements.guideContainer.scrollTo({ left: scrollLeft, behavior: 'smooth' });

                programElement.style.transition = 'outline 0.5s, box-shadow 0.5s, transform 0.5s';
                programElement.classList.add('highlighted-search');
                setTimeout(() => { programElement.classList.remove('highlighted-search'); }, 2500);
            } else {
                showNotification("Could not find program in current guide view.", false, 4000);
            }
        }, 300); // Give a bit more time for the guide to render after potential date change
    }, 100); // Initial delay to ensure page switch is complete
};
