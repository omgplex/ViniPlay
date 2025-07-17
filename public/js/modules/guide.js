/**
 * guide.js
 * * Manages all functionality related to the TV Guide,
 * including data loading, and preparing data for the React component.
 */

import { appState, guideState, UIElements } from './state.js';
import { saveUserSetting } from './api.js';
import { parseM3U } from './utils.js';
import { playChannel } from './player.js'; // Ensure playChannel is imported
import { showProgramDetails } from './ui.js'; // Ensure showProgramDetails is imported
import { showConfirm, showNotification } from './ui.js'; // Ensure showConfirm and showNotification are imported
import React from 'react';
import ReactDOM from 'react-dom/client'; // Import React DOM client for rendering
import ReactGuide from '../react-guide-bundle.js'; // Import the new React Guide component (now transpiled)
import Fuse from 'fuse.js'; // Import Fuse.js


// Internal variable to hold the React root
let reactRoot = null;

/**
 * Renders or updates the React TV Guide component.
 * This is the bridge between the vanilla JS app and the React guide.
 * @param {Array<object>} channels - The channel data.
 * @param {object} programs - The EPG program data.
 * @param {object} settings - Current application settings (including user settings like favorites).
 * @param {object} callbacks - An object containing callback functions for React to use.
 */
export function renderReactGuide(channels, programs, settings, callbacks) {
    if (!reactRoot) {
        const container = document.getElementById('react-guide-root');
        if (!container) {
            console.error("React root element #react-guide-root not found!");
            return;
        }
        reactRoot = ReactDOM.createRoot(container);
    }

    // Pass all necessary data and callbacks to the React component
    // The ReactGuide component will handle its own internal filtering, search, and date changes
    reactRoot.render(
        <ReactGuide
            channels={channels}
            programs={programs}
            settings={settings}
            playChannel={callbacks.playChannel || playChannel} // Pass through
            showConfirm={callbacks.showConfirm || showConfirm} // Pass through
            saveUserSetting={callbacks.saveUserSetting || saveUserSetting} // Pass through
            showProgramDetailsModal={callbacks.showProgramDetailsModal || showProgramDetails} // Pass through
            onDateChange={callbacks.onDateChange} // This callback updates guideState.currentDate in main.js
            guideDateDisplay={callbacks.guideDateDisplay} // The current date string for React to use
            onSearchAndFilter={callbacks.onSearchAndFilter} // Callback for search/filter updates from React
            channelGroups={callbacks.channelGroups} // Initial groups for filters
            channelSources={callbacks.channelSources} // Initial sources for filters
            onToggleHeaderVisibility={callbacks.onToggleHeaderVisibility} // Callback for header collapse logic
        />
    );
}

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

    // Add favorite status to channels from user settings
    const favoriteIds = new Set(guideState.settings.favorites || []);
    guideState.channels.forEach(channel => {
        channel.isFavorite = favoriteIds.has(channel.id);
    });

    // Populate unique channel groups and sources for the filter dropdowns (vanilla JS elements)
    guideState.channelGroups.clear();
    guideState.channelSources.clear();
    guideState.channels.forEach(ch => {
        if (ch.group) guideState.channelGroups.add(ch.group);
        if (ch.source) guideState.channelSources.add(ch.source);
    });
    populateGroupFilter();
    populateSourceFilter();

    // Cache the loaded data in IndexedDB
    // This is a "fire and forget" operation for performance
    appState.db?.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.channels, 'channels');
    appState.db?.transaction(['guideData'], 'readwrite').objectStore('guideData').put(guideState.programs, 'programs');

    // After loading and preparing data, render the React component
    renderReactGuide(
        guideState.channels,
        guideState.programs,
        guideState.settings,
        {
            playChannel: playChannel,
            showConfirm: showConfirm,
            saveUserSetting: saveUserSetting,
            showProgramDetailsModal: showProgramDetails,
            onDateChange: (newDate) => {
                // This callback is triggered by React component when date changes
                guideState.currentDate = newDate;
                // Update the date display in the vanilla JS header
                UIElements.guideDateDisplay.textContent = newDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });
            },
            guideDateDisplay: guideState.currentDate.toISOString(),
            onSearchAndFilter: handleSearchAndFilterProxy, // Proxy for vanilla JS filter UI
            channelGroups: guideState.channelGroups,
            channelSources: guideState.channelSources,
            onToggleHeaderVisibility: (collapse) => {
                // This callback is triggered by React component for header visibility
                const appContainer = UIElements.appContainer;
                if (!appContainer) return;

                if (collapse && !appContainer.classList.contains('header-collapsed')) {
                    appContainer.classList.add('header-collapsed');
                    UIElements.pageGuide.style.paddingTop = `1px`;
                } else if (!collapse && appContainer.classList.contains('header-collapsed')) {
                    appContainer.classList.remove('header-collapsed');
                    UIElements.pageGuide.style.paddingTop = `1px`;
                }
            }
        }
    );

    // Hide initial loader, show guide root if data exists, otherwise show no data message
    UIElements.initialLoadingIndicator.classList.add('hidden');
    if (guideState.channels.length === 0) {
        UIElements.noDataMessage.classList.remove('hidden');
    } else {
        UIElements.noDataMessage.classList.add('hidden'); // Ensure hidden if data loaded
    }
}


