/**
 * guide.js
 * * Manages all functionality related to the TV Guide,
 * including data loading, rendering, searching, and user interaction.
 *
 * REFACTORED to use UI Virtualization for high-performance rendering of large channel lists.
 */

import { appState, guideState, UIElements } from './state.js';
import { saveUserSetting, apiFetch } from './api.js'; // Added apiFetch
import { parseM3U } from './utils.js';
import { playChannel } from './player.js';
import { showNotification, openModal, closeModal } from './ui.js';
import { addOrRemoveNotification, findNotificationForProgram } from './notification.js';

// --- Virtualization Constants ---
const ROW_HEIGHT = 96; // Height in pixels of a single channel row (.channel-info + .timeline-row)
const OVERSCAN_COUNT = 5; // Number of extra rows to render above and below the visible area for smooth scrolling

// --- Data Loading and Processing ---

/**
 * Handles loading guide data from the server response.
 * For initial load, clears existing data. For subsequent loads (e.g., infinite scroll), merges new data.
 * @param {string} m3uContent - The M3U playlist content.
 * @param {object} epgContent - The parsed EPG JSON data.
 * @param {Date} dateLoadedFor - The specific date (start of day) this EPG content corresponds to.
 * @param {boolean} isInitialLoad - True if this is the very first load of the application.
 */
export function handleGuideLoad(m3uContent, epgContent, dateLoadedFor, isInitialLoad = false) {
    if (isInitialLoad) {
        guideState.channels = [];
        guideState.programCache = {}; // Clear program cache on initial full load
        guideState.loadedDates.clear(); // Clear loaded dates on initial full load
        // Populate channels from M3U content on initial load
        if (!m3uContent || m3uContent.trim() === '#EXTM3U') {
            guideState.channels = [];
        } else {
            guideState.channels = parseM3U(m3uContent);
        }
    }

    // Merge EPG content into the program cache
    if (epgContent) {
        // Mark the date as loaded
        const dateKey = dateLoadedFor.toISOString().slice(0, 10); // "YYYY-MM-DD"
        guideState.loadedDates.add(dateKey);

        for (const channelId in epgContent) {
            if (!guideState.programCache[channelId]) {
                guideState.programCache[channelId] = [];
            }
            // Filter out duplicates and merge
            const existingProgramStarts = new Set(guideState.programCache[channelId].map(p => p.start));
            epgContent[channelId].forEach(newProg => {
                if (!existingProgramStarts.has(newProg.start)) {
                    guideState.programCache[channelId].push(newProg);
                }
            });
            // Keep programs sorted by start time
            guideState.programCache[channelId].sort((a, b) => new Date(a.start) - new Date(b.start));
        }
    }

    // Cache the loaded data in IndexedDB (channels always, programs are incremental)
    if (appState.db) {
        appState.db.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.channels, 'channels');
        appState.db.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.programCache, 'programCache');
        appState.db.transaction(['guideData'], 'readwrite').objectStore('guideData').put(Array.from(guideState.loadedDates), 'loadedDates');
    }

    // Only finalize if not already doing so from another call
    if (!guideState.loadingEpgData) { // Prevent re-finalizing if background load is happening
        finalizeGuideLoad(isInitialLoad);
    }
}

/**
 * Finalizes the guide setup after data is loaded from any source (API or cache).
 * @param {boolean} isInitialAppLoad - Indicates if this is the initial load of the guide, to reset scroll.
 */
export function finalizeGuideLoad(isInitialAppLoad = false) {
    // Add favorite status to channels from user settings
    const favoriteIds = new Set(guideState.settings.favorites || []);
    guideState.channels.forEach(channel => {
        channel.isFavorite = favoriteIds.has(channel.id);
    });

    // Populate unique channel groups and sources for the filter dropdowns
    guideState.channelGroups.clear();
    guideState.channelSources.clear();
    guideState.channels.forEach(ch => {
        if (ch.group) guideState.channelGroups.add(ch.group);
        if (ch.source) guideState.channelSources.add(ch.source);
    });
    populateGroupFilter();
    populateSourceFilter();

    // Re-initialize Fuse.js for fuzzy searching channels
    appState.fuseChannels = new Fuse(guideState.channels, {
        keys: ['name', 'displayName', 'source', 'chno'],
        threshold: 0.4,
        includeScore: true,
    });

    // Prepare program data for searching (only programs from the currently viewed date range)
    const allProgramsForSearch = [];
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0); // Start of current selected day
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000); // End of current selected day's window

    for (const channelId in guideState.programCache) {
        const channel = guideState.channels.find(c => c.id === channelId);
        if (channel) {
            guideState.programCache[channelId].forEach(prog => {
                const progStart = new Date(prog.start);
                const progStop = new Date(prog.stop);
                // Only include programs within the current guide's *conceptual* view for search index
                if (progStop < guideStart || progStart > guideEnd) return;
                    
                allProgramsForSearch.push({
                    ...prog,
                    channel: {
                        id: channel.id,
                        name: channel.displayName || channel.name,
                        logo: channel.logo,
                        source: channel.source,
                    },
                    programId: `${channel.id}-${progStart.toISOString()}-${progStop.toISOString()}`
                });
            });
        }
    }

    // Re-initialize Fuse.js for fuzzy searching programs
    appState.fusePrograms = new Fuse(allProgramsForSearch, {
        keys: ['title'],
        threshold: 0.4,
        includeScore: true,
    });

    handleSearchAndFilter(isInitialAppLoad); // Pass isInitialAppLoad to control initial scroll
}

