/**
 * guide.js
 * * Manages all functionality related to the TV Guide,
 * including data loading, rendering, searching, and user interaction.
 *
 * Performance Enhancements:
 * - Implements UI virtualization for the guide grid to only render visible rows.
 * - Uses requestAnimationFrame for smoother scrolling and synchronization.
 * - Optimizes DOM manipulation to reduce layout thrashing.
 */

import { appState, guideState, UIElements } from './state.js';
import { apiFetch, saveUserSetting } from './api.js';
import { parseM3U } from './utils.js';
import { playChannel } from './player.js';
import { showNotification, openModal, closeModal } from './ui.js';

// --- Virtualization State ---
const rowHeight = 96; // h-24 in TailwindCSS
const renderBuffer = 5; // Number of items to render above/below viewport
let lastRenderedRange = { start: -1, end: -1 };
let scrollRequest = null;

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

    appState.db?.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.channels, 'channels');
    appState.db?.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.programs, 'programs');

    finalizeGuideLoad(true);
}

/**
 * Finalizes the guide setup after data is loaded.
 * @param {boolean} isFirstLoad - Indicates if this is the initial load of the guide.
 */
export function finalizeGuideLoad(isFirstLoad = false) {
    const favoriteIds = new Set(guideState.settings.favorites || []);
    guideState.channels.forEach(channel => {
        channel.isFavorite = favoriteIds.has(channel.id);
    });

    guideState.channelGroups.clear();
    guideState.channelSources.clear();
    guideState.channels.forEach(ch => {
        if (ch.group) guideState.channelGroups.add(ch.group);
        if (ch.source) guideState.channelSources.add(ch.source);
    });
    populateGroupFilter();
    populateSourceFilter();

    appState.fuseChannels = new Fuse(guideState.channels, {
        keys: ['name', 'displayName', 'source', 'chno'],
        threshold: 0.4,
        includeScore: true,
    });

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
    
    appState.fusePrograms = new Fuse(allPrograms, {
        keys: ['title'],
        threshold: 0.4,
        includeScore: true,
    });

    handleSearchAndFilter(isFirstLoad);
}

// --- UI Rendering (Virtualized) ---

/**
 * Renders the visible portion of the TV guide.
 */
function renderVisibleGuide() {
    
    const scrollTop = UIElements.guideTimeline.scrollTop;
    const viewportHeight = UIElements.guideTimeline.clientHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - renderBuffer);
    const endIndex = Math.min(guideState.visibleChannels.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + renderBuffer);
    
    // Only re-render if the visible range has changed
    if (startIndex === lastRenderedRange.start && endIndex === lastRenderedRange.end) {
        return;
    }
    lastRenderedRange = { start: startIndex, end: endIndex };

    const visibleItems = guideState.visibleChannels.slice(startIndex, endIndex);

    const channelListContent = UIElements.channelList.querySelector('.virtual-scroll-content');
    const logoListContent = UIElements.logoList.querySelector('.virtual-scroll-content');
    const timelineContent = UIElements.guideTimeline.querySelector('.virtual-scroll-content');
    
    // Generate HTML strings for each section
    const channelListHTML = renderChannelList(visibleItems);
    const logoListHTML = renderLogoList(visibleItems);
    const timelineHTML = renderTimeline(visibleItems);

    // Batch DOM updates
    requestAnimationFrame(() => {
        if(channelListContent) channelListContent.innerHTML = channelListHTML;
        if(logoListContent) logoListContent.innerHTML = logoListHTML;
        if(timelineContent) timelineContent.innerHTML = timelineHTML;

        const transformY = startIndex * rowHeight;
        if(channelListContent) channelListContent.style.transform = `translateY(${transformY}px)`;
        if(logoListContent) logoListContent.style.transform = `translateY(${transformY}px)`;
        if(timelineContent) timelineContent.style.transform = `translateY(${transformY}px)`;
    });
}


/**
 * Initializes the guide display, setting up containers for virtualization.
 * @param {Array<object>} channelsToRender - The filtered list of channels.
 * @param {boolean} resetScroll - If true, scrolls to top.
 */
