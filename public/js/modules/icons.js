/**
 * icons.js
 *
 * A centralized library of SVG icons for the ViniPlay application.
 * This makes it easy to manage, reuse, and style icons across the entire UI.
 * Each icon is a string that can be directly inserted into the DOM.
 */

// A helper function to create a standard SVG wrapper.
// This ensures all icons have consistent attributes.
const createIcon = (path, viewBox = '0 0 20 20') => {
    return `<svg class="w-5 h-5" fill="currentColor" viewBox="${viewBox}">${path}</svg>`;
};

// --- Navigation & General UI ---
export const ICONS = {
    menu: createIcon('<path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />'),
    close: createIcon('<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />'),
    add: createIcon('<path fill-rule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clip-rule="evenodd" />'),
    edit: createIcon('<path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />'),
    trash: createIcon('<path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />'),
    play: createIcon('<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8.118v3.764a1 1 0 001.555.832l3.197-1.882a1 1 0 000-1.664l-3.197-1.882z" clip-rule="evenodd" />'),
    stop: createIcon('<path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2H5z" />'),
    cancel: createIcon('<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />'),
    info: createIcon('<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />', '0 0 20 20'),
    warning: createIcon('<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.21 3.03-1.742 3.03H4.42c-1.532 0-2.492-1.696-1.742-3.03l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1.75-5.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z" clip-rule="evenodd" />'),
    calendar: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />', '0 0 24 24'),
    export: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />', '0 0 24 24'),
    import: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />', '0 0 24 24'),
    star: createIcon('<path fill-rule="evenodd" d="M10.868 2.884c.321-.772 1.415-.772 1.736 0l1.884 4.545a1.5 1.5 0 001.292.934l4.892.38c.787.061 1.1.99.444 1.527l-3.623 2.805a1.5 1.5 0 00-.48 1.644l1.449 4.493c.25.777-.606 1.378-1.292.934l-4.148-2.564a1.5 1.5 0 00-1.543 0l-4.148 2.564c-.686.444-1.542-.157-1.292-.934l1.449-4.493a1.5 1.5 0 00-.48-1.644L2.008 10.26c-.656-.537-.345-1.466.444-1.527l4.892-.38a1.5 1.5 0 001.292-.934l1.884-4.545z" clip-rule="evenodd" />'),
    process: createIcon('<path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />'),

    // --- Player Controls ---
    cast: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z" />', '0 0 24 24'),
    pip: createIcon('<path d="M12.5 5.5h-5a1 1 0 00-1 1v2.5a.5.5 0 001 0v-2a.5.5 0 01.5-.5h4a.5.5 0 01.5.5v4a.5.5 0 01-.5.5h-2a.5.5 0 000 1h2.5a1 1 0 001-1v-5a1 1 0 00-1-1z" /><path d="M3.5 3A1.5 1.5 0 002 4.5v11A1.5 1.5 0 003.5 17h13a1.5 1.5 0 001.5-1.5v-11A1.5 1.5 0 0016.5 3h-13zm0 1h13a.5.5 0 01.5.5v11a.5.5 0 01-.5.5h-13a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5z" />'),
    fullscreen: createIcon('<path d="M3 8.75A.75.75 0 013.75 8h4.5a.75.75 0 010 1.5h-3.25v3.25a.75.75 0 01-1.5 0V8.75zM11.25 3a.75.75 0 01.75.75v3.25h3.25a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75V3.75A.75.75 0 0111.25 3zM8.75 17a.75.75 0 01-.75-.75v-3.25H4.75a.75.75 0 010-1.5h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-.75.75zM17 11.25a.75.75 0 01-.75.75h-3.25v3.25a.75.75 0 01-1.5 0v-4.5a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75z" />'),
    volumeMute: createIcon('<path fill-rule="evenodd" d="M10 1a.75.75 0 00-1.06.04L4.854 5.146A.75.75 0 004.5 5.5v9a.75.75 0 00.22.53l5.43 5.43a.75.75 0 001.28-.53V1.5A.75.75 0 0010 1zM8.5 6.54v6.92L5.25 10.21V5.79L8.5 6.54zM12.5 5a.75.75 0 01.75.75v8.5a.75.75 0 01-1.5 0v-8.5a.75.75 0 01.75-.75zM15.5 5a.75.75 0 01.75.75v8.5a.75.75 0 01-1.5 0v-8.5a.75.75 0 01.75-.75z" clip-rule="evenodd" />'),
    volumeOn: createIcon('<path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75A.75.75 0 009.25 3h-3.5zM14.25 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h3.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-3.5z" />'),
    
    // --- Tab Icons (for mobile or future use) ---
    guide: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />', '0 0 24 24'),
    multiview: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" /><path stroke-linecap="round" stroke-linejoin="round" d="M4 12h16M12 4v16" />', '0 0 24 24'),
    dvr: createIcon('<path d="M7 3.5A1.5 1.5 0 018.5 2h3A1.5 1.5 0 0113 3.5v1.259a.25.25 0 00.25.25h1.5a.25.25 0 00.25-.25V3.5A1.5 1.5 0 0116.5 2h3A1.5 1.5 0 0121 3.5v13A1.5 1.5 0 0119.5 18h-16A1.5 1.5 0 012 16.5v-13A1.5 1.5 0 013.5 2h3A1.5 1.5 0 018 3.5v1.259a.25.25 0 00.25.25h1.5a.25.25 0 00.25-.25V3.5zM8.5 4a.5.5 0 00-.5.5v1a.25.25 0 00.25.25h3.5a.25.25 0 00.25-.25v-1a.5.5 0 00-.5.5h-3z" /><path d="M12.5 13a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />'),
    notifications: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />', '0 0 24 24'),
    settings: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826 3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />', '0 0 24 24'),

    // --- Multi-View Specific ---
    addPlayer: createIcon('<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clip-rule="evenodd" />'),
    removePlayer: createIcon('<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM6.75 9.25a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clip-rule="evenodd" />'),
    channelList: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />', '0 0 24 24'),
    placeholderPlay: createIcon('<path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />', '0 0 24 24'),
    
    // --- DVR Specific ---
    stopRecording: createIcon('<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 002 0V7a1 1 0 10-2 0v2zm1 4a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />'),
    goToGuide: createIcon('<path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" /><path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />'),
};
