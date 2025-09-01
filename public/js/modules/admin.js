/**
 * admin.js
 * Manages all client-side functionality for the admin Activity page.
 * -- ENHANCEMENT: This file has been significantly updated to support real-time updates,
 * history filtering, and advanced admin actions like changing a user's channel.
 */

import { UIElements, guideState } from './state.js';
import { apiFetch } from './api.js';
import { showNotification, showConfirm, openModal } from './ui.js';
import { ICONS } from './icons.js';
//-- ENHANCEMENT: Import channel selector functions from multiview.js to reuse the modal.
import { populateChannelSelector } from './multiview.js';

// Local state for the admin page
const adminState = {
    live: [],
    history: [],
    liveDurationInterval: null,
    //-- ENHANCEMENT: Callback to handle the channel change action.
    channelSelectorCallback: null
};

/**
 * Initializes the Activity page by fetching data and setting up listeners.
 */
export async function initActivityPage() {
    console.log('[ADMIN] Initializing Activity page...');
    await loadActivityData();
    //-- ENHANCEMENT: Set default values for date filters.
    const today = new Date().toISOString().split('T')[0];
    if (UIElements.historyDateEnd) UIElements.historyDateEnd.value = today;
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
        applyHistoryFilters(); // Use the filter function to render history initially
    } else {
        showNotification('Could not load activity data.', true);
        UIElements.noLiveActivityMessage.classList.remove('hidden');
        UIElements.noWatchHistoryMessage.classList.remove('hidden');
    }
}

//-- ENHANCEMENT: This function is called by the SSE listener in main.js for real-time updates.
/**
 * Handles real-time updates for live activity pushed from the server.
 * @param {Array} liveActivityData - The new list of live streams.
 */
export function handleActivityUpdate(liveActivityData) {
    console.log('[ADMIN_SSE] Received real-time activity update.');
    adminState.live = liveActivityData || [];
    renderLiveActivity();
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
        tr.dataset.userId = stream.userId; // Store userId for actions

        //-- ENHANCEMENT: New table row structure with logo, profile, and new buttons.
        tr.innerHTML = `
            <td>${stream.username}</td>
            <td>${stream.clientIp || 'N/A'}</td>
            <td>
                <div class="flex items-center gap-3">
                    <img src="${stream.channelLogo || 'https://placehold.co/40x40/1f2937/d1d5db?text=?'}" 
                         onerror="this.onerror=null; this.src='https://placehold.co/40x40/1f2937/d1d5db?text=?';" 
                         class="w-10 h-10 object-contain rounded-md bg-gray-700 flex-shrink-0" 
                         alt="Channel Logo">
                    <span class="truncate" title="${stream.channelName}">${stream.channelName}</span>
                </div>
            </td>
            <td>${stream.streamProfileName || 'N/A'}</td>
            <td>${new Date(stream.startTime).toLocaleString()}</td>
            <td class="live-duration" data-start-time="${stream.startTime}">-</td>
            <td class="text-right">
                <div class="flex items-center justify-end gap-3">
                    <button class="action-btn change-stream-btn text-blue-400 hover:text-blue-300" title="Change User's Channel">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
                    </button>
                    <button class="action-btn stop-stream-btn text-red-500 hover:text-red-400" title="Stop Stream">
                        ${ICONS.stopRec}
                    </button>
                </div>
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
 * Renders the table of historical watch sessions based on a provided (or full) list.
 * @param {Array|null} filteredHistory - The subset of history to render. If null, renders all history.
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
        //-- ENHANCEMENT: New table row structure with logo and profile.
        tr.innerHTML = `
            <td>${entry.username}</td>
            <td>${entry.client_ip || 'N/A'}</td>
            <td>
                <div class="flex items-center gap-3">
                    <img src="${entry.channel_logo || 'https://placehold.co/40x40/1f2937/d1d5db?text=?'}" 
                         onerror="this.onerror=null; this.src='https://placehold.co/40x40/1f2937/d1d5db?text=?';" 
                         class="w-10 h-10 object-contain rounded-md bg-gray-700 flex-shrink-0" 
                         alt="Channel Logo">
                    <span class="truncate" title="${entry.channel_name}">${entry.channel_name}</span>
                </div>
            </td>
            <td>${entry.stream_profile_name || 'N/A'}</td>
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
        const changeBtn = e.target.closest('.change-stream-btn');
        
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
                        // The UI will update automatically via SSE, but we can force it here for immediate feedback.
                        loadActivityData(); 
                    }
                }
            );
        } 
        //-- ENHANCEMENT: Handle clicks on the "Change Channel" button.
        else if (changeBtn) {
            const row = changeBtn.closest('tr');
            const streamKey = row.dataset.streamKey;
            const userId = row.dataset.userId;

            // Define what happens when a channel is selected from the modal
            adminState.channelSelectorCallback = async (channel) => {
                const res = await apiFetch('/api/admin/change-stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, streamKey, channel })
                });
                if (res && res.ok) {
                    showNotification(`Change channel command sent successfully.`);
                }
            };
            
            // Reuse the existing channel selector modal
            populateChannelSelector();
            openModal(UIElements.multiviewChannelSelectorModal);
        }
    });
    
    //-- ENHANCEMENT: Add event listeners for all history filters.
    UIElements.historySearchInput?.addEventListener('input', applyHistoryFilters);
    UIElements.historyDateFilter?.addEventListener('change', () => {
        const isCustom = UIElements.historyDateFilter.value === 'custom';
        UIElements.historyCustomDateContainer.classList.toggle('hidden', !isCustom);
        applyHistoryFilters();
    });
    UIElements.historyDateStart?.addEventListener('change', applyHistoryFilters);
    UIElements.historyDateEnd?.addEventListener('change', applyHistoryFilters);
}