const initializeGuideRender = (channelsToRender, resetScroll = false) => {
    guideState.visibleChannels = channelsToRender;
    lastRenderedRange = { start: -1, end: -1 };
    const showNoData = !channelsToRender || channelsToRender.length === 0;

    UIElements.guidePlaceholder.classList.toggle('hidden', !showNoData);
    UIElements.noDataMessage.classList.toggle('hidden', !showNoData);
    UIElements.initialLoadingIndicator.classList.add('hidden');

    const elementsToToggle = ['channelPanelContainer', 'resizer', 'logoColumn', 'timelineContainer'];
    elementsToToggle.forEach(id => UIElements[id]?.classList.toggle('hidden', showNoData));
    if (window.innerWidth >= 1024) { 
        UIElements.channelPanelContainer?.classList.toggle('lg:flex', !showNoData);
        UIElements.resizer?.classList.toggle('lg:block', !showNoData);
    }

    if (showNoData) {
         ['channelList', 'logoList', 'guideTimeline'].forEach(id => {
            const sizer = UIElements[id]?.querySelector('.virtual-scroll-sizer');
            const content = UIElements[id]?.querySelector('.virtual-scroll-content');
            if(sizer) sizer.style.height = '0px';
            if(content) content.innerHTML = '';
        });
        UIElements.timeBar.innerHTML = '';
        return;
    }

    // Render Time Bar
    UIElements.guideDateDisplay.textContent = guideState.currentDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });
    const timeBarContent = document.createElement('div');
    timeBarContent.className = 'relative h-full';
    const totalTimelineWidth = guideState.guideDurationHours * guideState.hourWidthPixels;
    timeBarContent.style.width = `${totalTimelineWidth}px`;
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);
    let timeBarHTML = '';
    for (let i = 0; i < guideState.guideDurationHours; i++) {
        const time = new Date(guideStart);
        time.setHours(guideStart.getHours() + i);
        timeBarHTML += `<div class="absolute top-0 bottom-0 flex items-center justify-start px-2 text-xs text-gray-400 border-r border-gray-700/50" style="left: ${i * guideState.hourWidthPixels}px; width: ${guideState.hourWidthPixels}px;">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
    }
    timeBarContent.innerHTML = timeBarHTML;
    UIElements.timeBar.innerHTML = '';
    UIElements.timeBar.appendChild(timeBarContent);
    
    // Setup Virtual Scroll Sizers
    const totalHeight = channelsToRender.length * rowHeight;
    ['channelList', 'logoList', 'guideTimeline'].forEach(id => {
        const sizer = UIElements[id].querySelector('.virtual-scroll-sizer');
        sizer.style.height = `${totalHeight}px`;
        if (id === 'guideTimeline') {
            sizer.style.width = `${totalTimelineWidth}px`;
        }
    });

    if (resetScroll) {
        ['channelList', 'logoList', 'guideTimeline'].forEach(id => {
            if (UIElements[id]) UIElements[id].scrollTop = 0;
        });
    }

    renderVisibleGuide();
    
    setTimeout(() => {
        updateNowLine(guideStart, resetScroll);
    }, 0);
};

// --- HTML String Generation for Virtual Rows ---

function renderChannelList(channels) {
    const sourceColors = ['bg-blue-600', 'bg-green-600', 'bg-pink-600', 'bg-yellow-500', 'bg-indigo-600', 'bg-red-600'];
    const sourceColorMap = new Map();
    let colorIndex = 0;

    return channels.map(channel => {
        const channelName = channel.displayName || channel.name;
        if (!sourceColorMap.has(channel.source)) {
            sourceColorMap.set(channel.source, sourceColors[colorIndex % sourceColors.length]);
            colorIndex++;
        }
        const sourceBadgeColor = sourceColorMap.get(channel.source);
        const sourceBadgeHTML = guideState.channelSources.size > 1 ? `<span class="source-badge ${sourceBadgeColor} text-white">${channel.source}</span>` : '';
        const chnoBadgeHTML = channel.chno ? `<span class="chno-badge">${channel.chno}</span>` : '';

        return `<div class="h-24 flex items-center justify-between p-2 border-b border-gray-700/50 flex-shrink-0">
            <div class="flex items-center overflow-hidden cursor-pointer flex-grow min-w-0" data-url="${channel.url}" data-name="${channelName}" data-id="${channel.id}">
                <img loading="lazy" src="${channel.logo}" onerror="this.onerror=null; this.src='https.placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-3 flex-shrink-0 rounded-md bg-gray-700">
                <div class="flex-grow min-w-0">
                    <span class="font-semibold text-sm truncate block">${channelName}</span>
                    <div class="flex items-center gap-2 mt-1">${chnoBadgeHTML}${sourceBadgeHTML}</div>
                </div>
            </div>
            <svg data-channel-id="${channel.id}" class="w-6 h-6 text-gray-500 hover:text-yellow-400 favorite-star cursor-pointer flex-shrink-0 ml-2 ${channel.isFavorite ? 'favorited' : ''}" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8-2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
        </div>`;
    }).join('');
}

function renderLogoList(channels) {
     return channels.map(channel => {
        const channelName = channel.displayName || channel.name;
        return `<div class="h-24 flex items-center justify-center p-1 border-b border-gray-700/50 flex-shrink-0 cursor-pointer" data-url="${channel.url}" data-name="${channelName}" data-id="${channel.id}"><img loading="lazy" src="${channel.logo}" onerror="this.onerror=null; this.src='https.placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-14 h-14 object-contain pointer-events-none"></div>`;
    }).join('');
}

function renderTimeline(channels) {
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);
    const now = new Date();

    return channels.map(channel => {
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
            const progDesc = prog.desc ? prog.desc.replace(/"/g, '&quot;') : "No description available.";

            programsHTML += `<div class="programme-item absolute top-1 bottom-1 bg-gray-800 rounded-md p-2 overflow-hidden flex flex-col justify-center z-5 ${isLive ? 'live' : ''} ${progStop < now ? 'past' : ''}" style="left:${left}px; width:${Math.max(0, width - 2)}px" data-channel-url="${channel.url}" data-channel-id="${channel.id}" data-channel-name="${channel.displayName || channel.name}" data-prog-title="${prog.title.replace(/"/g, '&quot;')}" data-prog-desc="${progDesc}" data-prog-start="${progStart.toISOString()}" data-prog-stop="${progStop.toISOString()}"><div class="programme-progress" style="width:${progressWidth}%"></div><p class="prog-title text-white font-semibold truncate relative z-10">${prog.title}</p><p class="prog-time text-gray-400 truncate relative z-10">${progStart.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</p></div>`;
        });
        return `<div class="h-24 border-b border-gray-700/50 relative">${programsHTML}</div>`;
    }).join('');
}

