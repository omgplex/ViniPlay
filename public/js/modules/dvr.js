/**
 * dvr.js
 * Manages all client-side functionality for the DVR page.
 */

import { UIElements, dvrState, guideState } from './state.js';
import { apiFetch } from './api.js';
import { showNotification, showConfirm, openModal, closeModal } from './ui.js';

/**
 * Initializes the DVR page by fetching all required data from the backend.
 */
export async function initDvrPage() {
    console.log('[DVR] Initializing DVR page...');
    await Promise.all([
        loadScheduledJobs(),
        loadCompletedRecordings()
    ]);
    console.log('[DVR] DVR page initialized.');
}

/**
 * Fetches scheduled recording jobs from the server and updates the state.
 */
async function loadScheduledJobs() {
    const res = await apiFetch('/api/dvr/jobs');
    if (res && res.ok) {
        dvrState.scheduledJobs = await res.json();
        renderScheduledJobs();
    } else {
        showNotification('Could not load scheduled recordings.', true);
    }
}

/**
 * Fetches completed recordings from the server and updates the state.
 */
async function loadCompletedRecordings() {
    const res = await apiFetch('/api/dvr/recordings');
    if (res && res.ok) {
        dvrState.completedRecordings = await res.json();
        renderCompletedRecordings();
    } else {
        showNotification('Could not load completed recordings.', true);
    }
}

/**
 * Renders the table of scheduled and in-progress recording jobs.
 */
