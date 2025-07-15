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
 * Renders the entire TV guide grid.
 * @param {Array<object>} channelsToRender - The filtered list of channels to display.
 * @param {boolean} resetScroll - If true, scrolls the guide to the top-left.
 */
const renderGuide = (channelsToRender, resetScroll = false) => {
    guideState.visibleChannels = channelsToRender;
    const showNoData = guideState.channels.length === 0;

    // Toggle placeholder vs. guide content visibility
    UIElements.guidePlaceholder.classList.toggle('hidden', !showNoData);
    UIElements.noDataMessage.classList.toggle('hidden', !showNoData);
    UIElements.initialLoadingIndicator.classList.add('hidden');
    UIElements.guideGrid.classList.toggle('hidden', showNoData);
    if (showNoData) {
        UIElements.guideGrid.innerHTML = '';
        return;
    }

    const currentScrollLeft = UIElements.guideGrid.scrollLeft;

    UIElements.guideDateDisplay.textContent = guideState.currentDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });
    
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);

    // --- Build Grid HTML ---
    let gridHTML = '';

    // 1. Render Time Bar Row
    let timeBarCellsHTML = '';
    for (let i = 0; i < guideState.guideDurationHours; i++) {
        const time = new Date(guideStart);
        time.setHours(guideStart.getHours() + i);
        timeBarCellsHTML += `<div class="absolute top-0 bottom-0 flex items-center justify-start px-2 text-xs text-gray-400 border-r border-gray-700/50" style="left: ${i * guideState.hourWidthPixels}px; width: ${guideState.hourWidthPixels}px;">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
    }
    const timelineWidth = guideState.guideDurationHours * guideState.hourWidthPixels;
    // Top-left empty cell + Time bar
    gridHTML += `
        <div class="channel-info h-16" style="grid-row: 1; grid-column: 1;"></div>
        <div class="time-bar-cell h-16" style="grid-row: 1; grid-column: 2; width: ${timelineWidth}px;">${timeBarCellsHTML}</div>
    `;

    // 2. Render Channel + Program Rows
    const sourceColors = ['bg-blue-600', 'bg-green-600', 'bg-pink-600', 'bg-yellow-500', 'bg-indigo-600', 'bg-red-600'];
    const sourceColorMap = new Map();
    let colorIndex = 0;

    channelsToRender.forEach((channel, index) => {
        const rowNum = index + 2; // CSS grid rows start at 1, +1 for header row
        const channelName = channel.displayName || channel.name;

        // Assign a consistent color to each source for the badge
        if (!sourceColorMap.has(channel.source)) {
            sourceColorMap.set(channel.source, sourceColors[colorIndex % sourceColors.length]);
            colorIndex++;
        }
        const sourceBadgeColor = sourceColorMap.get(channel.source);
        const sourceBadgeHTML = guideState.channelSources.size > 1 ? `<span class="source-badge ${sourceBadgeColor} text-white">${channel.source}</span>` : '';
        const chnoBadgeHTML = channel.chno ? `<span class="chno-badge">${channel.chno}</span>` : '';

        // Sticky Channel Info Cell
        const channelInfoHTML = `
            <div class="channel-info h-24 p-2 flex items-center justify-between cursor-pointer" style="grid-row: ${rowNum}; grid-column: 1;" data-url="${channel.url}" data-name="${channelName}" data-id="${channel.id}">
                <div class="flex items-center overflow-hidden flex-grow min-w-0">
                    <img src="${channel.logo}" onerror="this.onerror=null; this.src='https.placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-3 flex-shrink-0 rounded-md bg-gray-700">
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

        // Scrollable Timeline Row
        let programsHTML = '';
        const now = new Date();
        const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);
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
        const timelineRowHTML = `<div class="timeline-row h-24" style="grid-row: ${rowNum}; grid-column: 2; width: ${timelineWidth}px;">${programsHTML}</div>`;

        gridHTML += channelInfoHTML + timelineRowHTML;
    });
    
    // Now line needs to be outside the grid cells to span all rows
    const totalGuideHeight = 64 + (channelsToRender.length * 96); // 64 for header, 96 per channel
    gridHTML += `<div id="now-line" class="absolute top-0 bg-red-500 w-0.5 z-30 pointer-events-none hidden" style="height: ${totalGuideHeight}px;"></div>`;

    UIElements.guideGrid.innerHTML = gridHTML;
    
    // Defer scroll position restoration and now-line update
    setTimeout(() => {
        if (resetScroll) {
            UIElements.guideGrid.scrollTop = 0;
        }
        UIElements.guideGrid.scrollLeft = currentScrollLeft;
        updateNowLine(guideStart, resetScroll);
    }, 0);
};