/**
 * Formats a Date object to "YYYY-MM-DD" string.
 * @param {Date} date - The date to format.
 * @returns {string} The formatted date string.
 */
const formatDateToKey = (date) => date.toISOString().slice(0, 10);

/**
 * Fetches EPG data for a specific date from the server.
 * @param {Date} date - The date for which to fetch EPG data.
 * @returns {Promise<object|null>} The EPG data, or null on failure.
 */
async function fetchEpgForDate(date) {
    const dateKey = formatDateToKey(date);
    if (guideState.loadedDates.has(dateKey) || guideState.loadingEpgData) {
        console.log(`[EPG_FETCH] EPG for ${dateKey} already loaded or currently loading. Skipping.`);
        return null;
    }

    guideState.loadingEpgData = true; // Set flag to prevent concurrent calls
    showNotification(`Loading guide data for ${dateKey}...`, false, 3000);

    try {
        // Request specific date's EPG data from the server.
        // We'll need a new API endpoint for this or modify the existing one.
        // For now, let's simulate by re-fetching config and filtering,
        // but ideally the backend would serve specific date ranges.
        // For infinite scroll, the backend would need to accept a date parameter.
        const response = await apiFetch(`/api/config?date=${dateKey}&t=${Date.now()}`); // Assuming backend can handle 'date' param
        if (!response || !response.ok) {
            throw new Error('Failed to fetch EPG data for date.');
        }
        const config = await response.json();
        
        // Ensure that config.epgContent only contains programs for the requested date.
        // This is a client-side filter for demonstration; ideally, backend handles this.
        const filteredEpgContent = {};
        if (config.epgContent) {
            const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
            const endOfDay = new Date(startOfDay.getTime() + 24 * 3600 * 1000);

            for (const channelId in config.epgContent) {
                filteredEpgContent[channelId] = config.epgContent[channelId].filter(prog => {
                    const progStart = new Date(prog.start);
                    const progStop = new Date(prog.stop);
                    return (progStart < endOfDay && progStop > startOfDay);
                });
            }
        }
        
        guideState.loadingEpgData = false;
        showNotification(`Guide data for ${dateKey} loaded.`);
        handleGuideLoad(config.m3uContent, filteredEpgContent, date); // Merge this new data
        return filteredEpgContent;
    } catch (error) {
        guideState.loadingEpgData = false;
        console.error(`[EPG_FETCH] Error fetching EPG for ${dateKey}:`, error);
        showNotification(`Failed to load guide data for ${dateKey}.`, true);
        return null;
    }
}


// --- UI Rendering (REFACTORED FOR VIRTUALIZATION & INFINITE SCROLL) ---

/**
 * Renders the guide using UI virtualization.
 * @param {Array<object>} channelsToRender - The filtered list of channels to display.
 * @param {boolean} resetScroll - If true, scrolls the guide to the top-left.
 */
