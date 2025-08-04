/**
 * dvr.js
 * Manages all client-side functionality for the DVR page.
 */

import { UIElements, dvrState, guideState } from './state.js';
import { apiFetch } from './api.js';
import { showNotification, showConfirm, openModal, closeModal, navigate } from './ui.js';
import { scrollToChannel, handleSearchAndFilter } from './guide.js';

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

    UIElements.noDvrJobsMessage.classList.toggle('hidden', jobs.length === 0);
    tbody.innerHTML = '';

    jobs.forEach(job => {
        const startTime = new Date(job.startTime).toLocaleString();
        const endTime = new Date(job.endTime).toLocaleString();
        
        // Make the error status a clickable button if there's an error message
        const statusHTML = job.status === 'error' && job.errorMessage
            ? `<button class="status-badge ${job.status} view-error-btn" data-job-id="${job.id}">${job.status}</button>`
            : `<span class="status-badge ${job.status}">${job.status}</span>`;

        const tr = document.createElement('tr');
        tr.dataset.jobId = job.id;
        tr.innerHTML = `
            <td class="max-w-xs truncate" title="${job.programTitle}">${job.programTitle}</td>
            <td class="max-w-xs truncate" title="${job.channelName}">${job.channelName}</td>
            <td>${startTime}</td>
            <td>${endTime}</td>
            <td>${statusHTML}</td>
            <td class="text-right">
                <div class="flex items-center justify-end gap-3">
                    ${job.status === 'recording' ? `
                        <button class="action-btn stop-recording-btn text-red-500 hover:text-red-400" title="Stop Recording" data-job-id="${job.id}">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 002 0V7a1 1 0 10-2 0v2zm1 4a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>
                        </button>
                    ` : ''}
                     <button class="action-btn go-to-guide-btn" title="View in TV Guide" data-channel-id="${job.channelId}" data-program-start="${job.startTime}">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" /></svg>
                    </button>
                    ${job.status === 'scheduled' ? `
                        <button class="action-btn edit-job-btn" title="Edit Schedule" data-job-id="${job.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>
                        </button>
                    ` : ''}
                    <button class="action-btn ${['error', 'cancelled', 'completed'].includes(job.status) ? 'delete-history-btn' : 'cancel-job-btn'}" title="${['error', 'cancelled', 'completed'].includes(job.status) ? 'Remove From History' : 'Cancel Recording'}" data-job-id="${job.id}" ${job.status === 'recording' ? 'disabled' : ''}>
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
 * Converts a datetime-local input string to an ISO string.
 * @param {string} localDateTimeString - e.g., "2023-10-27T14:30"
 * @returns {string} ISO formatted string
 */
const toISOStringLocal = (localDateTimeString) => {
    return new Date(localDateTimeString).toISOString();
};

/**
 * Converts an ISO string to a format suitable for datetime-local input.
 * @param {string} isoString - ISO formatted string
 * @returns {string} e.g., "2023-10-27T14:30"
 */
const fromISOStringToLocalDateTime = (isoString) => {
    const date = new Date(isoString);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
};


/**
 * Sets up event listeners for the DVR page.
 */
export function setupDvrEventListeners() {
    UIElements.dvrJobsTbody.addEventListener('click', async (e) => {
        const button = e.target.closest('button');
        if (!button) return;

        const jobId = button.dataset.jobId;
        const job = dvrState.scheduledJobs.find(j => j.id == jobId);

        if (button.classList.contains('cancel-job-btn')) {
            showConfirm('Cancel Recording?', 'Are you sure you want to cancel this scheduled recording?', async () => {
                const res = await apiFetch(`/api/dvr/jobs/${jobId}`, { method: 'DELETE' });
                if (res && res.ok) {
                    showNotification('Recording cancelled.');
                    await loadScheduledJobs();
                }
            });
        } else if (button.classList.contains('stop-recording-btn')) {
             showConfirm('Stop Recording?', 'Are you sure you want to stop this recording? The file will be saved.', async () => {
                const res = await apiFetch(`/api/dvr/jobs/${jobId}/stop`, { method: 'POST' });
                if (res && res.ok) {
                    showNotification('Recording stopped.');
                    await Promise.all([loadScheduledJobs(), loadCompletedRecordings()]);
                }
            });
        } else if (button.classList.contains('view-error-btn') && job) {
            UIElements.dvrErrorModalTitle.textContent = `Error for: ${job.programTitle}`;
            UIElements.dvrErrorModalContent.textContent = job.errorMessage || 'No detailed error message was recorded.';
            openModal(UIElements.dvrErrorModal);
        } else if (button.classList.contains('edit-job-btn') && job) {
            UIElements.dvrEditModalTitle.textContent = `Edit: ${job.programTitle}`;
            UIElements.dvrEditId.value = job.id;
            UIElements.dvrEditStart.value = fromISOStringToLocalDateTime(job.startTime);
            UIElements.dvrEditEnd.value = fromISOStringToLocalDateTime(job.endTime);
            openModal(UIElements.dvrEditModal);
        } else if (button.classList.contains('go-to-guide-btn') && job) {
             navigateToProgramInGuide(job.channelId, job.startTime);
        } else if (button.classList.contains('delete-history-btn')) {
             showConfirm('Remove From History?', 'This will permanently remove this job record. It will not delete the recorded file if one exists.', async () => {
                const res = await apiFetch(`/api/dvr/jobs/${jobId}/history`, { method: 'DELETE' });
                if (res && res.ok) {
                    showNotification('Job removed from history.');
                    await loadScheduledJobs();
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

    // Modal Listeners
    UIElements.dvrErrorModalCloseBtn.addEventListener('click', () => closeModal(UIElements.dvrErrorModal));
    UIElements.dvrEditCancelBtn.addEventListener('click', () => closeModal(UIElements.dvrEditModal));
    
    UIElements.dvrEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const jobId = UIElements.dvrEditId.value;
        const startTime = toISOStringLocal(UIElements.dvrEditStart.value);
        const endTime = toISOStringLocal(UIElements.dvrEditEnd.value);

        const res = await apiFetch(`/api/dvr/jobs/${jobId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startTime, endTime })
        });
        if(res && res.ok) {
            showNotification('Recording schedule updated.');
            closeModal(UIElements.dvrEditModal);
            await loadScheduledJobs();
        }
    });
}

