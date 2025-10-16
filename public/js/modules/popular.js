/**
 * popular.js
 * * Renders the Popular page, including recommended channels (admin-curated)
 *   and channels that are currently being viewed.
 */

import { guideState, UIElements } from './state.js';
import { buildChannelCard, getDisplayName } from './channels.js';
import { playChannel } from './player.js';

let initialized = false;

function attachGridHandlers(gridEl) {
    if (!gridEl || gridEl.dataset.watchHandler === 'true') return;
    gridEl.addEventListener('click', (event) => {
        const button = event.target.closest('.watch-channel-btn');
        if (!button) return;
        const channelId = button.dataset.channelId;
        if (!channelId) return;

        const channel = guideState.channels.find(ch => `${ch.id}` === channelId);
        if (!channel || !channel.url) {
            console.warn('[POPULAR] Could not resolve channel for watch action:', channelId);
            return;
        }
        playChannel(channel.url, getDisplayName(channel), channel.id);
    });
    gridEl.dataset.watchHandler = 'true';
}

function resolveChannel(channelId, channelName = '', channelLogo = null) {
    const normalizedId = channelId != null ? String(channelId) : null;
    let channel = null;
    if (normalizedId) {
        channel = guideState.channels.find(ch => String(ch.id) === normalizedId);
    }
    if (!channel && channelName) {
        const targetName = channelName.toLowerCase();
        channel = guideState.channels.find(ch => (ch.displayName || ch.name || '').toLowerCase() === targetName);
    }
    if (channel) return channel;
    return {
        id: normalizedId || channelName || `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: channelName || 'Unknown Channel',
        displayName: channelName || 'Unknown Channel',
        logo: channelLogo || 'https://placehold.co/96x96/1f2937/d1d5db?text=?',
        group: 'Uncategorized',
        url: null,
    };
}

function renderRecommended() {
    const section = UIElements.popularRecommendedSection;
    const grid = UIElements.popularRecommendedGrid;
    const emptyState = UIElements.popularRecommendedEmpty;

    if (!section || !grid || !emptyState) return;

    const recommendedIds = guideState.settings.recommendedChannelIds || [];
    const recommendedChannels = recommendedIds
        .map(id => guideState.channels.find(ch => String(ch.id) === String(id)))
        .filter(Boolean);

    if (recommendedChannels.length === 0) {
        section.classList.add('hidden');
        grid.innerHTML = '';
        return;
    }

    section.classList.remove('hidden');
    emptyState.classList.add('hidden');

    const cards = recommendedChannels.map(channel => buildChannelCard(channel));
    grid.innerHTML = cards.join('');
    attachGridHandlers(grid);
}

function renderPopularNow() {
    const grid = UIElements.popularActiveGrid;
    const emptyState = UIElements.popularActiveEmpty;

    if (!grid || !emptyState) return;

    const popularEntries = (guideState.popularNow || []).slice();
    popularEntries.sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0));

    if (popularEntries.length === 0) {
        grid.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');

    const cards = popularEntries.map(entry => {
        const channel = resolveChannel(entry.channelId, entry.channelName, entry.channelLogo);
        return buildChannelCard(channel, { viewerCount: entry.viewerCount });
    });

    grid.innerHTML = cards.join('');
    attachGridHandlers(grid);
}

export function updatePopularPage() {
    if (!initialized) {
        initPopularPage();
    }
    renderRecommended();
    renderPopularNow();
}

export function initPopularPage() {
    if (initialized) return;
    renderRecommended();
    renderPopularNow();
    initialized = true;
}

export function updatePopularNowData(liveStreams = []) {
    const aggregator = new Map();
    liveStreams.forEach(stream => {
        const uniqueFallback = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const channelKey = stream.channelId != null ? `id:${stream.channelId}` : `name:${stream.channelName || stream.streamKey || uniqueFallback}`;
        if (!aggregator.has(channelKey)) {
            aggregator.set(channelKey, {
                channelId: stream.channelId ?? null,
                channelName: stream.channelName || 'Unknown Channel',
                channelLogo: stream.channelLogo || null,
                viewerCount: 0,
            });
        }
        const entry = aggregator.get(channelKey);
        if (!entry.channelLogo && stream.channelLogo) {
            entry.channelLogo = stream.channelLogo;
        }
        const increment = Number.isFinite(stream.viewerCount) && stream.viewerCount > 0 ? stream.viewerCount : 1;
        entry.viewerCount += increment;
    });

    guideState.popularNow = Array.from(aggregator.values());
    if (window.location.pathname.startsWith('/popular')) {
        renderPopularNow();
    }
}
