/**
 * sw.js
 * Service Worker for ViniPlay
 *
 * This script runs in the background to handle push notifications,
 * allowing them to be received and displayed even when the app's
 * web page is not open.
 */

// Initialize BroadcastChannel for cross-page communication
const notificationChannel = new BroadcastChannel('viniplay-notifications');

// Listener for when a push message is received
self.addEventListener('push', event => {
    console.log('[Service Worker] Push Received.');

    let payload;
    try {
        payload = event.data.json();
    } catch (e) {
        console.error('[Service Worker] Error parsing push data:', e);
        return;
    }

    if (payload && payload.type === 'program_reminder' && payload.data) {
        const { programTitle, programStart, channelName, channelLogo, url, programId, channelId } = payload.data;

        if (!programTitle || !programStart || !channelName) {
            console.error('[SW] Invalid program_reminder payload. Missing essential data.', payload.data);
            return;
        }

        const localStartTime = new Date(programStart).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        const notificationTitle = programTitle;
        const notificationOptions = {
            body: `Starts at ${localStartTime} on ${channelName}`,
            icon: channelLogo || 'https://i.imgur.com/rwa8SjI.png',
            badge: 'https://i.imgur.com/rwa8SjI.png',
            vibrate: [100, 50, 100],
            data: { // Store all necessary data here
                url: url || '/',
                channelId: channelId,
                programStart: programStart,
                programId: programId
            },
            tag: `program-${programStart}-${channelName}`
        };
        
        console.log(`[SW] Showing timezone-aware notification: "${notificationTitle}" with body: "${notificationOptions.body}"`);
        event.waitUntil(
            self.registration.showNotification(notificationTitle, notificationOptions)
            .then(() => {
                notificationChannel.postMessage({ type: 'refresh-notifications' });
            })
        );

    } else {
        console.log('[SW] Received a generic push notification.', payload);
        const title = payload.title || 'ViniPlay Notification';
        const options = {
            body: payload.body || 'You have a new notification.',
            icon: payload.icon || 'https://i.imgur.com/rwa8SjI.png',
            data: {
                url: payload.data ? payload.data.url : '/'
            },
        };
        event.waitUntil(self.registration.showNotification(title, options));
    }
});

// MODIFIED: Listener for when a user clicks on the notification
self.addEventListener('notificationclick', event => {
    console.log('[Service Worker] Notification click Received.');
    event.notification.close();

    const { channelId, programStart, programId } = event.notification.data;

    const messagePayload = {
        type: 'navigate-to-program',
        data: { channelId, programStart, programId }
    };

    event.waitUntil(
        clients.matchAll({
            type: "window",
            includeUncontrolled: true
        }).then(clientList => {
            // Check if there's an open tab
            for (const client of clientList) {
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    console.log('[SW] Found an open client. Focusing and sending message.');
                    // Post the message to the specific client
                    client.postMessage(messagePayload);
                    return client.focus();
                }
            }
            // If no client is found, open a new window
            if (clients.openWindow) {
                console.log('[SW] No open client found. Opening a new window.');
                return clients.openWindow('/').then(windowClient => {
                    // Wait for the new window to be ready before sending the message
                    if (windowClient) {
                       // The message will be queued and sent once the page is ready
                       // We will add a listener in the main app to handle this
                       console.log('[SW] New window opened. The app will handle the navigation.');
                    }
                });
            }
        })
    );
});