const renderGuide = (channelsToRender, resetScroll = false) => {
    guideState.visibleChannels = channelsToRender;
    const totalRows = channelsToRender.length;
    const showNoData = totalRows === 0;

    // Toggle placeholder vs. guide content visibility
    UIElements.guidePlaceholder.classList.toggle('hidden', !showNoData);
    UIElements.noDataMessage.classList.toggle('hidden', !showNoData);
    UIElements.initialLoadingIndicator.classList.add('hidden');
    UIElements.guideGrid.classList.toggle('hidden', showNoData);
    if (showNoData) {
        UIElements.guideGrid.innerHTML = '';
        return;
    }

    // --- Static Header/Time Bar Setup (Done once per full render) ---
    // The "currentDate" here still represents the selected date (e.g., from date picker or prev/next day buttons)
    // For infinite scroll, the timeline itself will span multiple days.
    const guideDisplayStart = new Date(guideState.currentDate);
    guideDisplayStart.setHours(0, 0, 0, 0);
    const guideDisplayEnd = new Date(guideDisplayStart.getTime() + guideState.guideDurationHours * 3600 * 1000);

    UIElements.guideDateDisplay.textContent = guideState.currentDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });

    // Calculate the overall timeline width based on the range of *loaded* dates in `programCache`
    // This is a simplified approach for now. A more robust solution would track the min/max program times.
    let minTime = new Date(guideState.currentDate);
    minTime.setHours(0, 0, 0, 0); // Start from midnight of current day
    let maxTime = new Date(minTime.getTime() + guideState.guideDurationHours * 3600 * 1000); // End 48 hours later

    // Extend min/max based on loadedDates (for infinite scroll)
    if (guideState.loadedDates.size > 0) {
        const sortedLoadedDates = Array.from(guideState.loadedDates).sort();
        const earliestLoadedDateKey = sortedLoadedDates[0];
        const latestLoadedDateKey = sortedLoadedDates[sortedLoadedDates.length - 1];
        
        const earliestDate = new Date(earliestLoadedDateKey);
        earliestDate.setHours(0,0,0,0);
        const latestDate = new Date(latestLoadedDateKey);
        latestDate.setHours(23,59,59,999); // End of the latest loaded day

        minTime = new Date(Math.min(minTime.getTime(), earliestDate.getTime()));
        maxTime = new Date(Math.max(maxTime.getTime(), latestDate.getTime()));
    }

    const totalGuideHours = (maxTime.getTime() - minTime.getTime()) / 3600000;
    const timelineWidth = totalGuideHours * guideState.hourWidthPixels;
    UIElements.guideGrid.style.setProperty('--timeline-width', `${timelineWidth}px`);

    // Populate Time Bar (based on the full *logical* range of the timeline)
    const timeBarCellEl = UIElements.guideGrid.querySelector('.time-bar-cell');
    if (timeBarCellEl) {
        timeBarCellEl.innerHTML = '';
        const startOfTimebar = minTime; // Use the absolute start of the loaded timeline
        const endOfTimebar = maxTime;

        for (let i = startOfTimebar.getTime(); i < endOfTimebar.getTime(); i += 3600 * 1000) {
            const time = new Date(i);
            const left = ((time.getTime() - startOfTimebar.getTime()) / 3600000) * guideState.hourWidthPixels;
            timeBarCellEl.innerHTML += `<div class="absolute top-0 bottom-0 flex items-center justify-start px-2 text-xs text-gray-400 border-r border-gray-700/50" style="left: ${left}px; width: ${guideState.hourWidthPixels}px;">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
        }
        timeBarCellEl.style.width = `${timelineWidth}px`;
    }

    // --- Virtualization Setup ---
    const guideContainer = UIElements.guideContainer;
    const guideGrid = UIElements.guideGrid;

    let contentWrapper = guideGrid.querySelector('#virtual-content-wrapper');
    if (contentWrapper) {
        guideGrid.removeChild(contentWrapper);
    }

    contentWrapper = document.createElement('div');
    contentWrapper.id = 'virtual-content-wrapper';
    contentWrapper.style.gridColumn = '1 / -1';
    contentWrapper.style.position = 'relative';
    contentWrapper.style.height = `${totalRows * ROW_HEIGHT}px`;

    const rowContainer = document.createElement('div');
    rowContainer.id = 'virtual-row-container';
    rowContainer.style.position = 'absolute';
    rowContainer.style.width = '100%';
    rowContainer.style.top = '0';
    rowContainer.style.left = '0';
    rowContainer.style.display = 'grid';
    rowContainer.style.gridTemplateColumns = 'var(--channel-col-width, 180px) 1fr';

    contentWrapper.appendChild(rowContainer);
    guideGrid.appendChild(contentWrapper);

    // --- Core Virtualization Logic ---
    const updateVisibleRows = () => {
        if (!guideContainer) return;
        const scrollTop = guideContainer.scrollTop;
        const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_COUNT);
        const endIndex = Math.min(totalRows, Math.ceil((scrollTop + guideContainer.clientHeight) / ROW_HEIGHT) + OVERSCAN_COUNT);

        let rowsHTML = '';
        const sourceColors = ['bg-blue-600', 'bg-green-600', 'bg-pink-600', 'bg-yellow-500', 'bg-indigo-600', 'bg-red-600'];
        const sourceColorMap = new Map();
        let colorIndex = 0;

        // Determine the start time for calculating program positions relative to the *entire loaded timeline*
        const absoluteTimelineStart = minTime;

        for (let i = startIndex; i < endIndex; i++) {
            const channel = channelsToRender[i];
            const channelName = channel.displayName || channel.name;

            if (!sourceColorMap.has(channel.source)) {
                sourceColorMap.set(channel.source, sourceColors[colorIndex % sourceColors.length]);
                colorIndex++;
            }
            const sourceBadgeColor = sourceColorMap.get(channel.source);
            const sourceBadgeHTML = guideState.channelSources.size > 1 ? `<span class="source-badge ${sourceBadgeColor} text-white">${channel.source}</span>` : '';
            const chnoBadgeHTML = channel.chno ? `<span class="chno-badge">${channel.chno}</span>` : '';

            const channelInfoHTML = `
                <div class="channel-info p-2 flex items-center justify-between cursor-pointer" data-url="${channel.url}" data-name="${channelName}" data-id="${channel.id}">
                    <div class="flex items-center overflow-hidden flex-grow min-w-0">
                        <img src="${channel.logo}" onerror="this.onerror=null; this.src='https://placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-3 flex-shrink-0 rounded-md bg-gray-700">
                        <div class="flex-grow min-w-0 channel-details">
                            <span class="font-semibold text-sm truncate block">${channelName}</span>
                            <div class="flex items-center gap-2 mt-1">
                                ${chnoBadgeHTML}
                                ${sourceBadgeHTML}
                            </div>
                        </div>
                    </div>
                    <svg data-channel-id="${channel.id}" class="w-6 h-6 text-gray-500 hover:text-yellow-400 favorite-star cursor-pointer flex-shrink-0 ml-2 ${channel.isFavorite ? 'favorited' : ''}" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8-2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
                </div>
            `;

            let programsHTML = '';
            const now = new Date();
            // Programs are rendered based on their position relative to the absolute start of the loaded timeline
            (guideState.programCache[channel.id] || []).forEach(prog => {
                const progStart = new Date(prog.start);
                const progStop = new Date(prog.stop);
                
                // Only render programs that are actually within the total loaded time span
                if (progStop.getTime() < absoluteTimelineStart.getTime() || progStart.getTime() > maxTime.getTime()) return;

                const durationMs = progStop.getTime() - progStart.getTime();
                if (durationMs <= 0) return;

                // Calculate position relative to the absolute start of the entire virtual timeline
                const left = ((progStart.getTime() - absoluteTimelineStart.getTime()) / 3600000) * guideState.hourWidthPixels;
                const width = (durationMs / 3600000) * guideState.hourWidthPixels;
                const isLive = now >= progStart && now < progStop;
                const progressWidth = isLive ? ((now - progStart) / durationMs) * 100 : 0;
                
                const uniqueProgramId = `${channel.id}-${progStart.toISOString()}-${progStop.toISOString()}`;

                const hasNotification = guideState.userNotifications.some(n =>
                    n.channelId === channel.id &&
                    n.programId === uniqueProgramId
                );
                const notificationClass = hasNotification ? 'has-notification' : '';

                programsHTML += `<div class="programme-item absolute top-1 bottom-1 bg-gray-800 rounded-md p-2 overflow-hidden flex flex-col justify-center z-5 ${isLive ? 'live' : ''} ${progStop < now ? 'past' : ''} ${notificationClass}" style="left:${left}px; width:${Math.max(0, width - 2)}px" data-channel-url="${channel.url}" data-channel-id="${channel.id}" data-channel-name="${channelName}" data-prog-title="${prog.title}" data-prog-desc="${prog.desc}" data-prog-start="${progStart.toISOString()}" data-prog-stop="${progStop.toISOString()}" data-prog-id="${uniqueProgramId}"><div class="programme-progress" style="width:${progressWidth}%"></div><p class="prog-title text-white font-semibold truncate relative z-10">${prog.title}</p><p class="prog-time text-gray-400 truncate relative z-10">${progStart.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</p></div>`;
            });
            const timelineRowHTML = `<div class="timeline-row" style="width: ${timelineWidth}px;">${programsHTML}</div>`;

            rowsHTML += channelInfoHTML + timelineRowHTML;
        }

        rowContainer.innerHTML = rowsHTML;
        rowContainer.style.transform = `translateY(${startIndex * ROW_HEIGHT}px)`;

        // Check for infinite scroll boundaries
        const scrollLeft = guideContainer.scrollLeft;
        const scrollWidth = guideContainer.scrollWidth;
        const clientWidth = guideContainer.clientWidth;

        const scrollThreshold = 0.15; // 15% from either end

        // Load previous day
        if (scrollLeft < scrollWidth * scrollThreshold && !guideState.loadingEpgData) {
            const firstLoadedDate = new Date(Array.from(guideState.loadedDates).sort()[0]);
            const prevDay = new Date(firstLoadedDate);
            prevDay.setDate(prevDay.getDate() - 1);
            console.log(`[INFINITE_SCROLL] Nearing left edge, loading previous day: ${formatDateToKey(prevDay)}`);
            fetchEpgForDate(prevDay).then(() => {
                // Adjust scroll position to account for new content prepended
                const oldScrollWidth = scrollWidth;
                const newScrollWidth = (totalGuideHours + 24) * guideState.hourWidthPixels; // Assuming 24 more hours
                guideContainer.scrollLeft += (newScrollWidth - oldScrollWidth);
            });
        }
        // Load next day
        else if (scrollLeft + clientWidth > scrollWidth * (1 - scrollThreshold) && !guideState.loadingEpgData) {
            const lastLoadedDate = new Date(Array.from(guideState.loadedDates).sort().reverse()[0]);
            const nextDay = new Date(lastLoadedDate);
            nextDay.setDate(nextDay.getDate() + 1);
            console.log(`[INFINITE_SCROLL] Nearing right edge, loading next day: ${formatDateToKey(nextDay)}`);
            fetchEpgForDate(nextDay);
        }
    };

    // Attach scroll listener
    if (guideState.scrollHandler) {
        guideContainer.removeEventListener('scroll', guideState.scrollHandler);
    }
    guideState.scrollHandler = throttle(updateVisibleRows, 16); // Throttle to roughly 60fps
    guideContainer.addEventListener('scroll', guideState.scrollHandler);

    // Initial render and positioning
    if (isInitialAppLoad) { // Only reset scroll on true initial app load or explicit jump-to-now
        guideContainer.scrollTop = 0;
        // Position the timeline to center on 'Now' or the current day if possible
        const now = new Date();
        const nowTimeOffsetPixels = ((now.getTime() - minTime.getTime()) / 3600000) * guideState.hourWidthPixels;
        const channelInfoColWidth = guideState.settings.channelColumnWidth;
        const scrollLeft = nowTimeOffsetPixels - (guideContainer.clientWidth / 2) + (channelInfoColWidth / 2);
        guideContainer.scrollLeft = Math.max(0, scrollLeft);
    } else if (resetScroll) { // For "Now" button
         guideContainer.scrollTop = 0;
         const now = new Date();
         const nowTimeOffsetPixels = ((now.getTime() - minTime.getTime()) / 3600000) * guideState.hourWidthPixels;
         const channelInfoColWidth = guideState.settings.channelColumnWidth;
         const scrollLeft = nowTimeOffsetPixels - (guideContainer.clientWidth / 2) + (channelInfoColWidth / 2);
         guideContainer.scrollLeft = Math.max(0, scrollLeft);
    }

    updateNowLine(minTime, isInitialAppLoad || resetScroll); // Pass minTime for nowLine calculation
};

/**
 * Updates the position of the "now" line and program states (live, past).
 * @param {Date} absoluteTimelineStart - The absolute start time of the entire loaded timeline in UTC.
 * @param {boolean} shouldScroll - If true, scrolls the timeline to the now line.
 */
const updateNowLine = (absoluteTimelineStart, shouldScroll = false) => {
    const nowLineEl = document.getElementById('now-line');
    if (!nowLineEl) return;

    const now = new Date();
    const nowValue = now.getTime(); // Use getTime() for milliseconds

    // Calculate total loaded duration for now-line visibility
    let maxTimeForNowLine = new Date(absoluteTimelineStart.getTime() + guideState.guideDurationHours * 3600 * 1000);
    if (guideState.loadedDates.size > 0) {
        const latestLoadedDateKey = Array.from(guideState.loadedDates).sort().reverse()[0];
        const latestDate = new Date(latestLoadedDateKey);
        latestDate.setHours(23,59,59,999);
        maxTimeForNowLine = new Date(Math.max(maxTimeForNowLine.getTime(), latestDate.getTime()));
    }


    const channelInfoColWidth = guideState.settings.channelColumnWidth;

    if (nowValue >= absoluteTimelineStart.getTime() && nowValue <= maxTimeForNowLine.getTime()) {
        const leftOffsetInScrollableArea = ((nowValue - absoluteTimelineStart.getTime()) / 3600000) * guideState.hourWidthPixels;
        nowLineEl.style.left = `${channelInfoColWidth + leftOffsetInScrollableArea}px`;
        nowLineEl.classList.remove('hidden');
        if (shouldScroll) {
            // Add a short delay to ensure the guide content has rendered before scrolling
            setTimeout(() => {
                const isMobile = window.innerWidth < 768; 
                let scrollLeft;

                if (isMobile) {
                    scrollLeft = (channelInfoColWidth + leftOffsetInScrollableArea) - (UIElements.guideContainer.clientWidth / 2);
                } else {
                    scrollLeft = leftOffsetInScrollableArea - (UIElements.guideContainer.clientWidth / 4);
                }
                
                UIElements.guideContainer.scrollTo({
                    left: Math.max(0, scrollLeft),
                    behavior: 'smooth'
                });
            }, 500);
        }        
    } else {
        nowLineEl.classList.add('hidden');
    }
    
    // Now line height should cover the full virtualized height
    const contentWrapper = UIElements.guideGrid.querySelector('#virtual-content-wrapper');
    nowLineEl.style.height = `${contentWrapper?.scrollHeight || UIElements.guideContainer.scrollHeight}px`;


    // Update progress bars only on visible items for performance
    document.querySelectorAll('.programme-item').forEach(item => {
        const progStart = new Date(item.dataset.progStart);
        const progStop = new Date(item.dataset.progStop);
        const isLive = now >= progStart && now < progStop;
        item.classList.toggle('live', isLive);
        item.classList.toggle('past', now >= progStop);

        const progressEl = item.querySelector('.programme-progress');
        if (progressEl) {
            progressEl.style.width = isLive ? `${((now - progStart) / (progStop - progStart)) * 100}%` : '0%';
        }
    });

    // Schedule next update for the "now" line
    setTimeout(() => updateNowLine(absoluteTimelineStart, false), 60000);
};

// --- Filtering and Searching ---

/**
 * Populates the "group" filter dropdown.
 */
const populateGroupFilter = () => {
    const currentVal = UIElements.groupFilter.value;
    UIElements.groupFilter.innerHTML = `<option value="all">All Groups</option><option value="recents">Recents</option><option value="favorites">Favorites</option>`;
    [...guideState.channelGroups].sort((a, b) => a.localeCompare(b)).forEach(group => {
        const cleanGroup = group.replace(/"/g, '&quot;');
        UIElements.groupFilter.innerHTML += `<option value="${cleanGroup}">${group}</option>`;
    });
    // Restore previous selection if possible
    UIElements.groupFilter.value = currentVal && UIElements.groupFilter.querySelector(`option[value="${currentVal.replace(/"/g, '&quot;')}"]`) ? currentVal : 'all';
    UIElements.groupFilter.classList.remove('hidden');
};

/**
 * Populates the "source" filter dropdown.
 */
const populateSourceFilter = () => {
    const currentVal = UIElements.sourceFilter.value;
    UIElements.sourceFilter.innerHTML = `<option value="all">All Sources</option>`;
    [...guideState.channelSources].sort((a, b) => a.localeCompare(b)).forEach(source => {
        const cleanSource = source.replace(/"/g, '&quot;');
        UIElements.sourceFilter.innerHTML += `<option value="${cleanSource}">${source}</option>`;
    });
    UIElements.sourceFilter.value = currentVal && UIElements.sourceFilter.querySelector(`option[value="${currentVal.replace(/"/g, '&quot;')}"]`) ? currentVal : 'all';

    UIElements.sourceFilter.classList.remove('hidden');
    // Only show the source filter if there's more than one source
    UIElements.sourceFilter.style.display = guideState.channelSources.size <= 1 ? 'none' : 'block';
};

/**
 * Filters channels based on dropdowns and rerenders the guide.
 * @param {boolean} resetScroll - Indicates if the guide should reset its horizontal scroll.
 */
export function handleSearchAndFilter(resetScroll = false) {
    const searchTerm = UIElements.searchInput.value.trim();
    const selectedGroup = UIElements.groupFilter.value;
    const selectedSource = UIElements.sourceFilter.value;
    let channelsForGuide = guideState.channels;

    // Apply group filter
    if (selectedGroup !== 'all') {
        if (selectedGroup === 'favorites') {
            const favoriteIds = new Set(guideState.settings.favorites || []);
            channelsForGuide = channelsForGuide.filter(ch => favoriteIds.has(ch.id));
        } else if (selectedGroup === 'recents') {
            const recentIds = guideState.settings.recentChannels || [];
            channelsForGuide = recentIds.map(id => channelsForGuide.find(ch => ch.id === id)).filter(Boolean);
        } else {
            channelsForGuide = channelsForGuide.filter(ch => ch.group === selectedGroup);
        }
    }

    // Apply source filter
    if (selectedSource !== 'all') {
        channelsForGuide = channelsForGuide.filter(ch => ch.source === selectedSource);
    }

    // Apply search term
    if (searchTerm && appState.fuseChannels && appState.fusePrograms) {
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        // A simple 'includes' filter for quick results before showing Fuse results
        channelsForGuide = channelsForGuide.filter(ch =>
            (ch.displayName || ch.name).toLowerCase().includes(lowerCaseSearchTerm) ||
            (ch.source && ch.source.toLowerCase().includes(lowerCaseSearchTerm)) ||
            (ch.chno && ch.chno.toLowerCase().includes(lowerCaseSearchTerm))
        );

        const channelResults = appState.fuseChannels.search(searchTerm).slice(0, 10);

        let programResults = [];
        if (guideState.settings.searchScope === 'channels_programs') {
            programResults = appState.fusePrograms.search(searchTerm).slice(0, 20);
        }
        renderSearchResults(channelResults, programResults);
    } else {
        // Hide search results if search term is empty
        UIElements.searchResultsContainer.innerHTML = '';
        UIElements.searchResultsContainer.classList.add('hidden');
    }

    renderGuide(channelsForGuide, resetScroll);
};

/**
 * Renders the search results dropdown.
 * @param {Array} channelResults - Results from Fuse.js channel search.
 * @param {Array} programResults - Results from Fuse.js program search.
 */
const renderSearchResults = (channelResults, programResults) => {
    let html = '';

    if (channelResults.length > 0) {
        html += '<div class="search-results-header">Channels</div>';
        html += channelResults.map(({ item }) => `
            <div class="search-result-channel flex items-center p-3 border-b border-gray-700/50 hover:bg-gray-700 cursor-pointer" data-channel-id="${item.id}">
                <img src="${item.logo}" onerror="this.onerror=null; this.src='https://placehold.co/40x40/1f2937/d1d5db?text=?';" class="w-10 h-10 object-contain mr-3 rounded-md bg-gray-700 flex-shrink-0">
                <div class="overflow-hidden">
                    <p class="font-semibold text-white text-sm truncate">${item.chno ? `[${item.chno}] ` : ''}${item.displayName || item.name}</p>
                    <p class="text-gray-400 text-xs truncate">${item.group} &bull; ${item.source}</p>
                </div>
            </div>
        `).join('');
    }

    if (programResults.length > 0) {
        html += '<div class="search-results-header">Programs</div>';
        const timeFormat = { hour: '2-digit', minute: '2-digit' };
        html += programResults.map(({ item }) => `
             <div class="search-result-program flex items-center p-3 border-b border-gray-700/50 hover:bg-gray-700 cursor-pointer" data-channel-id="${item.channel.id}" data-prog-start="${item.start}">
                <img src="${item.channel.logo}" onerror="this.onerror=null; this.src='https://placehold.co/40x40/1f2937/d1d5db?text=?';" class="w-10 h-10 object-contain mr-3 rounded-md bg-gray-700 flex-shrink-0">
                <div class="overflow-hidden">
                    <p class="font-semibold text-white text-sm truncate" title="${item.title}">${item.title}</p>
                    <p class="text-gray-400 text-xs truncate">${item.channel.name} &bull; ${item.channel.source}</p>
                    <p class="text-blue-400 text-xs">${new Date(item.start).toLocaleTimeString([], timeFormat)} - ${new Date(item.stop).toLocaleTimeString([], timeFormat)}</p>
                </div>
            </div>
        `).join('');
    }

    if (html) {
        UIElements.searchResultsContainer.innerHTML = html;
        UIElements.searchResultsContainer.classList.remove('hidden');
    } else {
        UIElements.searchResultsContainer.innerHTML = '<p class="text-center text-gray-500 p-4 text-sm">No results found.</p>';
        UIElements.searchResultsContainer.classList.remove('hidden');
    }
};

/**
 * A utility function to limit the execution of a function to once every specified time limit.
 * @param {Function} func The function to throttle.
 * @param {number} limit The time limit in milliseconds.
 * @returns {Function} The throttled function.
 */
const throttle = (func, limit) => {
    let inThrottle;
    let lastFunc;
    let lastRan;
    return function() {
        const context = this;
        const args = arguments;
        if (!lastRan) {
            func.apply(context, args);
            lastRan = Date.now();
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(function() {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, limit - (Date.now() - lastRan));
        }
    };
};

// --- Event Listeners ---

/**
 * Sets up all event listeners for the guide page.
 */
export function setupGuideEventListeners() {
    // --- Filtering and Searching ---
    UIElements.groupFilter.addEventListener('change', () => handleSearchAndFilter());
    UIElements.sourceFilter.addEventListener('change', () => handleSearchAndFilter());
    UIElements.searchInput.addEventListener('input', () => {
        clearTimeout(appState.searchDebounceTimer);
        appState.searchDebounceTimer = setTimeout(() => handleSearchAndFilter(false), 250);
    });
    // Hide search results when clicking outside
    document.addEventListener('click', e => {
        if (!UIElements.searchInput.contains(e.target) && !UIElements.searchResultsContainer.contains(e.target) && !e.target.closest('.search-result-channel') && !e.target.closest('.search-result-program')) {
            UIElements.searchResultsContainer.classList.add('hidden');
        }
    });

    // --- Date Navigation ---
    UIElements.prevDayBtn.addEventListener('click', () => {
        guideState.currentDate.setDate(guideState.currentDate.getDate() - 1);
        handleSearchAndFilter(true); // Reset scroll on date change
    });
    UIElements.nowBtn.addEventListener('click', () => {
        const now = new Date();
        if (guideState.currentDate.toDateString() !== now.toDateString()) {
            guideState.currentDate = now;
        }
        handleSearchAndFilter(true); // Reset scroll on "Now"
    });
    UIElements.nextDayBtn.addEventListener('click', () => {
        guideState.currentDate.setDate(guideState.currentDate.getDate() + 1);
        handleSearchAndFilter(true); // Reset scroll on date change
    });
    
    // NEW: Jump to Date Picker
    UIElements.jumpToDateBtn.addEventListener('click', () => {
        UIElements.datePickerInput.value = formatDateToKey(guideState.currentDate); // Set initial value
        UIElements.datePickerInput.showPicker(); // Open the native date picker
    });

    UIElements.datePickerInput.addEventListener('change', (e) => {
        const selectedDate = new Date(e.target.value);
        if (!isNaN(selectedDate.getTime())) { // Check for valid date
            guideState.currentDate = selectedDate;
            handleSearchAndFilter(true); // Re-render and reset scroll to start of selected day
        }
    });


    // --- Interactions (Clicks on the new grid) ---
    UIElements.guideGrid.addEventListener('click', (e) => {
        const favoriteStar = e.target.closest('.favorite-star');
        const channelInfo = e.target.closest('.channel-info');
        const progItem = e.target.closest('.programme-item');

        if (favoriteStar) {
            e.stopPropagation();
            const channelId = favoriteStar.dataset.channelId;
            const channel = guideState.channels.find(c => c.id === channelId);
            if (!channel) return;

            channel.isFavorite = !channel.isFavorite;
            favoriteStar.classList.toggle('favorited', channel.isFavorite);

            guideState.settings.favorites = guideState.channels.filter(c => c.isFavorite).map(c => c.id);
            saveUserSetting('favorites', guideState.settings.favorites);

            if (UIElements.groupFilter.value === 'favorites') {
                handleSearchAndFilter();
            }
            return;
        }

        if (channelInfo) {
            playChannel(channelInfo.dataset.url, channelInfo.dataset.name, channelInfo.dataset.id);
        }

        if (progItem) {
            const channelId = progItem.dataset.channelId;
            const programData = {
                title: progItem.dataset.progTitle,
                desc: progItem.dataset.progDesc,
                start: progItem.dataset.progStart,
                stop: progItem.dataset.progStop,
                channelId: channelId,
                programId: progItem.dataset.progId,
            };

            const channelData = guideState.channels.find(c => c.id === channelId);
            const channelName = channelData ? (channelData.displayName || channelData.name) : 'Unknown Channel';
            const channelLogo = channelData ? channelData.logo : '';
            const channelUrl = channelData ? channelData.url : '';

            UIElements.detailsTitle.textContent = programData.title;
            const progStart = new Date(programData.start);
            const progStop = new Date(programData.stop);
            UIElements.detailsTime.textContent = `${progStart.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}`;
            UIElements.detailsDesc.textContent = programData.desc || "No description available.";
            
            UIElements.detailsPlayBtn.onclick = () => {
                playChannel(channelUrl, channelName, channelId);
                closeModal(UIElements.programDetailsModal);
            };

            const now = new Date();
            const programStopTime = new Date(programData.stop).getTime();
            const isProgramRelevantForNotification = programStopTime > now.getTime();
            
            const notification = findNotificationForProgram(programData, channelId);

            if (isProgramRelevantForNotification) {
                UIElements.programDetailsNotifyBtn.classList.remove('hidden');
                // Ensure text and class changes don't cause layout shifts
                if (notification) {
                    UIElements.programDetailsNotifyBtn.textContent = 'Notification Set';
                    UIElements.programDetailsNotifyBtn.classList.remove('bg-yellow-600', 'hover:bg-yellow-700');
                    UIElements.programDetailsNotifyBtn.classList.add('bg-gray-600', 'hover:bg-gray-500');
                } else {
                    UIElements.programDetailsNotifyBtn.textContent = 'Notify Me';
                    UIElements.programDetailsNotifyBtn.classList.remove('bg-gray-600', 'hover:bg-gray-500');
                    UIElements.programDetailsNotifyBtn.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
                }
                UIElements.programDetailsNotifyBtn.disabled = !notification && Notification.permission === 'denied';

                UIElements.programDetailsNotifyBtn.onclick = async () => {
                    await addOrRemoveNotification({
                        id: notification ? notification.id : null,
                        channelId: programData.channelId,
                        channelName: channelName,
                        channelLogo: channelLogo,
                        programTitle: programData.title,
                        programStart: programData.start,
                        programStop: programData.stop,
                        programDesc: programData.desc,
                        programId: programData.programId
                    });
                    // Re-render button state after action
                    const updatedNotification = findNotificationForProgram(programData, channelId);
                    if (updatedNotification) {
                        UIElements.programDetailsNotifyBtn.textContent = 'Notification Set';
                        UIElements.programDetailsNotifyBtn.classList.remove('bg-yellow-600', 'hover:bg-yellow-700');
                        UIElements.programDetailsNotifyBtn.classList.add('bg-gray-600', 'hover:bg-gray-500');
                    } else {
                        UIElements.programDetailsNotifyBtn.textContent = 'Notify Me';
                        UIElements.programDetailsNotifyBtn.classList.remove('bg-gray-600', 'hover:bg-gray-500');
                        UIElements.programDetailsNotifyBtn.classList.add('bg-yellow-600', 'hover:bg-yellow-700');
                    }
                    UIElements.programDetailsNotifyBtn.disabled = !updatedNotification && Notification.permission === 'denied';
                    handleSearchAndFilter(false); 
                };
            } else {
                UIElements.programDetailsNotifyBtn.classList.add('hidden');
            }

            openModal(UIElements.programDetailsModal);
        }
    });

    // --- Search Results Click ---
    UIElements.searchResultsContainer.addEventListener('click', e => {
        const programItem = e.target.closest('.search-result-program');
        const channelItem = e.target.closest('.search-result-channel');

        UIElements.searchResultsContainer.classList.add('hidden');
        UIElements.searchInput.value = '';

        if (channelItem) {
            const channelId = channelItem.dataset.channelId;
            const channelIndex = guideState.visibleChannels.findIndex(c => c.id === channelId);
            if (channelIndex > -1) {
                // Scroll to the item's virtual position
                UIElements.guideContainer.scrollTo({ top: channelIndex * ROW_HEIGHT, behavior: 'smooth' });

                // Highlight after scroll
                setTimeout(() => {
                    const channelRow = UIElements.guideGrid.querySelector(`.channel-info[data-id="${channelId}"]`);
                    if (channelRow) {
                        channelRow.style.transition = 'background-color 0.5s';
                        channelRow.style.backgroundColor = '#3b82f6'; // Highlight
                        setTimeout(() => { channelRow.style.backgroundColor = ''; }, 2000);
                    }
                }, 500); // Wait for scroll to finish
            }
        } else if (programItem) {
             const progStart = new Date(programItem.dataset.progStart);
             const guideStart = new Date(guideState.currentDate);
             guideStart.setHours(0,0,0,0);

             const dateDiff = Math.floor((progStart - guideStart) / (1000 * 60 * 60 * 24));
             if (dateDiff !== 0) {
                 guideState.currentDate.setDate(guideState.currentDate.getDate() + dateDiff);
                 finalizeGuideLoad();
             }

            setTimeout(() => {
                const programElement = UIElements.guideGrid.querySelector(`.programme-item[data-prog-start="${programItem.dataset.progStart}"][data-channel-id="${programItem.dataset.channelId}"]`);
                if(programElement) {
                    // Recalculate offset based on potentially expanded timeline
                    let minTime = new Date(guideState.currentDate);
                    minTime.setHours(0,0,0,0);
                    if (guideState.loadedDates.size > 0) {
                        minTime = new Date(Math.min(minTime.getTime(), new Date(Array.from(guideState.loadedDates).sort()[0]).setHours(0,0,0,0)));
                    }
                    const programAbsoluteOffset = ((new Date(programItem.dataset.progStart).getTime() - minTime.getTime()) / 3600000) * guideState.hourWidthPixels;

                    const scrollLeft = programAbsoluteOffset - (UIElements.guideContainer.clientWidth / 4);
                    UIElements.guideContainer.scrollTo({ left: scrollLeft, behavior: 'smooth' });

                    programElement.style.transition = 'outline 0.5s';
                    programElement.style.outline = '3px solid #facc15';
                    setTimeout(() => { programElement.style.outline = 'none'; }, 2500);
                }
            }, 200);
        }
    });

    // --- Scroll event for header visibility ---
    let lastScrollTop = 0;
    let initialHeaderHeight = 0;

    const calculateInitialHeaderHeight = () => {
        let height = 0;
        if (UIElements.mainHeader) height += UIElements.mainHeader.offsetHeight;
        if (UIElements.unifiedGuideHeader) height += UIElements.unifiedGuideHeader.offsetHeight;
        return height;
    };

    const handleScrollHeader = throttle(() => {
        if (!UIElements.guideContainer || !UIElements.appContainer || !UIElements.pageGuide) {
            return;
        }

        const scrollTop = UIElements.guideContainer.scrollTop;
        const scrollDirection = scrollTop > lastScrollTop ? 'down' : 'up';

        if (initialHeaderHeight === 0) {
            initialHeaderHeight = calculateInitialHeaderHeight();
        }

        const collapseThreshold = initialHeaderHeight * 0.5;

        if (scrollDirection === 'down' && scrollTop > collapseThreshold) {
            UIElements.appContainer.classList.add('header-collapsed');
        } else if (scrollDirection === 'up' && scrollTop <= collapseThreshold / 2) {
            UIElements.appContainer.classList.remove('header-collapsed');
        }
        lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
    }, 100);

    UIElements.guideContainer.addEventListener('scroll', handleScrollHeader);
}
