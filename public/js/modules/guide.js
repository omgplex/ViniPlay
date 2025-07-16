/**
 * guide.js
 * * Manages all functionality related to the TV Guide,
 * including data loading, rendering, searching, and user interaction.
 */

import { appState, guideState, UIElements } from './state.js';
import { saveUserSetting } from './api.js';
import { parseM3U } from './utils.js';
import { playChannel } from './player.js';
import { showNotification, openModal, closeModal } from './ui.js';

// Constants for virtualization
const ROW_HEIGHT = appState.virtualScroll.rowHeight; // Height of each channel/program row
const BUFFER_ROWS = appState.virtualScroll.bufferRows; // Rows to render above and below viewport

// --- Data Loading and Processing ---

/**
 * Handles loading guide data from the server response.
 * @param {string} m3uContent - The M3U playlist content.
 * @param {object} epgContent - The parsed EPG JSON data.
 */
export function handleGuideLoad(m3uContent, epgContent) {
    if (!m3uContent || m3uContent.trim() === '#EXTM3U') {
        guideState.channels = [];
        guideState.programs = {};
    } else {
        guideState.channels = parseM3U(m3uContent);
        guideState.programs = epgContent || {};
    }

    // Cache the loaded data in IndexedDB
    // This is a "fire and forget" operation for performance
    appState.db?.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.channels, 'channels');
    appState.db?.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.programs, 'programs');

    finalizeGuideLoad(true);
}

/**
 * Finalizes the guide setup after data is loaded from any source (API or cache).
 * @param {boolean} isFirstLoad - Indicates if this is the initial load of the guide.
 */
export function finalizeGuideLoad(isFirstLoad = false) {
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

    // Initialize Fuse.js for fuzzy searching channels
    appState.fuseChannels = new Fuse(guideState.channels, {
        keys: ['name', 'displayName', 'source', 'chno'],
        threshold: 0.4,
        includeScore: true,
    });

    // Prepare program data for searching
    const allPrograms = [];
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);

    for (const channelId in guideState.programs) {
        const channel = guideState.channels.find(c => c.id === channelId);
        if (channel) {
            guideState.programs[channelId].forEach(prog => {
                const progStart = new Date(prog.start);
                const progStop = new Date(prog.stop);
                // Only include programs within the current guide view
                if (progStop > guideStart && progStart < guideEnd) {
                    allPrograms.push({
                        ...prog,
                        channel: {
                            id: channel.id,
                            name: channel.displayName || channel.name,
                            logo: channel.logo,
                            source: channel.source,
                        }
                    });
                }
            });
        }
    }
    
    // Initialize Fuse.js for fuzzy searching programs
    appState.fusePrograms = new Fuse(allPrograms, {
        keys: ['title'],
        threshold: 0.4,
        includeScore: true,
    });

    handleSearchAndFilter(isFirstLoad);
}

// --- UI Rendering ---

/**
 * Renders the entire TV guide grid. This function sets up the overall grid structure
 * and triggers the virtualized rendering.
 * @param {Array<object>} channelsToRender - The filtered list of channels to display.
 * @param {boolean} resetScroll - If true, scrolls the guide to the top-left.
 */