/**
 * Finds a scheduled DVR job for a specific program.
 * @param {object} program - The program object from the guide.
 * @returns {object|undefined} The DVR job if found, otherwise undefined.
 */
export function findDvrJobForProgram(program) {
    const programStart = new Date(program.start).getTime();
    const programStop = new Date(program.stop).getTime();
    
    return dvrState.scheduledJobs.find(job => {
        const jobProgramStart = new Date(job.startTime).getTime() + (job.preBufferMinutes * 60000);
        const jobProgramStop = new Date(job.endTime).getTime() - (job.postBufferMinutes * 60000);
        
        return job.channelId === program.channelId &&
               Math.abs(jobProgramStart - programStart) < 60000 && // Allow 1 min tolerance
               Math.abs(jobProgramStop - programStop) < 60000;
    });
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
                await loadScheduledJobs();
                handleSearchAndFilter(false);
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
            await loadScheduledJobs();
            handleSearchAndFilter(false);
        }
    }
}

/**
 * Navigates to the TV Guide and highlights a specific program.
 * @param {string} channelId - The ID of the channel.
 * @param {string} programStartIso - The ISO string of the program's start time.
 */
async function navigateToProgramInGuide(channelId, programStartIso) {
    navigate('/tvguide');
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const targetProgramStart = new Date(programStartIso);
    const currentGuideDate = new Date(guideState.currentDate);
    currentGuideDate.setHours(0, 0, 0, 0);

    if (targetProgramStart.toDateString() !== currentGuideDate.toDateString()) {
        guideState.currentDate = targetProgramStart;
        await handleSearchAndFilter(true);
    }

    const channelScrolled = await scrollToChannel(channelId);
    if (!channelScrolled) {
        showNotification("Could not find the channel in the guide.", false);
        return;
    }

    // Wait a moment for the smooth scroll and rendering to catch up
    setTimeout(() => {
        const programElement = UIElements.guideGrid.querySelector(`.programme-item[data-channel-id="${channelId}"][data-prog-start="${targetProgramStart.toISOString()}"]`);
        if (programElement) {
            const container = UIElements.guideContainer;
            const programRect = programElement.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            const desiredScrollLeft = container.scrollLeft + programRect.left - containerRect.left - (containerRect.width / 2) + (programRect.width / 2);
            container.scrollTo({ left: Math.max(0, desiredScrollLeft), behavior: 'smooth' });
            
            programElement.classList.add('highlighted-search');
            setTimeout(() => programElement.classList.remove('highlighted-search'), 3000);
        } else {
            showNotification("Could not find the specific program in the timeline.", false);
        }
    }, 500);
}


// --- Helper Functions ---

/**
 * Formats a number of bytes into a human-readable string (KB, MB, GB).
 * @param {number} bytes - The number of bytes.
 * @returns {string} The formatted string.
 */
function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Bytes';
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
    if (!totalSeconds) return '0m';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    let result = '';
    if (hours > 0) result += `${hours}h `;
    if (minutes > 0) result += `${minutes}m`;
    return result.trim() || '0m';
}
