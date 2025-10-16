/**
 * channels.js
 * * Handles rendering and interactivity for the Channels page.
 *   Provides searching, filtering, and quick playback controls.
 */

import { UIElements, guideState } from './state.js';
import { playChannel } from './player.js';

const UNCATEGORIZED_VALUE = '__uncategorized__';

let initialized = false;
let searchTerm = '';
let selectedCategory = 'all';

export const sanitizeText = (value) => `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const sanitizeAttr = (value) => `${value ?? ''}`
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const getDisplayName = (channel) => channel?.displayName || channel?.name || 'Unknown Channel';

const getCategoryValue = (channel) => {
    const group = channel?.group;
    return group && group.trim().length > 0 ? group : UNCATEGORIZED_VALUE;
};

const getCategoryLabel = (value) => value === UNCATEGORIZED_VALUE ? 'Uncategorized' : value;

export const formatProgramWindow = (program) => {
    if (!program?.start || !program?.stop) return '';
    const start = new Date(program.start);
    const stop = new Date(program.stop);
    if (Number.isNaN(start.getTime()) || Number.isNaN(stop.getTime())) return '';

    return `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${stop.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export const getCurrentProgram = (channelId) => {
    const timeline = guideState.programs?.[channelId];
    if (!Array.isArray(timeline) || timeline.length === 0) return null;

    const now = Date.now();
    for (const program of timeline) {
        const start = new Date(program.start).getTime();
        const stop = new Date(program.stop).getTime();
        if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
        if (start <= now && now < stop) {
            return program;
        }
    }
    return null;
};

function populateCategoryFilter() {
    const select = UIElements.channelsCategoryFilter;
    if (!select) return;

    const previousValue = select.value || selectedCategory;
    const categories = new Map();

    guideState.channels.forEach(channel => {
        categories.set(getCategoryValue(channel), getCategoryLabel(getCategoryValue(channel)));
    });

    select.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Categories';
    select.appendChild(allOption);

    Array.from(categories.entries())
        .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
        .forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        });

    if (previousValue && (previousValue === 'all' || categories.has(previousValue))) {
        select.value = previousValue;
        selectedCategory = previousValue;
    } else {
        select.value = 'all';
        selectedCategory = 'all';
    }
}

export function buildChannelCard(channel, options = {}) {
    const displayName = getDisplayName(channel);
    const categoryLabel = getCategoryLabel(getCategoryValue(channel));
    const currentProgram = getCurrentProgram(channel.id);
    const programTitle = currentProgram?.title;
    const programWindow = currentProgram ? formatProgramWindow(currentProgram) : '';
    const logoUrl = channel.logo || 'https://placehold.co/96x96/1f2937/d1d5db?text=?';
    const showProgramInfo = Boolean(programTitle || programWindow);
    const viewerCount = Number.isFinite(options.viewerCount) ? options.viewerCount : null;
    const watcherText = viewerCount === 1 ? '1 watching' : `${viewerCount} watching`;
    const viewerBadgeHTML = viewerCount && viewerCount > 0
        ? `<span class="viewer-count-badge flex-shrink-0 bg-purple-600/80 text-white text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">${sanitizeText(watcherText)}</span>`
        : '';
    const programInfoHTML = `
            <div class="bg-gray-900/60 rounded-lg p-3">
                <p class="text-xs font-semibold text-gray-400 tracking-wide uppercase mb-1">Now Playing</p>
                ${showProgramInfo
                    ? `${programTitle ? `<p class="text-sm font-semibold text-white truncate" title="${sanitizeAttr(programTitle)}">${sanitizeText(programTitle)}</p>` : ''}${programWindow ? `<p class="text-xs text-gray-400">${sanitizeText(programWindow)}</p>` : ''}`
                    : '<p class="text-sm text-gray-500 italic">No info</p>'}
            </div>
    `;
    const hasStreamUrl = Boolean(channel.url);
    const actionControl = hasStreamUrl
        ? `<button class="watch-channel-btn bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md transition-colors" data-channel-id="${sanitizeAttr(channel.id)}">Watch Now</button>`
        : `<div class="bg-gray-800 text-gray-500 text-sm px-4 py-2 rounded-md border border-gray-700 text-center select-none">Unavailable</div>`;
    const footerHTML = viewerBadgeHTML
        ? `<div class="mt-auto flex items-center justify-between gap-3 flex-wrap">${actionControl}${viewerBadgeHTML}</div>`
        : `<div class="mt-auto">${actionControl}</div>`;

    return `
        <div class="channel-card bg-gray-800 border border-gray-700 rounded-xl p-4 shadow-lg flex flex-col gap-4" style="min-height: 240px;">
            <div class="flex items-center gap-3">
                <img src="${sanitizeAttr(logoUrl)}"
                     onerror="this.onerror=null; this.src='https://placehold.co/96x96/1f2937/d1d5db?text=?';"
                     alt="${sanitizeAttr(displayName)} logo"
                     class="w-16 h-16 rounded-lg object-contain bg-gray-900 flex-shrink-0">
                <div class="min-w-0 flex-grow">
                    <p class="text-xs uppercase tracking-wide text-blue-300">${sanitizeText(categoryLabel)}</p>
                    <h3 class="text-lg font-semibold text-white leading-tight truncate" title="${sanitizeAttr(displayName)}">${sanitizeText(displayName)}</h3>
                </div>
            </div>
            ${programInfoHTML}
            ${footerHTML}
        </div>
    `;
}

