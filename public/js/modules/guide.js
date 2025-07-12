/**
 * guide.js
 * * Manages all functionality related to the TV Guide,
 * including data loading, rendering, searching, and user interaction.
 *
 * This version is refactored to use UI Virtualization for performance.
 */

import { appState, guideState, UIElements } from './state.js';
import { apiFetch, saveUserSetting } from './api.js';
import { parseM3U } from './utils.js';
import { playChannel } from './player.js';
import { showNotification, openModal, closeModal } from './ui.js';

// --- Virtualization Constants ---
const ROW_HEIGHT = 96; // The height of each channel row in pixels (h-24 in Tailwind)
let renderTimeout;

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
    appState.db?.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.channels, 'channels');
    appState.db?.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.programs, 'programs');

    finalizeGuideLoad(true);
}

/**
 * Finalizes the guide setup after data is loaded from any source (API or cache).
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

// --- UI Rendering (Virtualization) ---

/**
 * Sets up the main guide container for virtual scrolling.
 * It doesn't render rows itself, but prepares the space and triggers the first render.
 * @param {Array<object>} channelsToRender - The filtered list of channels to display.
 * @param {boolean} resetScroll - If true, scrolls the guide to the top-left.
 */
const renderGuide = (channelsToRender, resetScroll = false) => {
    guideState.visibleChannels = channelsToRender;
    const showNoData = guideState.channels.length === 0;

    UIElements.guidePlaceholder.classList.toggle('hidden', !showNoData);
    UIElements.noDataMessage.classList.toggle('hidden', !showNoData);
    UIElements.initialLoadingIndicator.classList.add('hidden');
    UIElements.guideGridContainer?.classList.toggle('hidden', showNoData);

    if (showNoData) return;

    if (resetScroll) {
        UIElements.guideGridContainer.scrollTop = 0;
    }
    
    UIElements.guideDateDisplay.textContent = guideState.currentDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });

    // Render time bar (this doesn't need to be virtualized as it's static)
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
    UIElements.timeBar.innerHTML = '';
    UIElements.timeBar.appendChild(timeBarContent);
    UIElements.timeBar.appendChild(document.getElementById('now-line-template').content.cloneNode(true));
    
    // Set the total height of the scrollable area to fake the presence of all rows
    UIElements.guideGridScroller.style.height = `${channelsToRender.length * ROW_HEIGHT}px`;

    // Perform the initial render of visible rows
    renderVisibleRows();
    updateNowLine(resetScroll);
};

/**
 * Renders only the rows that should be visible in the viewport.
 * This is the core of the virtualization logic.
 */