/**
 * Updates the position of the "now" line.
 * @param {Date} guideStart - The start time of the current guide view.
 * @param {boolean} shouldScroll - If true, scrolls the timeline to the now line.
 */
const updateNowLine = (guideStart, shouldScroll = false) => {
    const nowLineEl = document.getElementById('now-line');
    if (!nowLineEl) return;
    
    const sizer = UIElements.guideTimeline.querySelector('.virtual-scroll-sizer');
    if(sizer) nowLineEl.style.height = sizer.style.height;

    const now = new Date();
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);

    if (now >= guideStart && now <= guideEnd) {
        const left = ((now - guideStart) / 3600000) * guideState.hourWidthPixels;
        nowLineEl.style.left = `${left}px`;
        nowLineEl.classList.remove('hidden');
        if (shouldScroll) {
            UIElements.guideTimeline.scrollLeft = left - (UIElements.guideTimeline.clientWidth / 4);
        }
    } else {
        nowLineEl.classList.add('hidden');
    }
    
    setTimeout(() => updateNowLine(guideStart, false), 60000); 
};


// --- Filtering and Searching ---

const populateGroupFilter = () => {
    const currentVal = UIElements.groupFilter.value;
    UIElements.groupFilter.innerHTML = `<option value="all">All Groups</option><option value="recents">Recents</option><option value="favorites">Favorites</option>`;
    [...guideState.channelGroups].sort((a, b) => a.localeCompare(b)).forEach(group => {
        const cleanGroup = group.replace(/"/g, '&quot;');
        UIElements.groupFilter.innerHTML += `<option value="${cleanGroup}">${group}</option>`;
    });
    UIElements.groupFilter.value = currentVal && UIElements.groupFilter.querySelector(`option[value="${currentVal.replace(/"/g, '&quot;')}"]`) ? currentVal : 'all';
    UIElements.groupFilter.classList.remove('hidden');
};

const populateSourceFilter = () => {
    const currentVal = UIElements.sourceFilter.value;
    UIElements.sourceFilter.innerHTML = `<option value="all">All Sources</option>`;
    [...guideState.channelSources].sort((a, b) => a.localeCompare(b)).forEach(source => {
        const cleanSource = source.replace(/"/g, '&quot;');
        UIElements.sourceFilter.innerHTML += `<option value="${cleanSource}">${source}</option>`;
    });
    UIElements.sourceFilter.value = currentVal && UIElements.sourceFilter.querySelector(`option[value="${currentVal.replace(/"/g, '&quot;')}"]`) ? currentVal : 'all';
    
    UIElements.sourceFilter.classList.remove('hidden');
    UIElements.sourceFilter.style.visibility = guideState.channelSources.size <= 1 ? 'hidden' : 'visible';
};

export function handleSearchAndFilter(isFirstLoad = false) {
    const searchTerm = UIElements.searchInput.value.trim();
    const selectedGroup = UIElements.groupFilter.value;
    const selectedSource = UIElements.sourceFilter.value;
    let channelsForGuide = guideState.channels;

    if (selectedGroup !== 'all') {
        if (selectedGroup === 'favorites') {
            channelsForGuide = channelsForGuide.filter(ch => ch.isFavorite);
        } else if (selectedGroup === 'recents') {
            const recentIds = guideState.settings.recentChannels || [];
            channelsForGuide = recentIds.map(id => guideState.channels.find(ch => ch.id === id)).filter(Boolean);
        } else {
            channelsForGuide = channelsForGuide.filter(ch => ch.group === selectedGroup);
        }
    }
    
    if (selectedSource !== 'all') {
        channelsForGuide = channelsForGuide.filter(ch => ch.source === selectedSource);
    }
    
    if (searchTerm && appState.fuseChannels) {
        // When searching, we combine results from channels and programs but display the full channel list that contains any match.
        const channelResults = appState.fuseChannels.search(searchTerm).map(r => r.item);
        const programResults = (guideState.settings.searchScope === 'channels_programs' && appState.fusePrograms) ? appState.fusePrograms.search(searchTerm) : [];
        
        const programChannelIds = new Set(programResults.map(r => r.item.channel.id));
        const combinedChannelIds = new Set([...channelResults.map(c => c.id), ...programChannelIds]);
        
        // This ensures that if you search for a program, the channel it belongs to is shown in the guide.
        channelsForGuide = guideState.channels.filter(ch => combinedChannelIds.has(ch.id));

        renderSearchResults(channelResults.slice(0, 10), programResults.slice(0, 20));
    } else {
        UIElements.searchResultsContainer.innerHTML = '';
        UIElements.searchResultsContainer.classList.add('hidden');
    }
    
    initializeGuideRender(channelsForGuide, isFirstLoad);
};

const renderSearchResults = (channelResults, programResults) => {
    let html = '';
    if (channelResults.length > 0) {
        html += '<div class="search-results-header">Channels</div>';
        html += channelResults.map(item => `
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

export function setupGuideEventListeners() {
    UIElements.prevDayBtn.addEventListener('click', () => {
        guideState.currentDate.setDate(guideState.currentDate.getDate() - 1);
        finalizeGuideLoad();
    });
    UIElements.todayBtn.addEventListener('click', () => {
        guideState.currentDate = new Date();
        finalizeGuideLoad(true);
    });
    UIElements.nowBtn.addEventListener('click', () => {
        const now = new Date();
        if (guideState.currentDate.toDateString() !== now.toDateString()) {
            guideState.currentDate = now;
            finalizeGuideLoad(true);
        } else {
            const guideStart = new Date(guideState.currentDate);
            guideStart.setHours(0, 0, 0, 0);
            const scrollPos = ((now - guideStart) / 3600000) * guideState.hourWidthPixels - (UIElements.guideTimeline.clientWidth / 4);
            UIElements.guideTimeline.scrollTo({ left: scrollPos, behavior: 'smooth' });
        }
    });
    UIElements.nextDayBtn.addEventListener('click', () => {
        guideState.currentDate.setDate(guideState.currentDate.getDate() + 1);
        finalizeGuideLoad();
    });

    UIElements.groupFilter.addEventListener('change', () => handleSearchAndFilter());
    UIElements.sourceFilter.addEventListener('change', () => handleSearchAndFilter());
    UIElements.searchInput.addEventListener('input', () => {
        clearTimeout(appState.searchDebounceTimer);
        appState.searchDebounceTimer = setTimeout(() => handleSearchAndFilter(false), 250);
    });
    document.addEventListener('click', e => {
        if (!UIElements.searchInput.contains(e.target) && !UIElements.searchResultsContainer.contains(e.target)) {
            UIElements.searchResultsContainer.classList.add('hidden');
        }
    });

    const handleGuideClick = (e) => {
        const target = e.target;
        const channelItem = target.closest('[data-url]');
        const programItem = target.closest('.programme-item');
        const favoriteStar = target.closest('.favorite-star');

        if (favoriteStar) {
            e.stopPropagation(); 
            const channelId = favoriteStar.dataset.channelId;
            const channel = guideState.channels.find(c => c.id === channelId);
            if (!channel) return;
            channel.isFavorite = !channel.isFavorite;
            favoriteStar.classList.toggle('favorited', channel.isFavorite);
            guideState.settings.favorites = guideState.channels.filter(c => c.isFavorite).map(c => c.id);
            saveUserSetting('favorites', guideState.settings.favorites);
            if (UIElements.groupFilter.value === 'favorites') handleSearchAndFilter();
        } else if (programItem) {
             UIElements.detailsTitle.textContent = programItem.dataset.progTitle;
             const progStart = new Date(programItem.dataset.progStart);
             const progStop = new Date(programItem.dataset.progStop);
             UIElements.detailsTime.textContent = `${progStart.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}`;
             UIElements.detailsDesc.textContent = programItem.dataset.progDesc;
             UIElements.detailsPlayBtn.onclick = () => {
                 playChannel(programItem.dataset.channelUrl, `${programItem.dataset.channelName}`, programItem.dataset.channelId);
                 closeModal(UIElements.programDetailsModal);
             };
             openModal(UIElements.programDetailsModal);
        } else if (channelItem) {
             playChannel(channelItem.dataset.url, channelItem.dataset.name, channelItem.dataset.id);
             if (window.innerWidth < 1024) {
                 import('./ui.js').then(({ toggleSidebar }) => toggleSidebar(false));
             }
        }
    };

    ['channelList', 'logoList', 'guideTimeline'].forEach(id => {
        UIElements[id]?.addEventListener('click', handleGuideClick);
    });

    UIElements.searchResultsContainer.addEventListener('click', e => {
        const resultItem = e.target.closest('.search-result-channel, .search-result-program');
        if (!resultItem) return;

        // Clear search and reset filters to make the jump target visible
        UIElements.searchInput.value = '';
        UIElements.searchResultsContainer.classList.add('hidden');
        UIElements.groupFilter.value = 'all';
        UIElements.sourceFilter.value = 'all';
        handleSearchAndFilter(true); // Re-render with all channels

        setTimeout(() => {
            const channelId = resultItem.dataset.channelId;
            const channelIndex = guideState.visibleChannels.findIndex(c => c.id === channelId);
    
            if (channelIndex > -1) {
                const targetScrollTop = channelIndex * rowHeight - (UIElements.guideTimeline.clientHeight / 2) + (rowHeight / 2);
                ['channelList', 'logoList', 'guideTimeline'].forEach(id => {
                    UIElements[id]?.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
                });
            }
        }, 150); 
    });
    
    // --- Optimized Scrolling Sync ---
    const onScroll = (e) => {
        if (scrollRequest) {
            cancelAnimationFrame(scrollRequest);
        }
        scrollRequest = requestAnimationFrame(() => {
            const source = e.target;
            const { scrollTop, scrollLeft } = source;
            
            if (source === UIElements.guideTimeline) {
                if(UIElements.timeBar) UIElements.timeBar.scrollLeft = scrollLeft;
                if(UIElements.channelList && UIElements.channelList.scrollTop !== scrollTop) UIElements.channelList.scrollTop = scrollTop;
                if(UIElements.logoList && UIElements.logoList.scrollTop !== scrollTop) UIElements.logoList.scrollTop = scrollTop;
            } else if (source === UIElements.channelList) {
                if(UIElements.guideTimeline && UIElements.guideTimeline.scrollTop !== scrollTop) UIElements.guideTimeline.scrollTop = scrollTop;
                if(UIElements.logoList && UIElements.logoList.scrollTop !== scrollTop) UIElements.logoList.scrollTop = scrollTop;
            } else { // logoList
                if(UIElements.guideTimeline && UIElements.guideTimeline.scrollTop !== scrollTop) UIElements.guideTimeline.scrollTop = scrollTop;
                if(UIElements.channelList && UIElements.channelList.scrollTop !== scrollTop) UIElements.channelList.scrollTop = scrollTop;
            }
            renderVisibleGuide();
            scrollRequest = null;
        });
    };

    ['guideTimeline', 'channelList', 'logoList'].forEach(id => {
         UIElements[id]?.addEventListener('scroll', onScroll, { passive: true });
    });

    // --- Panel Resizer ---
    UIElements.resizer?.addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.clientX, startWidth = UIElements.channelPanelContainer.offsetWidth;
        const doResize = (e) => UIElements.channelPanelContainer.style.width = `${Math.max(250, startWidth + e.clientX - startX)}px`;
        const stopResize = () => {
            window.removeEventListener('mousemove', doResize);
            window.removeEventListener('mouseup', stopResize);
        };
        window.addEventListener('mousemove', doResize);
        window.addEventListener('mouseup', stopResize);
    }, false);

    // --- Collapsing Header ---
    let lastScrollTop = 0;
    const handleHeaderAndButtonVisibility = () => {
        const scrollTop = UIElements.guideTimeline.scrollTop;
        if (Math.abs(scrollTop - lastScrollTop) <= 10) return;
        const isScrollingDown = scrollTop > lastScrollTop;
        const isCollapsed = UIElements.appContainer.classList.contains('header-collapsed');
        if (isScrollingDown && scrollTop > 150 && !isCollapsed) {
            UIElements.appContainer.classList.add('header-collapsed');
            UIElements.showHeaderBtn.classList.remove('hidden');
        } else if (!isScrollingDown && scrollTop < 10 && isCollapsed) {
            UIElements.appContainer.classList.remove('header-collapsed');
            UIElements.showHeaderBtn.classList.add('hidden');
        }
        lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
    };
    UIElements.guideTimeline.addEventListener('scroll', throttle(handleHeaderAndButtonVisibility, 100), { passive: true });
    UIElements.showHeaderBtn.addEventListener('click', () => {
        UIElements.appContainer.classList.remove('header-collapsed');
        UIElements.showHeaderBtn.classList.add('hidden');
        UIElements.guideTimeline.scrollTo({ top: 0, behavior: 'smooth' });
    });
}
