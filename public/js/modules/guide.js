/**
 * guide.js
 * * Manages all functionality related to the TV Guide,
 * including data loading, rendering, searching, and user interaction.
 */

import { appState, guideState, UIElements } from './state.js';
import { apiFetch, saveUserSetting } from './api.js';
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

    UIElements.guideHeader.classList.toggle('hidden', showNoData);
    UIElements.guideGrid.classList.toggle('hidden', showNoData);


    if (showNoData) return;

    const currentScrollTop = UIElements.guideGrid.scrollTop;
    ['guideGrid', 'timeBar'].forEach(id => UIElements[id].innerHTML = '');

    UIElements.guideDateDisplay.textContent = guideState.currentDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });

    // Render time bar
    const timeBarContent = document.createElement('div');
    timeBarContent.className = 'relative h-full';
    timeBarContent.style.width = `${guideState.guideDurationHours * guideState.hourWidthPixels}px`;
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);
    for (let i = 0; i < guideState.guideDurationHours; i++) {
        const time = new Date(guideStart);
        time.setHours(guideStart.getHours() + i);
        timeBarContent.innerHTML += `<div class="absolute top-0 bottom-0 flex items-center justify-start px-2 text-xs text-gray-400 border-r border-gray-700/50" style="left: ${i * guideState.hourWidthPixels}px; width: ${guideState.hourWidthPixels}px;">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
    }
    UIElements.timeBar.appendChild(timeBarContent);
    UIElements.guideHeaderChannels.style.height = `${UIElements.timeBar.offsetHeight}px`;

    // Render channels and programs
    let guideContentHTML = '';
    const sourceColors = ['bg-blue-600', 'bg-green-600', 'bg-pink-600', 'bg-yellow-500', 'bg-indigo-600', 'bg-red-600'];
    const sourceColorMap = new Map();
    let colorIndex = 0;

    const fragment = document.createDocumentFragment();

    channelsToRender.forEach(channel => {
        const channelName = channel.displayName || channel.name;

        if (!sourceColorMap.has(channel.source)) {
            sourceColorMap.set(channel.source, sourceColors[colorIndex % sourceColors.length]);
            colorIndex++;
        }
        
        const rowEl = document.createElement('div');
        rowEl.className = 'flex border-b border-gray-700/50 h-24';

        // Channel Info Cell (Left side)
        const channelCell = document.createElement('div');
        channelCell.className = 'w-64 md:w-80 flex-shrink-0 bg-gray-800/80 backdrop-blur-sm border-r border-gray-700/50 p-2 flex items-center justify-between sticky left-0 z-10';
        
        const sourceBadgeColor = sourceColorMap.get(channel.source);
        const sourceBadgeHTML = guideState.channelSources.size > 1 ? `<span class="source-badge ${sourceBadgeColor} text-white !ml-0">${channel.source}</span>` : '';
        const chnoBadgeHTML = channel.chno ? `<span class="chno-badge">${channel.chno}</span>` : '';

        channelCell.innerHTML = `
            <div class="flex items-center overflow-hidden cursor-pointer flex-grow min-w-0" data-url="${channel.url}" data-name="${channelName}" data-id="${channel.id}">
                <img src="${channel.logo}" onerror="this.onerror=null; this.src='https.placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-3 flex-shrink-0 rounded-md bg-gray-700 hidden sm:block">
                <div class="flex-grow min-w-0">
                    <span class="font-semibold text-sm truncate block">${channelName}</span>
                     <div class="flex items-center gap-2 mt-1">
                        ${chnoBadgeHTML}
                        ${sourceBadgeHTML}
                    </div>
                </div>
            </div>
            <svg data-channel-id="${channel.id}" class="w-6 h-6 text-gray-500 hover:text-yellow-400 favorite-star cursor-pointer flex-shrink-0 ml-2 ${channel.isFavorite ? 'favorited' : ''}" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8-2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
        `;
        rowEl.appendChild(channelCell);
        
        // Programs Cell (Right side)
        const programsCell = document.createElement('div');
        programsCell.className = 'relative flex-grow';
        programsCell.style.width = `${guideState.guideDurationHours * guideState.hourWidthPixels}px`;

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
        programsCell.innerHTML = programsHTML;
        rowEl.appendChild(programsCell);

        fragment.appendChild(rowEl);
    });
    
    UIElements.guideGrid.appendChild(fragment);

    // Defer scroll position restoration and now-line update
    setTimeout(() => {
        UIElements.guideGrid.scrollTop = resetScroll ? 0 : currentScrollTop;
        updateNowLine(guideStart, resetScroll);
    }, 0);
};

/**
 * Updates the position of the "now" line and program states (live, past).
 * @param {Date} guideStart - The start time of the current guide view.
 * @param {boolean} shouldScroll - If true, scrolls the timeline to the now line.
 */
const updateNowLine = (guideStart, shouldScroll) => {
    let nowLineEl = document.getElementById('now-line');
    if (!nowLineEl) {
        nowLineEl = document.createElement('div');
        nowLineEl.id = 'now-line';
        nowLineEl.className = 'absolute top-0 bottom-0 bg-red-500 w-0.5 z-20 hidden';
        UIElements.guideGrid.prepend(nowLineEl);
    }
    
    const totalGuideHeight = UIElements.guideGrid.scrollHeight;
    nowLineEl.style.height = `${totalGuideHeight}px`;
    const now = new Date();
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);

    if (now >= guideStart && now <= guideEnd) {
        const left = ((now - guideStart) / 3600000) * guideState.hourWidthPixels;
        nowLineEl.style.left = `${left}px`;
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
            const scrollPos = ((now - guideStart) / 3600000) * guideState.hourWidthPixels - (UIElements.guideGrid.clientWidth / 4);
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

    // --- Interactions (Clicks) ---
    UIElements.guideGrid.addEventListener('click', (e) => {
        const favoriteStar = e.target.closest('.favorite-star');
        if (favoriteStar) {
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
            return; // Don't play the channel when clicking the star
        }
        
        const channelItem = e.target.closest('[data-url]');
        if (channelItem) {
             const progItem = e.target.closest('.programme-item');
             if(progItem) {
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
             } else {
                playChannel(channelItem.dataset.url, channelItem.dataset.name, channelItem.dataset.id);
             }
        }
    });

    // --- Search Results Click ---
    UIElements.searchResultsContainer.addEventListener('click', e => {
        const programItem = e.target.closest('.search-result-program');
        const channelItem = e.target.closest('.search-result-channel');

        UIElements.searchResultsContainer.classList.add('hidden');
        UIElements.searchInput.value = '';

        if (channelItem) {
            // ... logic to find and scroll to the channel in the guide
        } else if (programItem) {
            // ... logic to find and scroll to the program in the guide
        }
    });

    // --- Guide Scrolling Sync ---
    UIElements.guideGrid.addEventListener('scroll', (e) => {
        UIElements.timeBar.scrollLeft = e.target.scrollLeft;
    });

    // --- Collapsing Header and "Show" Button ---
    let lastScrollTop = 0;
    const handleHeaderAndButtonVisibility = () => {
        const scrollTop = UIElements.guideGrid.scrollTop;

        // A small buffer to prevent jittering from minor scroll adjustments.
        if (Math.abs(scrollTop - lastScrollTop) <= 5) {
            return;
        }

        const isScrollingDown = scrollTop > lastScrollTop;
        const isCollapsed = UIElements.appContainer.classList.contains('header-collapsed');

        // SCROLLING DOWN: Collapse the header if we scroll past a certain point.
        if (isScrollingDown && scrollTop > 150 && !isCollapsed) {
            UIElements.appContainer.classList.add('header-collapsed');
            UIElements.showHeaderBtn.classList.remove('hidden');
        } 
        // SCROLLING UP: Only expand the header if we've reached the very top.
        else if (!isScrollingDown && scrollTop < 10 && isCollapsed) {
            UIElements.appContainer.classList.remove('header-collapsed');
            UIElements.showHeaderBtn.classList.add('hidden');
        }

        lastScrollTop = scrollTop <= 0 ? 0 : scrollTop; // For mobile or negative scroll values.
    };

    // Listen to scroll events, but throttled to prevent lag.
    UIElements.guideGrid.addEventListener('scroll', throttle(handleHeaderAndButtonVisibility, 100), { passive: true });

    // Handle click on the "Show Header" button with a direct action.
    UIElements.showHeaderBtn.addEventListener('click', () => {
        // First, directly change the state by removing the class and hiding the button.
        UIElements.appContainer.classList.remove('header-collapsed');
        UIElements.showHeaderBtn.classList.add('hidden');
        
        // Then, perform the smooth scroll to the top.
        UIElements.guideGrid.scrollTo({ top: 0, behavior: 'smooth' });
    });
}
