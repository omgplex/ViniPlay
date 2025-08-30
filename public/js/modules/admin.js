/**
 * admin.js
 * Manages all client-side functionality for the admin Activity page.
 */

import { UIElements } from './state.js';
import { apiFetch } from './api.js';
import { showNotification, showConfirm } from './ui.js';
import { ICONS } from './icons.js';

// Local state for the admin page
const adminState = {
    live: [],
    history: [],
    liveDurationInterval: null,
};

/**
 * Initializes the Activity page by fetching data and setting up listeners.
 */
export async function initActivityPage() {
    console.log('[ADMIN] Initializing Activity page...');
    await loadActivityData();
}

/**
 * Fetches both live and historical activity data from the server.
 */
async function loadActivityData() {
    const res = await apiFetch('/api/admin/activity');
    if (res && res.ok) {
        const data = await res.json();
        adminState.live = data.live || [];
        adminState.history = data.history || [];
        renderLiveActivity();
        renderWatchHistory();
    } else {
        showNotification('Could not load activity data.', true);
        UIElements.noLiveActivityMessage.classList.remove('hidden');
        UIElements.noWatchHistoryMessage.classList.remove('hidden');
    }
}

/**
 * Renders the table of currently active streams.
 */
function renderLiveActivity() {
    const tbody = UIElements.liveActivityTbody;
    const hasLiveStreams = adminState.live.length > 0;

    UIElements.noLiveActivityMessage.classList.toggle('hidden', hasLiveStreams);
    UIElements.liveActivityTableContainer.classList.toggle('hidden', !hasLiveStreams);

    if (!tbody) return;
    tbody.innerHTML = '';

    adminState.live.forEach(stream => {
        const tr = document.createElement('tr');
        tr.dataset.streamKey = stream.streamKey;
        tr.innerHTML = `
            <td>${stream.username}</td>
            <td>${stream.clientIp || 'N/A'}</td>
            <td class="max-w-xs truncate" title="${stream.channelName}">${stream.channelName}</td>
            <td>${new Date(stream.startTime).toLocaleString()}</td>
            <td class="live-duration" data-start-time="${stream.startTime}">-</td>
            <td class="text-right">
                <button class="action-btn stop-stream-btn text-red-500 hover:text-red-400" title="Stop Stream">
                    ${ICONS.stopRec}
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    updateLiveDurations();
    if (adminState.liveDurationInterval) clearInterval(adminState.liveDurationInterval);
    if (hasLiveStreams) {
        adminState.liveDurationInterval = setInterval(updateLiveDurations, 1000);
    }
}

/**
 * Renders the table of historical watch sessions.
 */
function renderWatchHistory(filteredHistory = null) {
    const history = filteredHistory || adminState.history;
    const tbody = UIElements.watchHistoryTbody;
    const hasHistory = history.length > 0;

    UIElements.noWatchHistoryMessage.classList.toggle('hidden', hasHistory);
    UIElements.watchHistoryTableContainer.classList.toggle('hidden', !hasHistory);

    if (!tbody) return;
    tbody.innerHTML = '';

    history.forEach(entry => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${entry.username}</td>
            <td>${entry.client_ip || 'N/A'}</td>
            <td class="max-w-xs truncate" title="${entry.channel_name}">${entry.channel_name}</td>
            <td>${new Date(entry.start_time).toLocaleString()}</td>
            <td>${entry.end_time ? new Date(entry.end_time).toLocaleString() : 'N/A'}</td>
            <td>${formatDuration(entry.duration_seconds)}</td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Sets up event listeners for the Activity page.
 */
export function setupAdminEventListeners() {
    UIElements.refreshActivityBtn?.addEventListener('click', loadActivityData);

    UIElements.liveActivityTbody?.addEventListener('click', e => {
        const stopBtn = e.target.closest('.stop-stream-btn');
        if (stopBtn) {
            const row = stopBtn.closest('tr');
            const streamKey = row.dataset.streamKey;
            const username = row.cells[0].textContent;

            showConfirm(
                'Stop Stream?',
                `Are you sure you want to terminate the stream for user "${username}"?`,
                async () => {
                    const res = await apiFetch('/api/admin/stop-stream', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ streamKey })
                    });
                    if (res && res.ok) {
                        showNotification('Stream terminated successfully.');
                        loadActivityData(); // Refresh the view
                    }
                }
            );
        }
    });
    
    UIElements.historySearchInput?.addEventListener('input', e => {
        const searchTerm = e.target.value.toLowerCase().trim();
        if (!searchTerm) {
            renderWatchHistory(adminState.history);
            return;
        }
        const filtered = adminState.history.filter(entry => 
            entry.username.toLowerCase().includes(searchTerm) ||
            (entry.channel_name || '').toLowerCase().includes(searchTerm) ||
            (entry.client_ip || '').toLowerCase().includes(searchTerm)
        );
        renderWatchHistory(filtered);
    });
}

// --- Utility Functions ---

/**
 * Updates the duration display for all live streams.
 */
function updateLiveDurations() {
    const durationElements = document.querySelectorAll('#live-activity-tbody .live-duration');
    durationElements.forEach(el => {
        const startTime = el.dataset.startTime;
        if (startTime) {
            const start = new Date(startTime).getTime();
            const now = Date.now();
            const durationSeconds = Math.round((now - start) / 1000);
            el.textContent = formatDuration(durationSeconds);
        }
    });
}

/**
 * Formats a duration in seconds to a human-readable string (e.g., 1h 23m 45s).
 * @param {number} totalSeconds - The duration in seconds.
 * @returns {string} The formatted duration string.
 */
function formatDuration(totalSeconds) {
    if (totalSeconds === null || isNaN(totalSeconds) || totalSeconds < 0) return 'N/A';
    if (totalSeconds < 60) return `${totalSeconds}s`;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let result = '';
    if (hours > 0) result += `${hours}h `;
    if (minutes > 0) result += `${minutes}m `;
    if (seconds > 0 && hours === 0) result += `${seconds}s`; // Only show seconds if less than an hour

    return result.trim();
}