//-- ENHANCEMENT: New function to apply all history filters and re-render the table.
function applyHistoryFilters() {
    const searchTerm = UIElements.historySearchInput.value.toLowerCase().trim();
    const dateFilter = UIElements.historyDateFilter.value;

    let filtered = [...adminState.history];

    // Apply search term filter
    if (searchTerm) {
        filtered = filtered.filter(entry => 
            entry.username.toLowerCase().includes(searchTerm) ||
            (entry.channel_name || '').toLowerCase().includes(searchTerm) ||
            (entry.client_ip || '').toLowerCase().includes(searchTerm) ||
            (entry.stream_profile_name || '').toLowerCase().includes(searchTerm)
        );
    }

    // Apply date range filter
    const now = new Date();
    let startDate;

    if (dateFilter === '24h') {
        startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    } else if (dateFilter === '7d') {
        startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    } else if (dateFilter === 'custom') {
        const startVal = UIElements.historyDateStart.value;
        const endVal = UIElements.historyDateEnd.value;
        if (startVal && endVal) {
            startDate = new Date(startVal);
            const endDate = new Date(endVal);
            endDate.setHours(23, 59, 59, 999); // Include the entire end day
            filtered = filtered.filter(entry => {
                const entryDate = new Date(entry.start_time);
                return entryDate >= startDate && entryDate <= endDate;
            });
            // Skip further date filtering
            startDate = null; 
        }
    }

    if (startDate) {
        filtered = filtered.filter(entry => new Date(entry.start_time) >= startDate);
    }
    
    renderWatchHistory(filtered);
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
    // Only show seconds if the total duration is less than a minute, handled at the top.
    if (hours === 0 && minutes < 5 && seconds > 0) result += `${seconds}s`;


    return result.trim() || '0s';
}

//-- ENHANCEMENT: This function is used by the admin event listener to handle the modal callback.
export function handleAdminChannelClick(channelItem) {
    if (channelItem && adminState.channelSelectorCallback) {
        const channel = {
            id: channelItem.dataset.id,
            name: channelItem.dataset.name,
            url: channelItem.dataset.url,
            logo: channelItem.dataset.logo,
        };
        adminState.channelSelectorCallback(channel);
    }
}