// --- UI Interaction for vanilla JS elements (filters, search input) ---

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
 * This proxy function is called by the React component when its internal search/filter state changes.
 * It updates the vanilla JS UI elements and can trigger any necessary re-rendering of the React component
 * if the data being passed needs to change from the top level (e.g., refreshing channels/programs).
 * @param {string} searchTerm - The current search term.
 * @param {string} selectedGroup - The currently selected group filter.
 * @param {string} selectedSource - The currently selected source filter.
 */
function handleSearchAndFilterProxy(searchTerm, selectedGroup, selectedSource) {
    // Update vanilla JS elements (outside React's control)
    UIElements.searchInput.value = searchTerm;
    UIElements.groupFilter.value = selectedGroup;
    UIElements.sourceFilter.value = selectedSource;

    // Trigger re-render of React component with current guideState data
    // The React component itself will then re-apply its internal filters/search
    renderReactGuide(
        guideState.channels,
        guideState.programs,
        guideState.settings,
        {
            playChannel: playChannel,
            showConfirm: showConfirm,
            saveUserSetting: saveUserSetting,
            showProgramDetailsModal: showProgramDetails,
            onDateChange: (newDate) => { // Recursive callback for date changes
                guideState.currentDate = newDate;
                UIElements.guideDateDisplay.textContent = newDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });
                // Re-render React component with new date
                renderReactGuide(guideState.channels, guideState.programs, guideState.settings, {
                    playChannel, showConfirm, saveUserSetting, showProgramDetailsModal: showProgramDetails, onDateChange,
                    guideDateDisplay: guideState.currentDate.toISOString(), onSearchAndFilter: handleSearchAndFilterProxy,
                    channelGroups: guideState.channelGroups, channelSources: guideState.channelSources, onToggleHeaderVisibility: (collapse) => {
                        const appContainer = UIElements.appContainer;
                        if (appContainer) {
                            if (collapse && !appContainer.classList.contains('header-collapsed')) {
                                appContainer.classList.add('header-collapsed');
                                UIElements.pageGuide.style.paddingTop = `1px`;
                            } else if (!collapse && appContainer.classList.contains('header-collapsed')) {
                                appContainer.classList.remove('header-collapsed');
                                UIElements.pageGuide.style.paddingTop = `1px`;
                            }
                        }
                    }
                });
            },
            guideDateDisplay: guideState.currentDate.toISOString(),
            onSearchAndFilter: handleSearchAndFilterProxy,
            channelGroups: guideState.channelGroups,
            channelSources: guideState.channelSources,
            onToggleHeaderVisibility: (collapse) => {
                const appContainer = UIElements.appContainer;
                if (appContainer) {
                    if (collapse && !appContainer.classList.contains('header-collapsed')) {
                        appContainer.classList.add('header-collapsed');
                        UIElements.pageGuide.style.paddingTop = `1px`;
                    } else if (!collapse && appContainer.classList.contains('header-collapsed')) {
                        appContainer.classList.remove('header-collapsed');
                        UIElements.pageGuide.style.paddingTop = `1px`;
                    }
                }
            }
        }
    );
}

// --- Event Listeners for vanilla JS elements (filters, search input) ---

export function setupGuideEventListeners() {
    UIElements.groupFilter.addEventListener('change', (e) => handleSearchAndFilterProxy(UIElements.searchInput.value, e.target.value, UIElements.sourceFilter.value));
    UIElements.sourceFilter.addEventListener('change', (e) => handleSearchAndFilterProxy(UIElements.searchInput.value, UIElements.groupFilter.value, UIElements.sourceFilter.value));

    // Handle search input with debounce, then proxy to React
    UIElements.searchInput.addEventListener('input', () => {
        clearTimeout(appState.searchDebounceTimer);
        appState.searchDebounceTimer = setTimeout(() => {
            handleSearchAndFilterProxy(UIElements.searchInput.value, UIElements.groupFilter.value, UIElements.sourceFilter.value);
        }, 250);
    });

    // Hide search results when clicking outside (React component will handle its own search results visibility now)
    document.addEventListener('click', e => {
        if (!UIElements.searchInput.contains(e.target) && !UIElements.searchResultsContainer.contains(e.target) && !e.target.closest('.search-result-channel') && !e.target.closest('.search-result-program')) {
            // Note: UIElements.searchResultsContainer might be hidden by React. This is for the vanilla JS fallbacks.
            UIElements.searchResultsContainer.classList.add('hidden');
        }
    });

    // Reset Filter Button
    UIElements.resetFilterBtn.addEventListener('click', () => {
        UIElements.groupFilter.value = 'all';
        UIElements.sourceFilter.value = 'all';
        UIElements.searchInput.value = '';
        handleSearchAndFilterProxy('', 'all', 'all'); // Reset filters and search
    });

    // Now line update is internal to React component.
}