const renderGuide = (channelsToRender, resetScroll = false) => {
    guideState.visibleChannels = channelsToRender; // This is the filtered list, not yet the rendered (visible) list
    const showNoData = guideState.channels.length === 0;

    // Toggle placeholder vs. guide content visibility
    UIElements.guidePlaceholder.classList.toggle('hidden', !showNoData);
    UIElements.noDataMessage.classList.toggle('hidden', !showNoData);
    UIElements.initialLoadingIndicator.classList.add('hidden');
    UIElements.guideGridMain.classList.toggle('hidden', showNoData); // Use guideGridMain
    if (showNoData) {
        UIElements.channelListInner.innerHTML = '';
        UIElements.timelineInner.innerHTML = '';
        return;
    }

    // Capture current scroll positions before re-rendering
    // Note: Scroll is now handled by guide-container, not guide-grid-main
    const currentScrollLeft = UIElements.guideContainer.scrollLeft;
    const currentScrollTop = UIElements.guideContainer.scrollTop;

    // Update date display in the unified header
    UIElements.guideDateDisplay.textContent = guideState.currentDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });
    
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);

    const timelineWidth = guideState.guideDurationHours * guideState.hourWidthPixels;
    
    // Set CSS variable for grid-template-columns width, using stored value if available
    const initialChannelColWidth = guideState.settings.channelColumnWidth || (window.innerWidth < 768 ? 64 : 180);
    UIElements.guideGridMain.style.setProperty('--channel-col-width', `${initialChannelColWidth}px`);
    
    // Set the overall width of the timeline content within the timeline-inner container
    UIElements.timelineInner.style.width = `${timelineWidth}px`;
    UIElements.timeBarCell.style.width = `${timelineWidth}px`;


    // 1. Render Sticky Corner and Time Bar Row
    // Populate the time bar
    if (UIElements.timeBarCell) {
        let timeBarHTML = '';
        for (let i = 0; i < guideState.guideDurationHours; i++) {
            const time = new Date(guideStart);
            time.setHours(guideStart.getHours() + i);
            timeBarHTML += `<div class="absolute top-0 bottom-0 flex items-center justify-start px-2 text-xs text-gray-400 border-r border-gray-700/50" style="left: ${i * guideState.hourWidthPixels}px; width: ${guideState.hourWidthPixels}px;">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
        }
        UIElements.timeBarCell.innerHTML = timeBarHTML;
    }

    // Populate the sticky corner (where date navigation and resize handle reside)
    if (UIElements.stickyCorner) {
        // Clear only the dynamic content, preserve the resize handle if it exists
        const existingHandle = UIElements.stickyCorner.querySelector('.channel-resize-handle');
        UIElements.stickyCorner.innerHTML = `
            <div class="flex items-center gap-2">
                <button id="prev-day-btn" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-3 rounded-md text-sm transition-colors">&lt;</button>
                <button id="now-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded-md text-sm transition-colors">Now</button>
                <button id="next-day-btn" class="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-3 rounded-md text-sm transition-colors">&gt;</button>
            </div>
        `;
        if (existingHandle) UIElements.stickyCorner.appendChild(existingHandle); // Re-append the handle

        // After rendering, re-bind event listeners for the newly created buttons inside sticky-corner
        // These elements need to be re-queried as they are part of innerHTML assignment
        const prevDayBtn = UIElements.stickyCorner.querySelector('#prev-day-btn');
        const nowBtn = UIElements.stickyCorner.querySelector('#now-btn');
        const nextDayBtn = UIElements.stickyCorner.querySelector('#next-day-btn');

        if (prevDayBtn) prevDayBtn.addEventListener('click', () => {
            guideState.currentDate.setDate(guideState.currentDate.getDate() - 1);
            finalizeGuideLoad();
        });
        if (nowBtn) nowBtn.addEventListener('click', () => {
            const now = new Date();
            if (guideState.currentDate.toDateString() !== now.toDateString()) {
                guideState.currentDate = now;
                finalizeGuideLoad(true);
            } else {
                updateNowLineAndScroll(guideStart, true); // Use the new function for 'Now'
            }
        });
        if (nextDayBtn) nextDayBtn.addEventListener('click', () => {
            guideState.currentDate.setDate(guideState.currentDate.getDate() + 1);
            finalizeGuideLoad();
        });
    }

    // Set the height of the inner containers for virtualization to simulate full scroll height
    const totalContentHeight = guideState.visibleChannels.length * ROW_HEIGHT;
    UIElements.channelListInner.style.height = `${totalContentHeight}px`;
    UIElements.timelineInner.style.height = `${totalContentHeight}px`;

    // Perform initial virtualization render
    updateVisibleRows();

    // Restore scroll positions or reset
    setTimeout(() => {
        if (resetScroll) {
            UIElements.guideContainer.scrollTop = 0;
            UIElements.guideContainer.scrollLeft = 0;
        } else {
            UIElements.guideContainer.scrollTop = currentScrollTop;
            UIElements.guideContainer.scrollLeft = currentScrollLeft;
        }
        updateNowLineAndScroll(guideStart, resetScroll); // Call with shouldScroll for 'Now' button
    }, 50); // Small delay to allow DOM to render and heights to be set
};


/**
 * Renders only the visible rows and a buffer for virtual scrolling.
 */
const updateVisibleRows = () => {
    // If elements aren't ready, defer
    if (!UIElements.guideContainer || !UIElements.channelListInner || !UIElements.timelineInner || !guideState.visibleChannels) {
        requestAnimationFrame(updateVisibleRows);
        return;
    }

    const scrollTop = UIElements.guideContainer.scrollTop;
    const viewportHeight = UIElements.guideContainer.clientHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
    const endIndex = Math.min(
        guideState.visibleChannels.length,
        Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS
    );

    const channelsInView = guideState.visibleChannels.slice(startIndex, endIndex);

    // Render Channel Info (Left Side)
    let channelInfoHTML = '';
    const sourceColors = ['bg-blue-600', 'bg-green-600', 'bg-pink-600', 'bg-yellow-500', 'bg-indigo-600', 'bg-red-600'];
    const sourceColorMap = new Map();
    let colorIndex = 0;

    channelsInView.forEach((channel, relativeIndex) => {
        const channelName = channel.displayName || channel.name;
        const topPosition = (startIndex + relativeIndex) * ROW_HEIGHT; // Calculate absolute position

        // Assign a consistent color to each source for the badge
        if (!sourceColorMap.has(channel.source)) {
            sourceColorMap.set(channel.source, sourceColors[colorIndex % sourceColors.length]);
            colorIndex++;
        }
        const sourceBadgeColor = sourceColorMap.get(channel.source);
        const sourceBadgeHTML = guideState.channelSources.size > 1 ? `<span class="source-badge ${sourceBadgeColor} text-white">${channel.source}</span>` : '';
        const chnoBadgeHTML = channel.chno ? `<span class="chno-badge">${channel.chno}</span>` : '';

        channelInfoHTML += `
            <div class="channel-info p-2 flex items-center justify-between cursor-pointer" style="top: ${topPosition}px;" data-url="${channel.url}" data-name="${channelName}" data-id="${channel.id}">
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
    });
    UIElements.channelListInner.innerHTML = channelInfoHTML;

    // Render Timeline Rows (Right Side)
    let timelineRowsHTML = '';
    const now = new Date();
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);

    channelsInView.forEach((channel, relativeIndex) => {
        const channelName = channel.displayName || channel.name;
        const topPosition = (startIndex + relativeIndex) * ROW_HEIGHT; // Calculate absolute position

        let programsHTML = '';
        (guideState.programs[channel.id] || []).forEach(prog => {
            const progStart = new Date(prog.start);
            const progStop = new Date(prog.stop);
            if (progStop < guideStart || progStart > guideEnd) return;

            const durationMs = progStop - progStart;
            if (durationMs <= 0) return;

            const left = ((progStart - guideStart) / 3600000) * guideState.hourWidthPixels;
            const width = (durationMs / 3600000) * guideState.hourWidthPixels;
            const isLive = now >= progStart && now < progStop;
            const progressWidth = isLive ? ((now - progStart) / durationMs) * 100 : 0;

            programsHTML += `<div class="programme-item absolute top-1 bottom-1 bg-gray-800 rounded-md p-2 overflow-hidden flex flex-col justify-center z-5 ${isLive ? 'live' : ''} ${progStop < now ? 'past' : ''}" style="left:${left}px; width:${Math.max(0, width - 2)}px" data-channel-url="${channel.url}" data-channel-id="${channel.id}" data-channel-name="${channelName}" data-prog-title="${prog.title}" data-prog-desc="${prog.desc}" data-prog-start="${progStart.toISOString()}" data-prog-stop="${progStop.toISOString()}"><div class="programme-progress" style="width:${progressWidth}%"></div><p class="prog-title text-white font-semibold truncate relative z-10">${prog.title}</p><p class="prog-time text-gray-400 truncate relative z-10">${progStart.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</p></div>`;
        });
        timelineRowsHTML += `<div class="timeline-row" style="top: ${topPosition}px; width: ${guideState.guideDurationHours * guideState.hourWidthPixels}px;">${programsHTML}</div>`;
    });
    UIElements.timelineInner.innerHTML = timelineRowsHTML;

    // Adjust the height of the now-line to span the entire actual scrollable content
    const totalGuideHeight = UIElements.channelListInner.scrollHeight; // Or timelineInner.scrollHeight, they should be the same
    UIElements.nowLine.style.height = `${totalGuideHeight}px`;
};