const renderVisibleRows = () => {
    const container = UIElements.guideGridContainer;
    const content = UIElements.guideGridContent;
    const channels = guideState.visibleChannels;
    const scrollTop = container.scrollTop;
    
    // Calculate which rows to render
    const startIndex = Math.floor(scrollTop / ROW_HEIGHT);
    const visibleRowCount = Math.ceil(container.clientHeight / ROW_HEIGHT);
    const endIndex = Math.min(startIndex + visibleRowCount + 5, channels.length); // +5 for buffer
    
    // Get the slice of channels to display
    const visibleItems = channels.slice(startIndex, endIndex);

    const sourceColors = ['bg-blue-600', 'bg-green-600', 'bg-pink-600', 'bg-yellow-500', 'bg-indigo-600', 'bg-red-600'];
    const sourceColorMap = new Map();
    let colorIndex = 0;

    let rowsHtml = '';
    const now = new Date();
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);

    visibleItems.forEach(channel => {
        const channelName = channel.displayName || channel.name;

        if (!sourceColorMap.has(channel.source)) {
            sourceColorMap.set(channel.source, sourceColors[colorIndex % sourceColors.length]);
            colorIndex++;
        }
        const sourceBadgeColor = sourceColorMap.get(channel.source);
        const sourceBadgeHTML = guideState.channelSources.size > 1 ? `<span class="source-badge ${sourceBadgeColor} text-white">${channel.source}</span>` : '';
        const chnoBadgeHTML = channel.chno ? `<span class="chno-badge">${channel.chno}</span>` : '';
        
        let programsHTML = '';
        const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);
        (guideState.programs[channel.id] || []).forEach(prog => {
            const progStart = new Date(prog.start);
            const progStop = new Date(prog.stop);
            if (progStop < guideStart || progStart > guideEnd || (progStop - progStart) <= 0) return;

            const left = ((progStart - guideStart) / 3600000) * guideState.hourWidthPixels;
            const width = ((progStop - progStart) / 3600000) * guideState.hourWidthPixels;
            const isLive = now >= progStart && now < progStop;
            const progressWidth = isLive ? ((now - progStart) / (progStop - progStart)) * 100 : 0;
            
            programsHTML += `<div class="programme-item absolute top-1 bottom-1 bg-gray-800 rounded-md p-2 overflow-hidden flex flex-col justify-center z-5 ${isLive ? 'live' : ''} ${progStop < now ? 'past' : ''}" style="left:${left}px; width:${Math.max(0, width - 2)}px" data-channel-url="${channel.url}" data-channel-id="${channel.id}" data-channel-name="${channelName}" data-prog-title="${prog.title}" data-prog-desc="${prog.desc}" data-prog-start="${progStart.toISOString()}" data-prog-stop="${progStop.toISOString()}"><div class="programme-progress" style="width:${progressWidth}%"></div><p class="prog-title text-white font-semibold truncate relative z-10">${prog.title}</p><p class="prog-time text-gray-400 truncate relative z-10">${progStart.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</p></div>`;
        });
        
        rowsHtml += `
            <div class="guide-row grid grid-cols-[var(--channel-width)_1fr] h-24 border-b border-gray-700/50">
                <div class="channel-cell flex items-center justify-between p-2 flex-shrink-0">
                     <div class="flex items-center overflow-hidden cursor-pointer flex-grow min-w-0" data-url="${channel.url}" data-name="${channelName}" data-id="${channel.id}">
                        <img src="${channel.logo}" onerror="this.onerror=null; this.src='https.placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-12 h-12 object-contain mr-3 flex-shrink-0 rounded-md bg-gray-700">
                        <div class="flex-grow min-w-0">
                            <span class="font-semibold text-sm truncate block">${channelName}</span>
                            <div class="flex items-center gap-2 mt-1">
                                ${chnoBadgeHTML}
                                ${sourceBadgeHTML}
                            </div>
                        </div>
                    </div>
                    <svg data-channel-id="${channel.id}" class="w-6 h-6 text-gray-500 hover:text-yellow-400 favorite-star cursor-pointer flex-shrink-0 ml-2 ${channel.isFavorite ? 'favorited' : ''}" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8-2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
                </div>
                <div class="program-cell relative">${programsHTML}</div>
            </div>`;
    });

    content.innerHTML = rowsHtml;
    // Position the content block to the correct scroll offset
    content.style.transform = `translateY(${startIndex * ROW_HEIGHT}px)`;
};

/**
 * Updates the position of the "now" line and program states (live, past).
 * @param {boolean} shouldScroll - If true, scrolls the timeline to the now line.
 */