function renderScheduledJobs() {
    const tbody = UIElements.dvrJobsTbody;
    const jobs = dvrState.scheduledJobs || [];

    UIElements.noDvrJobsMessage.classList.toggle('hidden', jobs.length > 0);
    tbody.innerHTML = '';

    jobs.forEach(job => {
        const startTime = new Date(job.startTime).toLocaleString();
        const endTime = new Date(job.endTime).toLocaleString();
        const statusClass = `status-badge ${job.status}`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="max-w-xs truncate" title="${job.programTitle}">${job.programTitle}</td>
            <td class="max-w-xs truncate" title="${job.channelName}">${job.channelName}</td>
            <td>${startTime}</td>
            <td>${endTime}</td>
            <td><span class="${statusClass}">${job.status}</span></td>
            <td class="text-right">
                <div class="flex items-center justify-end gap-3">
                    <button class="action-btn cancel-job-btn" title="Cancel Recording" data-job-id="${job.id}" ${job.status !== 'scheduled' ? 'disabled' : ''}>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Renders the table of completed recordings.
 */
function renderCompletedRecordings() {
    const tbody = UIElements.dvrRecordingsTbody;
    const recordings = dvrState.completedRecordings || [];

    UIElements.noDvrRecordingsMessage.classList.toggle('hidden', recordings.length > 0);
    tbody.innerHTML = '';

    recordings.forEach(rec => {
        const recordedOn = new Date(rec.startTime).toLocaleString();
        const tr = document.createElement('tr');
        tr.dataset.recordingId = rec.id;
        tr.innerHTML = `
            <td class="max-w-xs truncate" title="${rec.programTitle}">${rec.programTitle}</td>
            <td class="max-w-xs truncate" title="${rec.channelName}">${rec.channelName}</td>
            <td>${recordedOn}</td>
            <td>${formatDuration(rec.durationSeconds)}</td>
            <td>${formatBytes(rec.fileSizeBytes)}</td>
            <td class="text-right">
                <div class="flex items-center justify-end gap-3">
                    <button class="action-btn play-recording-btn" title="Play Recording">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.118v3.764a1 1 0 001.555.832l3.197-1.882a1 1 0 000-1.664l-3.197-1.882z" clip-rule="evenodd" /></svg>
                    </button>
                    <button class="action-btn delete-recording-btn" title="Delete Recording">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Sets up event listeners for the DVR page.
 */
export function setupDvrEventListeners() {
    UIElements.dvrJobsTbody.addEventListener('click', async (e) => {
        const cancelButton = e.target.closest('.cancel-job-btn');
        if (cancelButton) {
            const jobId = cancelButton.dataset.jobId;
            showConfirm('Cancel Recording?', 'Are you sure you want to cancel this scheduled recording?', async () => {
                const res = await apiFetch(`/api/dvr/jobs/${jobId}`, { method: 'DELETE' });
                if (res && res.ok) {
                    showNotification('Recording cancelled.');
                    loadScheduledJobs();
                }
            });
        }
    });

    UIElements.dvrRecordingsTbody.addEventListener('click', async (e) => {
        const row = e.target.closest('tr');
        if (!row) return;

        const recordingId = row.dataset.recordingId;
        const recording = dvrState.completedRecordings.find(r => r.id == recordingId);
        if (!recording) return;

        if (e.target.closest('.play-recording-btn')) {
            UIElements.recordingTitle.textContent = recording.programTitle;
            UIElements.recordingVideoElement.src = `/dvr/${recording.filename}`;
            openModal(UIElements.recordingPlayerModal);
        } else if (e.target.closest('.delete-recording-btn')) {
            showConfirm('Delete Recording?', `This will permanently delete the recording of "${recording.programTitle}". This cannot be undone.`, async () => {
                const res = await apiFetch(`/api/dvr/recordings/${recordingId}`, { method: 'DELETE' });
                if (res && res.ok) {
                    showNotification('Recording deleted.');
                    loadCompletedRecordings();
                }
            });
        }
    });

    UIElements.closeRecordingPlayerBtn.addEventListener('click', () => {
        UIElements.recordingVideoElement.pause();
        UIElements.recordingVideoElement.src = '';
        closeModal(UIElements.recordingPlayerModal);
    });
}

/**
 * Finds a scheduled DVR job for a specific program.
 * @param {object} program - The program object from the guide.
 * @returns {object|undefined} The DVR job if found, otherwise undefined.
 */
export function findDvrJobForProgram(program) {
    return dvrState.scheduledJobs.find(job =>
        job.channelId === program.channelId &&
        job.programTitle === program.title &&
        new Date(job.startTime).getTime() <= new Date(program.start).getTime() &&
        new Date(job.endTime).getTime() >= new Date(program.stop).getTime()
    );
}

/**
 * Schedules a new DVR job or cancels an existing one.
 * @param {object} programData - Details of the program to record/cancel.
 */
export async function addOrRemoveDvrJob(programData) {
    const existingJob = findDvrJobForProgram(programData);

    if (existingJob && existingJob.status === 'scheduled') {
        showConfirm('Cancel Recording?', 'Are you sure you want to cancel this recording?', async () => {
            const res = await apiFetch(`/api/dvr/jobs/${existingJob.id}`, { method: 'DELETE' });
            if (res && res.ok) {
                showNotification('Recording cancelled.');
                loadScheduledJobs(); // Refresh the list
            }
        });
    } else if (!existingJob) {
        const res = await apiFetch('/api/dvr/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                channelId: programData.channelId,
                channelName: guideState.channels.find(c => c.id === programData.channelId)?.name || 'Unknown Channel',
                programTitle: programData.title,
                programStart: programData.start,
                programStop: programData.stop
            })
        });
        if (res && res.ok) {
            showNotification(`"${programData.title}" scheduled to record.`);
            loadScheduledJobs(); // Refresh the list
        }
    }
}


// --- Helper Functions ---

/**
 * Formats a number of bytes into a human-readable string (KB, MB, GB).
 * @param {number} bytes - The number of bytes.
 * @returns {string} The formatted string.
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Formats a duration in seconds into a human-readable string (e.g., 1h 30m).
 * @param {number} totalSeconds - The total duration in seconds.
 * @returns {string} The formatted string.
 */
function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    let result = '';
    if (hours > 0) result += `${hours}h `;
    if (minutes > 0) result += `${minutes}m`;
    return result.trim() || '0m';
}