/**
 * Updates the position of the "now" line and program states (live, past).
 * @param {Date} guideStart - The start time of the current guide view.
 * @param {boolean} shouldScroll - If true, scrolls the timeline to the now line.
 */
const updateNowLineAndScroll = (guideStart, shouldScroll) => {
    if (!UIElements.nowLine) return;

    const now = new Date();
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);

    // Get the actual width of the channel info column (sticky-corner / channel-info)
    const channelInfoColWidth = UIElements.stickyCorner?.offsetWidth || 0;

    if (now >= guideStart && now <= guideEnd) {
        // Calculate left position relative to the start of the *scrollable* area
        const leftOffsetInScrollableArea = ((now - guideStart) / 3600000) * guideState.hourWidthPixels;
        UIElements.nowLine.style.left = `${channelInfoColWidth + leftOffsetInScrollableArea}px`; // Add channelInfoColWidth
        UIElements.nowLine.classList.remove('hidden');
        if (shouldScroll) {
            // Scroll the guide container horizontally
            // The horizontal scroll is still on guideContainer for the entire grid
            UIElements.guideContainer.scrollTo({
                left: leftOffsetInScrollableArea - (UIElements.guideContainer.clientWidth / 4), // Scroll to center now line
                behavior: 'smooth'
            });
        }
    } else {
        UIElements.nowLine.classList.add('hidden');
    }

    // Update progress bars and states for all *currently rendered* programs
    UIElements.timelineInner.querySelectorAll('.programme-item').forEach(item => {
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

    // Schedule the next update
    setTimeout(() => updateNowLineAndScroll(guideStart, false), 60000);
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
 * @param {boolean} isFirstLoad - Indicates if this is the initial load.
 */
export function handleSearchAndFilter(isFirstLoad = false) {
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
            // Map recent IDs to actual channel objects, ensuring order and filtering out non-existent ones
            const recentChannels = recentIds.map(id => guideState.channels.find(ch => ch.id === id)).filter(Boolean);
            // Deduplicate if any channel appears multiple times due to recent history
            channelsForGuide = [...new Set(recentChannels)];
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
    
    guideState.visibleChannels = channelsForGuide; // Update the filtered list in state
    updateVisibleRows(); // Re-render visible rows based on the new filtered list
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
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};


// --- Event Listeners ---

/**
 * Sets up all event listeners for the guide page.
 */
export function setupGuideEventListeners() {
    // --- Guide Navigation (Now located inside the guide rendering, so we attach directly there) ---
    // These listeners will be re-attached whenever renderGuide is called.

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

    // --- Interactions (Clicks on the new grid) ---
    // The event listener is on guideGridMain, but we delegate to its children.
    UIElements.guideGridMain.addEventListener('click', (e) => {
        const favoriteStar = e.target.closest('.favorite-star');
        const channelInfo = e.target.closest('.channel-info');
        const progItem = e.target.closest('.programme-item');

        if (favoriteStar) {
            e.stopPropagation(); // Prevent the channel click from firing
            const channelId = favoriteStar.dataset.channelId;
            const channel = guideState.channels.find(c => c.id === channelId);
            if (!channel) return;

            // Toggle favorite state and update UI
            channel.isFavorite = !channel.isFavorite;
            favoriteStar.classList.toggle('favorited', channel.isFavorite);
            
            // Update settings and save to server
            guideState.settings.favorites = guideState.channels.filter(c => c.isFavorite).map(c => c.id);
            saveUserSetting('favorites', guideState.settings.favorites);
            
            // If currently viewing favorites, re-filter the list
            if (UIElements.groupFilter.value === 'favorites') {
                handleSearchAndFilter();
            }
            return;
        }
        
        if (channelInfo) {
            playChannel(channelInfo.dataset.url, channelInfo.dataset.name, channelInfo.dataset.id);
        }

        if (progItem) {
            // Populate and show the program details modal
            UIElements.detailsTitle.textContent = progItem.dataset.progTitle;
            const progStart = new Date(progItem.dataset.progStart);
            const progStop = new Date(progItem.dataset.progStop);
            UIElements.detailsTime.textContent = `${progStart.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}`;
            UIElements.detailsDesc.textContent = progItem.dataset.progDesc || "No description available.";
            UIElements.detailsPlayBtn.onclick = () => {
                playChannel(progItem.dataset.channelUrl, `${progItem.dataset.channelName}`, progItem.dataset.channelId);
                closeModal(UIElements.programDetailsModal);
            };
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
            // Find the index of the channel in the filtered list
            const channelIndex = guideState.visibleChannels.findIndex(ch => ch.id === channelId);
            if (channelIndex !== -1) {
                // Calculate the scroll position to bring the channel into view
                const scrollToY = channelIndex * ROW_HEIGHT;
                UIElements.guideContainer.scrollTo({ top: scrollToY, behavior: 'smooth' });

                // Highlight the channel after scrolling
                setTimeout(() => {
                    const renderedChannelElement = UIElements.channelListInner.querySelector(`.channel-info[data-id="${channelId}"]`);
                    if (renderedChannelElement) {
                        renderedChannelElement.style.transition = 'background-color 0.5s';
                        renderedChannelElement.style.backgroundColor = '#3b82f6'; // Highlight
                        setTimeout(() => { renderedChannelElement.style.backgroundColor = ''; }, 2000);
                    }
                }, 300); // Small delay for scroll animation
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
                const channelId = programItem.dataset.channelId;
                const channelIndex = guideState.visibleChannels.findIndex(ch => ch.id === channelId);

                if (channelIndex !== -1) {
                    const scrollToY = channelIndex * ROW_HEIGHT;
                    UIElements.guideContainer.scrollTo({ top: scrollToY, behavior: 'smooth' });

                    // Highlight program and scroll horizontally after vertical scroll
                    setTimeout(() => {
                        const programElement = UIElements.timelineInner.querySelector(`.programme-item[data-prog-start="${programItem.dataset.progStart}"][data-channel-id="${channelId}"]`);
                        if(programElement) {
                            const scrollLeft = programElement.offsetLeft - (UIElements.timelineScrollContainer.clientWidth / 4);
                            UIElements.guideContainer.scrollTo({ left: scrollLeft, behavior: 'smooth' }); // Scroll the main guide container horizontally

                            programElement.style.transition = 'outline 0.5s';
                            programElement.style.outline = '3px solid #facc15';
                            setTimeout(() => { programElement.style.outline = 'none'; }, 2500);
                        }
                    }, 300); // Delay after vertical scroll
                }
            }, 200);
        }
    });


    // --- NEW: Scroll event for virtualization and header visibility ---
    let lastScrollTop = 0;
    let initialHeaderHeight = 0; 

    const calculateInitialHeaderHeight = () => {
        let height = 0;
        // Only consider main-header and unified-guide-header for collapse calculation
        if (UIElements.mainHeader) height += UIElements.mainHeader.offsetHeight;
        if (UIElements.unifiedGuideHeader) height += UIElements.unifiedGuideHeader.offsetHeight;
        return height;
    };

    const handleScroll = throttle(() => {
        if (!UIElements.guideContainer || !UIElements.appContainer || !UIElements.pageGuide) {
            return; // Exit if elements aren't ready
        }

        // --- Virtual Scrolling Logic ---
        updateVisibleRows();

        // --- Header Collapse Logic ---
        const scrollTop = UIElements.guideContainer.scrollTop;
        const scrollDirection = scrollTop > lastScrollTop ? 'down' : 'up';
        
        // Calculate initial header height if not already done
        if (initialHeaderHeight === 0) {
            initialHeaderHeight = calculateInitialHeaderHeight();
            // When guide is active, page-guide's paddingTop is always 1px as requested
            if (!UIElements.appContainer.classList.contains('header-collapsed')) {
                 UIElements.pageGuide.style.paddingTop = `1px`;
            }
        }
        
        // The collapseThreshold now refers to the total height of all elements that are *supposed* to collapse
        const collapseThreshold = initialHeaderHeight * 0.5; // Hide after scrolling half the height of these elements

        if (scrollDirection === 'down' && scrollTop > collapseThreshold) {
            if (!UIElements.appContainer.classList.contains('header-collapsed')) {
                UIElements.appContainer.classList.add('header-collapsed');
                // When headers collapse, maintain page-guide's padding at 1px
                UIElements.pageGuide.style.paddingTop = `1px`; 
            }
        } else if (scrollDirection === 'up' && scrollTop <= collapseThreshold / 2) { // Show if near top
            if (UIElements.appContainer.classList.contains('header-collapsed')) {
                UIElements.appContainer.classList.remove('header-collapsed');
                // Restore page-guide's padding to 1px when headers are visible again
                UIElements.pageGuide.style.paddingTop = `1px`; 
            }
        }
        lastScrollTop = scrollTop <= 0 ? 0 : scrollTop; // For Mobile or negative scrolling
    }, 100); // Throttled to 100ms for performance

    // Attach scroll listener to the guide container
    UIElements.guideContainer.addEventListener('scroll', handleScroll);
    
    // Initial call to render the guide and position now line
    // This is called by finalizeGuideLoad -> handleSearchAndFilter -> renderGuide,
    // and then updateNowLineAndScroll is called after a timeout in renderGuide.
}

