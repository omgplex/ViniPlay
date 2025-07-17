import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FixedSizeGrid } from 'react-window'; // Assumes react-window is available
import Fuse from 'fuse.js'; // Assuming Fuse.js is globally available or imported

// Helper for debouncing
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

const CHANNEL_ROW_HEIGHT = 96; // Fixed height for each channel row
const TIME_BAR_HEIGHT = 64; // Height of the sticky time bar
const CHANNEL_COL_MIN_WIDTH = 64; // Min width for mobile, can be default for desktop
const PROGRAM_ITEM_VERTICAL_PADDING = 2; // top: 1px, bottom: 1px for program items
const FUSE_SEARCH_DEBOUNCE_MS = 250;

// Cell Renderer for the Grid
const Cell = React.memo(({ columnIndex, rowIndex, style, data }) => {
    const {
        channels,
        programs,
        guideStart,
        hourWidthPixels,
        timelineWidth,
        channelColumnWidth,
        playChannel,
        showProgramDetails,
        toggleFavorite,
        sourceColors,
        channelSourcesSize,
        guideDurationHours,
        searchHighlightProgramId,
        searchHighlightChannelId
    } = data;

    const channel = channels[rowIndex];
    if (!channel) return null; // Should not happen with correct row count

    // First column is sticky channel info
    if (columnIndex === 0) {
        const channelName = channel.displayName || channel.name;
        const sourceBadgeColor = sourceColors.get(channel.source) || 'bg-gray-500';
        const sourceBadgeHTML = channelSourcesSize > 1 ? (
            <span className={`source-badge ${sourceBadgeColor} text-white`}>{channel.source}</span>
        ) : null;
        const chnoBadgeHTML = channel.chno ? (
            <span className="chno-badge">{channel.chno}</span>
        ) : null;

        const isHighlighted = searchHighlightChannelId === channel.id;

        return (
            <div
                className={`react-channel-info-cell ${isHighlighted ? 'highlighted-search' : ''}`}
                style={{ ...style, width: channelColumnWidth, height: CHANNEL_ROW_HEIGHT }}
                onClick={() => playChannel(channel.url, channelName, channel.id)}
            >
                <div className="flex items-center overflow-hidden flex-grow min-w-0">
                    <img
                        src={channel.logo}
                        onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/48x48/1f2937/d1d5db?text=?'; }}
                        className="w-12 h-12 object-contain mr-3 flex-shrink-0 rounded-md bg-gray-700"
                        alt={`${channelName} logo`}
                    />
                    <div className="flex-grow min-w-0 channel-details">
                        <span className="font-semibold text-sm truncate block">{channelName}</span>
                        <div className="flex items-center gap-2 mt-1">
                            {chnoBadgeHTML}
                            {sourceBadgeHTML}
                        </div>
                    </div>
                </div>
                <svg
                    data-channel-id={channel.id}
                    className={`w-6 h-6 text-gray-500 hover:text-yellow-400 favorite-star cursor-pointer flex-shrink-0 ml-2 ${channel.isFavorite ? 'favorited' : ''}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(channel.id); }}
                >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8-2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
                </svg>
            </div>
        );
    }

    // Second column is the timeline row with programs
    if (columnIndex === 1) {
        const now = new Date();
        const guideEnd = new Date(guideStart.getTime() + guideDurationHours * 3600 * 1000);
        
        const channelPrograms = (programs[channel.id] || [])
            .filter(prog => new Date(prog.stop) > guideStart && new Date(prog.start) < guideEnd);

        return (
            <div
                className="react-timeline-row"
                style={{ ...style, width: timelineWidth, height: CHANNEL_ROW_HEIGHT }}
            >
                {channelPrograms.map((prog, progIndex) => {
                    const progStart = new Date(prog.start);
                    const progStop = new Date(prog.stop);
                    const durationMs = progStop - progStart;
                    if (durationMs <= 0) return null;

                    const left = ((progStart - guideStart) / 3600000) * hourWidthPixels;
                    const width = (durationMs / 3600000) * hourWidthPixels;
                    const isLive = now >= progStart && now < progStop;
                    const progressWidth = isLive ? ((now - progStart) / durationMs) * 100 : 0;

                    const isHighlighted = searchHighlightProgramId === `${channel.id}-${prog.start}`;
                    
                    const programStyle = {
                        left: `${left}px`,
                        width: `${Math.max(0, width - PROGRAM_ITEM_VERTICAL_PADDING)}px`, // Account for padding
                        height: `${CHANNEL_ROW_HEIGHT - (PROGRAM_ITEM_VERTICAL_PADDING * 2)}px`, // Fill available height
                        display: 'flex', // Needed for inner flex content
                    };

                    return (
                        <div
                            key={`${channel.id}-${prog.start}`} // Unique key for program item
                            className={`react-programme-item ${isLive ? 'live' : ''} ${progStop < now ? 'past' : ''} ${isHighlighted ? 'highlighted-search' : ''}`}
                            style={programStyle}
                            onClick={() => showProgramDetails(channel, prog)}
                            data-prog-start={prog.start} // For imperatively updating now line & search scroll
                            data-channel-id={channel.id}
                        >
                            <div className="programme-progress" style={{ width: `${progressWidth}%` }}></div>
                            <p className="prog-title truncate relative z-10">{prog.title}</p>
                            <p className="prog-time truncate relative z-10">
                                {progStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {progStop.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                        </div>
                    );
                })}
            </div>
        );
    }
    return null;
});

// React Guide Component
const ReactGuide = ({
    channels: initialChannels,
    programs: initialPrograms,
    settings: initialSettings,
    playChannel,
    showConfirm, // Passed from main.js for settings actions
    saveUserSetting, // Passed from main.js for user settings
    showProgramDetailsModal, // The original function from player.js
    onDateChange, // Callback to update date in main.js
    guideDateDisplay, // Date string from main.js (updated from parent)
    onSearchAndFilter, // Callback to trigger main.js search/filter
    channelGroups: initialChannelGroups, // Pre-populated group filter options from main.js
    channelSources: initialChannelSources, // Pre-populated source filter options from main.js
    onToggleHeaderVisibility // Callback to main.js for header collapse
}) => {
    const [channels, setChannels] = useState(initialChannels);
    const [programs, setPrograms] = useState(initialPrograms);
    const [settings, setSettings] = useState(initialSettings);
    const [currentDate, setCurrentDate] = useState(new Date(guideDateDisplay)); // Use prop for initial date
    const [guideDurationHours, setGuideDurationHours] = useState(initialSettings.guideDurationHours || 48);
    const [hourWidthPixels, setHourWidthPixels] = useState(window.innerWidth < 768 ? 200 : 300);
    const [channelColumnWidth, setChannelColumnWidth] = useState(initialSettings.channelColumnWidth || (window.innerWidth < 768 ? 64 : 180));
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [selectedSource, setSelectedSource] = useState('all');
    const [searchResults, setSearchResults] = useState({ channels: [], programs: [] });
    const [showSearchResults, setShowSearchResults] = useState(false);
    const [fuseChannels, setFuseChannels] = useState(null);
    const [fusePrograms, setFusePrograms] = useState(null);
    const [searchHighlightProgramId, setSearchHighlightProgramId] = useState(null); // For highlighting a program
    const [searchHighlightChannelId, setSearchHighlightChannelId] = useState(null); // For highlighting a channel

    const gridRef = useRef(null); // Ref for react-window FixedSizeGrid
    const nowLineRef = useRef(null);
    const searchDebounceTimerRef = useRef(null);
    const channelResizeHandleRef = useRef(null); // Ref for the resize handle element

    // Derived state for unique channel groups and sources for render options
    const [renderedChannelGroups, setRenderedChannelGroups] = useState(new Set());
    const [renderedChannelSources, setRenderedChannelSources] = useState(new Set());
    const sourceColors = useRef(new Map());

    // Update filter options based on initialChannels
    const updateFilterOptions = useCallback((channelsData) => {
        const groups = new Set();
        const sources = new Set();
        const colors = ['bg-blue-600', 'bg-green-600', 'bg-pink-600', 'bg-yellow-500', 'bg-indigo-600', 'bg-red-600'];
        let colorIndex = 0;
        const colorMap = new Map();

        channelsData.forEach(ch => {
            if (ch.group) groups.add(ch.group);
            if (ch.source) {
                sources.add(ch.source);
                if (!colorMap.has(ch.source)) {
                    colorMap.set(ch.source, colors[colorIndex % colors.length]);
                    colorIndex++;
                }
            }
        });
        setRenderedChannelGroups(groups);
        setRenderedChannelSources(sources);
        sourceColors.current = colorMap;
    }, []);

    // Effect to update internal state when props change (data, settings)
    useEffect(() => {
        setChannels(initialChannels);
        setPrograms(initialPrograms);
        setSettings(initialSettings);
        setGuideDurationHours(initialSettings.guideDurationHours || 48);
        setHourWidthPixels(window.innerWidth < 768 ? 200 : 300);
        setChannelColumnWidth(initialSettings.channelColumnWidth || (window.innerWidth < 768 ? 64 : 180));
        setCurrentDate(new Date(guideDateDisplay)); // Update currentDate
        
        updateFilterOptions(initialChannels);

        // Re-initialize Fuse.js for fuzzy searching channels
        setFuseChannels(new Fuse(initialChannels, {
            keys: ['name', 'displayName', 'source', 'chno'],
            threshold: 0.4,
            includeScore: true,
        }));

        // Prepare program data for searching (based on current date and guide duration)
        const allPrograms = [];
        const guideStart = new Date(currentDate);
        guideStart.setHours(0, 0, 0, 0);
        const guideEnd = new Date(guideStart.getTime() + (initialSettings.guideDurationHours || 48) * 3600 * 1000);

        for (const channelId in initialPrograms) {
            const channel = initialChannels.find(c => c.id === channelId);
            if (channel) {
                initialPrograms[channelId].forEach(prog => {
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
        setFusePrograms(new Fuse(allPrograms, {
            keys: ['title'],
            threshold: 0.4,
            includeScore: true,
        }));
        
        applySearchAndFilter(); // Apply filters/search with new data
        // Reset highlights when data changes
        setSearchHighlightProgramId(null);
        setSearchHighlightChannelId(null);

    }, [initialChannels, initialPrograms, initialSettings, guideDateDisplay, updateFilterOptions]);


    // Function to apply filters and search logic
    const applySearchAndFilter = useCallback(() => {
        let filteredChannels = [...initialChannels];

        // Apply group filter
        if (selectedGroup !== 'all') {
            if (selectedGroup === 'favorites') {
                const favoriteIds = new Set(settings.favorites || []);
                filteredChannels = filteredChannels.filter(ch => favoriteIds.has(ch.id));
            } else if (selectedGroup === 'recents') {
                const recentIds = settings.recentChannels || [];
                // Ensure channels are in the order of recentIds
                filteredChannels = recentIds.map(id => filteredChannels.find(ch => ch.id === id)).filter(Boolean);
            } else {
                filteredChannels = filteredChannels.filter(ch => ch.group === selectedGroup);
            }
        }
        
        // Apply source filter
        if (selectedSource !== 'all') {
            filteredChannels = filteredChannels.filter(ch => ch.source === selectedSource);
        }
        
        // Apply search term and render search results box
        if (searchTerm && fuseChannels && fusePrograms) {
            const channelFuseResults = fuseChannels.search(searchTerm).slice(0, 10);
            
            let programFuseResults = [];
            if (settings.searchScope === 'channels_programs') {
                programFuseResults = fusePrograms.search(searchTerm).slice(0, 20);
            }
            setSearchResults({ channels: channelFuseResults, programs: programFuseResults });
            setShowSearchResults(true);
        } else {
            setSearchResults({ channels: [], programs: [] });
            setShowSearchResults(false);
        }
        
        setChannels(filteredChannels); // Update the channels state for rendering in the grid
        if (gridRef.current) {
            gridRef.current.scrollTo({ scrollTop: 0, scrollLeft: 0 }); // Reset grid scroll on filter/search change
        }
        // Notify parent (main.js) about the filter/search state
        onSearchAndFilter(searchTerm, selectedGroup, selectedSource);
    }, [initialChannels, selectedGroup, selectedSource, searchTerm, settings, fuseChannels, fusePrograms, onSearchAndFilter]);


    // Effect to re-apply search/filters when selected filters change
    useEffect(() => {
        applySearchAndFilter();
    }, [selectedGroup, selectedSource]); // Only re-run when filters change


    // Update the now line position periodically and program live/past states
    useEffect(() => {
        const updateLineAndProgramStates = () => {
            const nowLineEl = nowLineRef.current;
            const gridContainerEl = gridRef.current?._outerRef; // react-window's scrollable container

            if (!nowLineEl || !gridContainerEl) return;

            const now = new Date();
            const guideStart = new Date(currentDate);
            guideStart.setHours(0, 0, 0, 0);
            const guideEnd = new Date(guideStart.getTime() + guideDurationHours * 3600 * 1000);

            const channelInfoColWidth = channelColumnWidth;
            const gridScrollLeft = gridContainerEl.scrollLeft;
            const gridScrollTop = gridContainerEl.scrollTop;

            if (now >= guideStart && now <= guideEnd) {
                const leftOffsetInScrollableArea = ((now - guideStart) / 3600000) * hourWidthPixels;
                nowLineEl.style.left = `${channelInfoColWidth + leftOffsetInScrollableArea - gridScrollLeft}px`;
                nowLineEl.classList.remove('hidden');
                // Adjust height of now-line to cover current visible grid area + top/bottom buffer
                // This is approximate but better than full document height
                nowLineEl.style.height = `${gridContainerEl.clientHeight}px`;
                nowLineEl.style.top = `${gridScrollTop}px`;
            } else {
                nowLineEl.classList.add('hidden');
            }

            // Imperatively update progress bars and states for all visible programs
            // This avoids re-rendering the whole grid just for progress bars
            gridContainerEl.querySelectorAll('.react-programme-item').forEach(item => {
                const progStart = new Date(item.dataset.progStart);
                const isLive = now >= progStart && now < new Date(progStart.getTime() + (new Date(item.dataset.progStop) - progStart)); // Recalculate duration
                const progressEl = item.querySelector('.programme-progress');
                if (progressEl) {
                    if (isLive) {
                        const durationMs = new Date(item.dataset.progStop) - progStart;
                        progressEl.style.width = `${((now - progStart) / durationMs) * 100}%`;
                        item.classList.add('live');
                        item.classList.remove('past');
                    } else if (now >= new Date(item.dataset.progStop)) {
                        item.classList.add('past');
                        item.classList.remove('live');
                        progressEl.style.width = '0%'; // No progress for past programs
                    } else {
                        item.classList.remove('live', 'past');
                        progressEl.style.width = '0%';
                    }
                }
            });
        };

        const interval = setInterval(updateLineAndProgramStates, 10000); // Update every 10 seconds
        updateLineAndProgramStates(); // Initial call
        return () => clearInterval(interval);
    }, [currentDate, guideDurationHours, hourWidthPixels, channelColumnWidth]);


    // Handle horizontal scrolling of the grid to center "now" line
    const scrollToNow = useCallback(() => {
        const now = new Date();
        const guideStart = new Date(currentDate);
        guideStart.setHours(0, 0, 0, 0);

        if (now >= guideStart && now <= new Date(guideStart.getTime() + guideDurationHours * 3600 * 1000)) {
            const leftOffsetInScrollableArea = ((now - guideStart) / 3600000) * hourWidthPixels;
            if (gridRef.current) {
                // Scroll horizontally to roughly center the now line
                gridRef.current.scrollTo({
                    scrollLeft: leftOffsetInScrollableArea - (gridRef.current.props.width / 4), // Use grid width for centering
                    behavior: 'smooth'
                });
            }
        }
    }, [currentDate, guideDurationHours, hourWidthPixels]);

    // Handle channel column resizing
    useEffect(() => {
        const handleEl = channelResizeHandleRef.current;
        if (!handleEl) return;

        let startWidth;
        let startX;
        let resizeDebounceTimer;

        const doResize = (e) => {
            const newWidth = startWidth + (e.clientX - startX);
            const finalWidth = Math.max(CHANNEL_COL_MIN_WIDTH, newWidth);
            setChannelColumnWidth(finalWidth);
            // Update CSS variable immediately for visual feedback
            document.getElementById('react-guide-root').style.setProperty('--channel-col-width', `${finalWidth}px`);
        };

        const stopResize = () => {
            window.removeEventListener('mousemove', doResize);
            window.removeEventListener('mouseup', stopResize);
            document.body.style.cursor = ''; // Reset cursor

            clearTimeout(resizeDebounceTimer);
            resizeDebounceTimer = setTimeout(() => {
                saveUserSetting('channelColumnWidth', channelColumnWidth); // Save to server
            }, 500);
        };

        const onMouseDown = (e) => {
            e.preventDefault();
            // Only enable if not on mobile (where column is fixed)
            if (window.innerWidth < 768) return;

            startX = e.clientX;
            startWidth = channelColumnWidth; // Use current React state width

            document.body.style.cursor = 'ew-resize';
            window.addEventListener('mousemove', doResize);
            window.addEventListener('mouseup', stopResize);
        };

        handleEl.addEventListener('mousedown', onMouseDown);

        // Set initial CSS variable
        document.getElementById('react-guide-root').style.setProperty('--channel-col-width', `${channelColumnWidth}px`);

        return () => {
            handleEl.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', doResize);
            window.removeEventListener('mouseup', stopResize);
            clearTimeout(resizeDebounceTimer);
        };
    }, [channelColumnWidth, saveUserSetting]); // Re-run effect if channelColumnWidth changes (for debounce)


    // Callback for scroll events from react-window's Grid
    const handleGridScroll = useCallback(throttle(({ scrollLeft, scrollTop }) => {
        const mainHeader = document.getElementById('main-header');
        const unifiedGuideHeader = document.getElementById('unified-guide-header');

        const headerHeight = (mainHeader?.offsetHeight || 0) + (unifiedGuideHeader?.offsetHeight || 0);
        
        // This threshold determines when headers collapse/expand
        const collapseThreshold = headerHeight / 2;

        if (scrollTop > collapseThreshold) {
            onToggleHeaderVisibility(true); // Collapse headers
        } else {
            onToggleHeaderVisibility(false); // Show headers
        }

        // Update the now line's horizontal position based on grid scrollLeft
        const nowLineEl = nowLineRef.current;
        if (nowLineEl) {
            const now = new Date();
            const guideStart = new Date(currentDate);
            guideStart.setHours(0, 0, 0, 0);
            const leftOffsetInScrollableArea = ((now - guideStart) / 3600000) * hourWidthPixels;
            const channelInfoColWidth = channelColumnWidth;
            nowLineEl.style.left = `${channelInfoColWidth + leftOffsetInScrollableArea - scrollLeft}px`;
            nowLineEl.style.top = `${scrollTop}px`; // Keep now line visible vertically
        }

    }, 100), [onToggleHeaderVisibility, currentDate, hourWidthPixels, channelColumnWidth]);


    // Search result click handlers (will scroll grid and highlight)
    const handleSearchResultChannelClick = useCallback((channelId) => {
        setShowSearchResults(false);
        setSearchTerm(''); // Clear search input
        const channelIndex = channels.findIndex(ch => ch.id === channelId);
        if (channelIndex !== -1 && gridRef.current) {
            gridRef.current.scrollToItem({
                rowIndex: channelIndex,
                align: 'center',
                columnIndex: 0 // Scroll to the channel column
            });
            setSearchHighlightChannelId(channelId);
            setSearchHighlightProgramId(null); // Clear program highlight
            setTimeout(() => setSearchHighlightChannelId(null), 3000); // Remove highlight
        }
    }, [channels]);

    const handleSearchResultProgramClick = useCallback((channelId, progStartISO) => {
        setShowSearchResults(false);
        setSearchTerm(''); // Clear search input

        const progStart = new Date(progStartISO);
        const currentGuideStart = new Date(currentDate);
        currentGuideStart.setHours(0,0,0,0);

        // Calculate if the program is on a different day than currently displayed
        const dateDiff = Math.floor((progStart - currentGuideStart) / (1000 * 60 * 60 * 24));
        if (dateDiff !== 0) {
            // If it's a different day, update the current date
            const newDate = new Date(currentDate);
            newDate.setDate(currentDate.getDate() + dateDiff);
            onDateChange(newDate); // This will cause a re-render of the ReactGuide with new initialChannels/programs
            // The scroll and highlight will happen after the new data is loaded and rendered
            setTimeout(() => {
                const channelIndex = channels.findIndex(ch => ch.id === channelId);
                if (channelIndex !== -1 && gridRef.current) {
                    gridRef.current.scrollToItem({
                        rowIndex: channelIndex,
                        align: 'center',
                        columnIndex: 1 // Scroll to the program column
                    });
                    setSearchHighlightProgramId(`${channelId}-${progStartISO}`);
                    setSearchHighlightChannelId(null);
                    setTimeout(() => setSearchHighlightProgramId(null), 3000);
                }
            }, 500); // Give time for data to load and render
        } else {
            // Same day, just scroll and highlight
            const channelIndex = channels.findIndex(ch => ch.id === channelId);
            if (channelIndex !== -1 && gridRef.current) {
                gridRef.current.scrollToItem({
                    rowIndex: channelIndex,
                    align: 'center',
                    columnIndex: 1 // Scroll to the program column
                });
                setSearchHighlightProgramId(`${channelId}-${progStartISO}`);
                setSearchHighlightChannelId(null);
                setTimeout(() => setSearchHighlightProgramId(null), 3000);
            }
        }
    }, [channels, currentDate, onDateChange]);


    // Column widths for react-window
    const columnWidths = [
        channelColumnWidth, // Sticky channel info column
        guideDurationHours * hourWidthPixels // Main timeline column
    ];
    const columnCount = 2; // Fixed number of columns

    // Props passed to FixedSizeGrid
    const gridProps = {
        columnCount,
        columnWidth: index => columnWidths[index],
        rowCount: channels.length,
        rowHeight: CHANNEL_ROW_HEIGHT,
        height: window.innerHeight - (document.getElementById('main-header')?.offsetHeight || 0) - (document.getElementById('unified-guide-header')?.offsetHeight || 0) - (document.getElementById('bottom-nav-guide')?.offsetHeight || 0), // Fill available height, minus headers/footer
        width: window.innerWidth, // Fill available width
        itemData: {
            channels,
            programs,
            guideStart: new Date(currentDate.setHours(0, 0, 0, 0)),
            hourWidthPixels,
            timelineWidth: guideDurationHours * hourWidthPixels,
            channelColumnWidth,
            playChannel,
            showProgramDetails: showProgramDetailsModal,
            toggleFavorite: useCallback((channelId) => {
                setChannels(prevChannels => {
                    const newChannels = prevChannels.map(ch =>
                        ch.id === channelId ? { ...ch, isFavorite: !ch.isFavorite } : ch
                    );
                    const favorites = newChannels.filter(c => c.isFavorite).map(c => c.id);
                    saveUserSetting('favorites', favorites); // Save to server
                    return newChannels;
                });
                // Re-apply filter if favorites tab is active
                if (selectedGroup === 'favorites') {
                    applySearchAndFilter();
                }
            }, [saveUserSetting, selectedGroup, applySearchAndFilter]),
            sourceColors: sourceColors.current,
            channelSourcesSize: renderedChannelSources.size,
            guideDurationHours,
            searchHighlightProgramId,
            searchHighlightChannelId
        },
        outerRef: useCallback(node => { // Use outerRef to get the actual scrollable div
            if (node) {
                // Attach a listener to React's scrollable div
                // The throttle is important here to not over-fire
                node.addEventListener('scroll', handleGridScroll);
            }
        }, [handleGridScroll]),
        innerRef: gridRef // Ref for the actual grid instance for scrollToItem
    };

    return (
        <div className="react-guide-grid-container relative">
            {channels.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center z-40">
                    <div id="initial-loading-indicator" className="text-center text-gray-400">
                        <div className="loader mx-auto"></div>
                        <p className="mt-4">Loading application...</p>
                    </div>
                    <div id="no-data-message" className="hidden text-center text-gray-500 p-4">
                        <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                        <h3 className="mt-2 text-sm font-medium">No Data Loaded</h3>
                        <p className="mt-1 text-sm">Go to the Settings tab to add and activate your M3U and EPG sources.</p>
                    </div>
                </div>
            )}

            {channels.length > 0 && (
                <>
                    {/* Sticky Corner for date navigation and channel resize handle */}
                    <div className="sticky-corner flex items-center justify-center p-2 sm:p-4" style={{ width: channelColumnWidth, height: TIME_BAR_HEIGHT, top: 0, left: 0, zIndex: 30 }}>
                        <div className="flex items-center gap-2">
                            <button onClick={() => onDateChange(new Date(currentDate.setDate(currentDate.getDate() - 1)))} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-3 rounded-md text-sm transition-colors">&lt;</button>
                            <button onClick={scrollToNow} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded-md text-sm transition-colors">Now</button>
                            <button onClick={() => onDateChange(new Date(currentDate.setDate(currentDate.getDate() + 1)))} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-3 rounded-md text-sm transition-colors">&gt;</button>
                        </div>
                        {/* Channel Column Resize Handle */}
                        <div ref={channelResizeHandleRef} id="channel-column-resize-handle" className="channel-resize-handle"></div>
                    </div>

                    {/* Time Bar Row (sticky horizontally and vertically) */}
                    <div className="react-time-bar-cell" style={{ left: channelColumnWidth, width: guideDurationHours * hourWidthPixels, height: TIME_BAR_HEIGHT, top: 0, zIndex: 25 }}>
                        {Array.from({ length: guideDurationHours }).map((_, i) => {
                            const time = new Date(currentDate);
                            time.setHours(currentDate.getHours() + i);
                            return (
                                <div
                                    key={i}
                                    className="absolute top-0 bottom-0 flex items-center justify-start px-2 text-xs text-gray-400 border-r border-gray-700/50"
                                    style={{ left: `${i * hourWidthPixels}px`, width: `${hourWidthPixels}px` }}
                                >
                                    {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            );
                        })}
                    </div>

                    {/* The main virtualized grid */}
                    <FixedSizeGrid {...gridProps}>
                        {Cell}
                    </FixedSizeGrid>
                </>
            )}

            {/* Search Results Container - RENDERED OUTSIDE REACT-WINDOW GRID */}
            {showSearchResults && (
                <div id="search-results-container" className="absolute top-full right-0 w-full sm:w-96 max-h-80 overflow-y-auto bg-gray-800 border border-gray-600 rounded-md mt-1 z-50 custom-scrollbar shadow-lg">
                    {searchResults.channels.length > 0 && (
                        <>
                            <div className="search-results-header">Channels</div>
                            {searchResults.channels.map(({ item }) => (
                                <div key={`channel-${item.id}`} className="search-result-channel flex items-center p-3 border-b border-gray-700/50 hover:bg-gray-700 cursor-pointer" onClick={() => handleSearchResultChannelClick(item.id)}>
                                    <img src={item.logo} onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/40x40/1f2937/d1d5db?text=?'; }} className="w-10 h-10 object-contain mr-3 rounded-md bg-gray-700 flex-shrink-0" alt={`${item.displayName} logo`} />
                                    <div className="overflow-hidden">
                                        <p className="font-semibold text-white text-sm truncate">{item.chno ? `[${item.chno}] ` : ''}{item.displayName || item.name}</p>
                                        <p className="text-gray-400 text-xs truncate">{item.group} &bull; {item.source}</p>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
                    {searchResults.programs.length > 0 && (
                        <>
                            <div className="search-results-header">Programs</div>
                            {searchResults.programs.map(({ item }) => (
                                <div key={`program-${item.channel.id}-${item.start}`} className="search-result-program flex items-center p-3 border-b border-gray-700/50 hover:bg-gray-700 cursor-pointer" onClick={() => handleSearchResultProgramClick(item.channel.id, item.start)}>
                                    <img src={item.channel.logo} onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/40x40/1f2937/d1d5db?text=?'; }} className="w-10 h-10 object-contain mr-3 rounded-md bg-gray-700 flex-shrink-0" alt={`${item.channel.name} logo`} />
                                    <div className="overflow-hidden">
                                        <p className="font-semibold text-white text-sm truncate" title={item.title}>{item.title}</p>
                                        <p className="text-gray-400 text-xs truncate">{item.channel.name} &bull; {item.channel.source}</p>
                                        <p className="text-blue-400 text-xs">{new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(item.stop).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
                    {(searchResults.channels.length === 0 && searchResults.programs.length === 0) && (
                        <p className="text-center text-gray-500 p-4 text-sm">No results found.</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default ReactGuide;