const updateNowLine = (shouldScroll = false) => {
    const nowLineEl = document.getElementById('now-line');
    if (!nowLineEl) return;
    
    const guideStart = new Date(guideState.currentDate);
    guideStart.setHours(0, 0, 0, 0);

    const now = new Date();
    const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);

    if (now >= guideStart && now <= guideEnd) {
        const left = ((now - guideStart) / 3600000) * guideState.hourWidthPixels;
        nowLineEl.style.left = `${left}px`;
        nowLineEl.classList.remove('hidden');
        if (shouldScroll) {
            UIElements.timelineContainer.scrollLeft = left - (UIElements.timelineContainer.clientWidth / 4);
        }
    } else {
        nowLineEl.classList.add('hidden');
    }

    // Update progress bars (this will only affect visible items)
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

    setTimeout(() => updateNowLine(false), 60000); // Schedule next update
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
    
    if (searchTerm && appState.fuseChannels && appState.fusePrograms) {
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        channelsForGuide = channelsForGuide.filter(ch =>
            (ch.displayName || ch.name).toLowerCase().includes(lowerCaseSearchTerm) ||
            (ch.source && ch.source.toLowerCase().includes(lowerCaseSearchTerm)) ||
            (ch.chno && ch.chno.toLowerCase().includes(lowerCaseSearchTerm))
        );
        const channelResults = appState.fuseChannels.search(searchTerm).slice(0, 10);
        let programResults = (guideState.settings.searchScope === 'channels_programs') ? appState.fusePrograms.search(searchTerm).slice(0, 20) : [];
        renderSearchResults(channelResults, programResults);
    } else {
        UIElements.searchResultsContainer.innerHTML = '';
        UIElements.searchResultsContainer.classList.add('hidden');
    }
    
    renderGuide(channelsForGuide, isFirstLoad);
};

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
        if (guideState.currentDate.toDateString() !== now.toDateString()) {
            guideState.currentDate = now;
            finalizeGuideLoad();
            setTimeout(() => renderGuide(guideState.visibleChannels, true), 50);
        } else {
            const guideStart = new Date(guideState.currentDate);
            guideStart.setHours(0, 0, 0, 0);
            const scrollPos = ((now - guideStart) / 3600000) * guideState.hourWidthPixels - (UIElements.timelineContainer.clientWidth / 4);
            UIElements.timelineContainer.scrollTo({ left: scrollPos, behavior: 'smooth' });
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
    document.addEventListener('click', e => {
        if (!UIElements.searchInput.contains(e.target) && !UIElements.searchResultsContainer.contains(e.target)) {
            UIElements.searchResultsContainer.classList.add('hidden');
        }
    });

    // --- Guide Grid Interactions (Event Delegation) ---
    UIElements.guideGridContent.addEventListener('click', e => {
        const playElement = e.target.closest('[data-url]');
        const favElement = e.target.closest('.favorite-star');
        const progElement = e.target.closest('.programme-item');

        if (favElement) {
            e.stopPropagation(); // Prevent event from bubbling to the play element
            const channelId = favElement.dataset.channelId;
            const channel = guideState.channels.find(c => c.id === channelId);
            if (!channel) return;

            channel.isFavorite = !channel.isFavorite;
            favElement.classList.toggle('favorited', channel.isFavorite);
            
            guideState.settings.favorites = guideState.channels.filter(c => c.isFavorite).map(c => c.id);
            saveUserSetting('favorites', guideState.settings.favorites);
            
            if (UIElements.groupFilter.value === 'favorites') {
                handleSearchAndFilter();
            }
        } else if (playElement) {
            playChannel(playElement.dataset.url, playElement.dataset.name, playElement.dataset.id);
        } else if (progElement) {
            UIElements.detailsTitle.textContent = progElement.dataset.progTitle;
            const progStart = new Date(progElement.dataset.progStart);
            const progStop = new Date(progElement.dataset.progStop);
            UIElements.detailsTime.textContent = `${progStart.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}`;
            UIElements.detailsDesc.textContent = progElement.dataset.progDesc || "No description available.";
            UIElements.detailsPlayBtn.onclick = () => {
                playChannel(progElement.dataset.channelUrl, `${progElement.dataset.channelName}`, progElement.dataset.channelId);
                closeModal(UIElements.programDetailsModal);
            };
            openModal(UIElements.programDetailsModal);
        }
    });

    // --- Search Results Click ---
    UIElements.searchResultsContainer.addEventListener('click', e => {
        // This functionality could be enhanced to scroll to the selected item.
        // For now, it's kept simple.
    });

    // --- SCROLLING LOGIC (VIRTUALIZED) ---
    UIElements.timelineContainer.addEventListener('scroll', (e) => {
        UIElements.timeBar.scrollLeft = e.target.scrollLeft;
    });

    UIElements.guideGridContainer.addEventListener('scroll', () => {
        // Use requestAnimationFrame to prevent layout thrashing on scroll
        cancelAnimationFrame(renderTimeout);
        renderTimeout = requestAnimationFrame(renderVisibleRows);
    }, { passive: true });


    // --- Resizer for Channel Panel ---
    UIElements.resizer.addEventListener('mousedown', e => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = UIElements.guideContainer.style.getPropertyValue('--channel-width');
        const startWidthPx = parseInt(startWidth, 10);
        
        const doResize = (e) => {
            const newWidth = Math.max(250, startWidthPx + e.clientX - startX);
            UIElements.guideContainer.style.setProperty('--channel-width', `${newWidth}px`);
        };
        const stopResize = () => {
            window.removeEventListener('mousemove', doResize);
            window.removeEventListener('mouseup', stopResize);
        };
        window.addEventListener('mousemove', doResize);
        window.addEventListener('mouseup', stopResize);
    }, false);


    // --- Collapsing Header Logic ---
    let lastScrollTop = 0;
    const handleHeaderAndButtonVisibility = () => {
        const scrollTop = UIElements.guideGridContainer.scrollTop;
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
    UIElements.guideGridContainer.addEventListener('scroll', throttle(handleHeaderAndButtonVisibility, 100), { passive: true });
    UIElements.showHeaderBtn.addEventListener('click', () => {
        UIElements.appContainer.classList.remove('header-collapsed');
        UIElements.showHeaderBtn.classList.add('hidden');
        UIElements.guideGridContainer.scrollTo({ top: 0, behavior: 'smooth' });
    });
}