/**
 * Updates the position of the "now" line and program states (live, past).
 * @param {Date} guideStart - The start time of the current guide view.
 * @param {boolean} shouldScroll - If true, scrolls the timeline to the now line.
 */
const updateNowLine = (guideStart, shouldScroll) => {
    const nowLineEl = document.getElementById('now-line');
    if (!nowLineEl) return;

    const now = new Date();
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);

    if (now >= guideStart && now <= guideEnd) {
        const left = ((now - guideStart) / 3600000) * guideState.hourWidthPixels;
        nowLineEl.style.left = `${UIElements.guideGrid.querySelector('.channel-info').offsetWidth + left}px`;
        nowLineEl.classList.remove('hidden');
        if (shouldScroll) {
            UIElements.guideGrid.scrollLeft = left - (UIElements.guideGrid.clientWidth / 4);
        }
    } else {
        nowLineEl.classList.add('hidden');
    }

    // Update progress bars and states for all visible programs
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

    // Schedule the next update
    setTimeout(() => updateNowLine(guideStart, false), 60000);
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
    
    renderGuide(channelsForGuide, isFirstLoad);
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
                <img src="${item.logo}" onerror="this.onerror=null; this.src='https.placehold.co/40x40/1f2937/d1d5db?text=?';" class="w-10 h-10 object-contain mr-3 rounded-md bg-gray-700 flex-shrink-0">
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
                <img src="${item.channel.logo}" onerror="this.onerror=null; this.src='https.placehold.co/40x40/1f2937/d1d5db?text=?';" class="w-10 h-10 object-contain mr-3 rounded-md bg-gray-700 flex-shrink-0">
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
    // --- Guide Navigation ---
    UIElements.prevDayBtn.addEventListener('click', () => {
        guideState.currentDate.setDate(guideState.currentDate.getDate() - 1);
        finalizeGuideLoad();
    });
    UIElements.todayBtn.addEventListener('click', () => {
        guideState.currentDate = new Date();
        renderGuide(guideState.visibleChannels, true);
    });
    UIElements.nowBtn.addEventListener('click', () => {
        const now = new Date();
        // If not viewing today, switch to today and re-render
        if (guideState.currentDate.toDateString() !== now.toDateString()) {
            guideState.currentDate = now;
            finalizeGuideLoad();
            setTimeout(() => renderGuide(guideState.visibleChannels, true), 50);
        } else {
            // If already on today, just scroll to the "now" line
            const guideStart = new Date(guideState.currentDate);
            guideStart.setHours(0, 0, 0, 0);
            const scrollPos = left = ((now - guideStart) / 3600000) * guideState.hourWidthPixels - (UIElements.guideGrid.clientWidth / 4);
            UIElements.guideGrid.scrollTo({ left: scrollPos, behavior: 'smooth' });
        }
    });
    UIElements.nextDayBtn.addEventListener('click', () => {
        guideState.currentDate.setDate(guideState.currentDate.getDate() + 1);
        finalizeGuideLoad();
    });

    // --- Filtering and Searching ---
    UIElements.groupFilter.addEventListener('change', () => handleSearchAndFilter());
    UIElements.sourceFilter.addEventListener('change', () => handleSearchAndFilter());
    UIElements.searchInput.addEventListener('input', () => {
        clearTimeout(appState.searchDebounceTimer);
        appState.searchDebounceTimer = setTimeout(() => handleSearchAndFilter(false), 250);
    });
    // Hide search results when clicking outside
    document.addEventListener('click', e => {
        if (!UIElements.searchInput.contains(e.target) && !UIElements.searchResultsContainer.contains(e.target)) {
            UIElements.searchResultsContainer.classList.add('hidden');
        }
    });

    // --- Interactions (Clicks on the new grid) ---
    UIElements.guideGrid.addEventListener('click', (e) => {
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
             const channelRow = UIElements.guideGrid.querySelector(`.channel-info[data-id="${channelId}"]`);
             if (channelRow) {
                 channelRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                 channelRow.style.transition = 'background-color 0.5s';
                 channelRow.style.backgroundColor = '#3b82f6'; // Highlight
                 setTimeout(() => { channelRow.style.backgroundColor = ''; }, 2000);
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
                const programElement = UIElements.guideGrid.querySelector(`.programme-item[data-prog-start="${programItem.dataset.progStart}"]`);
                if(programElement) {
                    const scrollLeft = programElement.offsetLeft - (UIElements.guideGrid.clientWidth / 4);
                    UIElements.guideGrid.scrollTo({ left: scrollLeft, behavior: 'smooth' });
                    programElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

                    programElement.style.transition = 'outline 0.5s';
                    programElement.style.outline = '3px solid #facc15';
                    setTimeout(() => { programElement.style.outline = 'none'; }, 2500);
                }
            }, 200);
        }
    });
}
