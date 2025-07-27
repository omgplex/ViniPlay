/**
 * sw.js
 * Service Worker for ViniPlay
 *
 * This script runs in the background to handle push notifications,
 * allowing them to be received and displayed even when the app's
 * web page is not open.
 */

// Listener for when a push message is received
self.addEventListener('push', event => {
    console.log('[Service Worker] Push Received.');

    // Default payload if none is sent.
    let payload = {
        title: 'ViniPlay Notification',
        body: 'You have a new notification.',
        icon: 'https://i.imgur.com/rwa8SjI.png',
        data: { url: '/' }
    };

    // Try to parse the data sent with the push message
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (e) {
            console.error('[Service Worker] Error parsing push data:', e);
        }
    }

    const options = {
        body: payload.body,
        icon: payload.icon || 'https://i.imgur.com/rwa8SjI.png',
        badge: 'https://i.imgur.com/rwa8SjI.png', // Badge for Android notifications
        vibrate: [100, 50, 100], // Vibration pattern
        data: {
            url: payload.data.url, // URL to open on click, now includes channelId and programId
        },
    };

    // Use waitUntil to ensure the service worker doesn't terminate
    // before the notification is displayed.
    event.waitUntil(
        self.registration.showNotification(payload.title, options)
    );
});

// Listener for when a user clicks on the notification
self.addEventListener('notificationclick', event => {
    console.log('[Service Worker] Notification click Received.');

    // Close the notification
    event.notification.close();

    const urlToOpen = event.notification.data.url || '/';

    // Use waitUntil to ensure the browser doesn't terminate the
    // service worker before the new window/tab has been focused.
    event.waitUntil(
        clients.matchAll({
            type: "window",
            includeUncontrolled: true // Include tabs that might not be controlled by this SW yet
        }).then(clientList => {
            // Check if there's already a window open for the app
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                // NEW: If a client is found that matches our origin, navigate it to the specific URL
                if (client.url.startsWith(self.location.origin) && 'navigate' in client) {
                    return client.navigate(urlToOpen).then(navigatedClient => navigatedClient.focus());
                }
            }
            // If no client is found or no suitable client to navigate, open a new tab/window.
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