function attachGridEvents() {
    const grid = UIElements.channelsGrid;
    if (!grid || grid.dataset.watchHandler === 'true') return;

    grid.addEventListener('click', (event) => {
        const button = event.target.closest('.watch-channel-btn');
        if (!button) return;

        const channelId = button.dataset.channelId;
        if (!channelId) return;

        const channel = guideState.channels.find(ch => `${ch.id}` === channelId);
        if (!channel || !channel.url) {
            console.warn('[CHANNELS] Unable to play channel. Missing URL or channel not found.', channelId);
            return;
        }

        playChannel(channel.url, getDisplayName(channel), channel.id);
    });

    grid.dataset.watchHandler = 'true';
}

export function initChannelsPage() {
    if (initialized) return;

    const searchInput = UIElements.channelsSearchInput;
    const categorySelect = UIElements.channelsCategoryFilter;

    if (!searchInput || !categorySelect || !UIElements.channelsGrid) {
        console.warn('[CHANNELS] Channels page elements missing. Initialization deferred.');
        return;
    }

    searchInput.addEventListener('input', (event) => {
        searchTerm = event.target.value.trim().toLowerCase();
        updateChannelsPage();
    });

    categorySelect.addEventListener('change', (event) => {
        selectedCategory = event.target.value;
        updateChannelsPage();
    });

    attachGridEvents();
    initialized = true;
    populateCategoryFilter();
    updateChannelsPage();
}

export function updateChannelsPage() {
    const grid = UIElements.channelsGrid;
    const emptyState = UIElements.channelsEmptyState;
    const emptyMessage = UIElements.channelsEmptyMessage;

    if (!grid) return;

    if (!initialized) {
        initChannelsPage();
    }

    if (UIElements.channelsSearchInput) {
        searchTerm = UIElements.channelsSearchInput.value.trim().toLowerCase();
    }

    populateCategoryFilter();

    if (UIElements.channelsCategoryFilter) {
        selectedCategory = UIElements.channelsCategoryFilter.value;
    }

    const channels = (guideState.channels || []).slice().sort((a, b) => {
        return getDisplayName(a).localeCompare(getDisplayName(b), undefined, { sensitivity: 'base' });
    });

    let filtered = channels;

    if (searchTerm) {
        filtered = filtered.filter(channel => getDisplayName(channel).toLowerCase().includes(searchTerm));
    }

    if (selectedCategory && selectedCategory !== 'all') {
        filtered = filtered.filter(channel => {
            const categoryValue = getCategoryValue(channel);
            return selectedCategory === UNCATEGORIZED_VALUE
                ? categoryValue === UNCATEGORIZED_VALUE
                : categoryValue === selectedCategory;
        });
    }

    if (filtered.length === 0) {
        grid.innerHTML = '';
        if (emptyState && emptyMessage) {
            emptyMessage.textContent = channels.length === 0
                ? 'No channels available yet. Load sources to populate this view.'
                : 'No channels match your search or filter.';
            emptyState.classList.remove('hidden');
        }
        return;
    }

    if (emptyState) {
        emptyState.classList.add('hidden');
    }

    const cardsHtml = filtered.map(buildChannelCard).join('');
    grid.innerHTML = cardsHtml;
}
