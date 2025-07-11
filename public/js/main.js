document.addEventListener('DOMContentLoaded', () => {
    // --- Global State & Configuration ---
    const appState = {
        currentUser: null, // { username, isAdmin }
        appInitialized: false,
    };
    const guideState = {
        channels: [],
        programs: {},
        settings: {}, // This will hold both GLOBAL and USER settings, merged.
        guideDurationHours: 48,
        hourWidthPixels: window.innerWidth < 768 ? 200 : 300,
        currentDate: new Date(),
        channelGroups: new Set(),
        channelSources: new Set(), // For the source filter
        visibleChannels: [],
    };
    let player, searchDebounceTimer;
    let confirmCallback = null;
    let db = null; // IndexedDB instance
    let fuseChannels = null; // Fuse.js instance for channels
    let fusePrograms = null; // Fuse.js instance for programs
    let currentSourceTypeForEditor = 'url';
    
    // --- UI Element Cache ---
    const UIElements = Object.fromEntries(
        [...document.querySelectorAll('[id]')].map(el => [
            el.id.replace(/-(\w)/g, (match, letter) => letter.toUpperCase()), 
            el
        ])
    );
    
    // --- API & Data Functions ---
    async function apiFetch(url, options = {}) {
        try {
            const response = await fetch(url, options);
            if (response.status === 401) {
                showLoginScreen("Your session has expired. Please log in again.");
                return null;
            }
            return response;
        } catch (error) {
            console.error('API Fetch error:', error);
            showNotification("Could not connect to the server.", true);
            return null;
        }
    }
    
    async function saveUserSetting(key, value) {
        const res = await apiFetch('/api/user/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value })
        });
        if (!res || !res.ok) {
            console.error(`Failed to save user setting: ${key}`);
            showNotification(`Could not save setting: ${key}`, true);
            return false;
        }
        return true;
    }

    async function saveGlobalSetting(settingObject) {
         const res = await apiFetch('/api/save/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settingObject)
        });
        if (!res) return false;
        
        const data = await res.json();
        if (res.ok && data.settings) {
            // Merge returned settings into local state
            Object.assign(guideState.settings, data.settings);
            return true;
        } else {
            console.error(`Failed to save global setting:`, settingObject);
            showNotification(data.error || 'A global setting could not be saved.', true);
            return false;
        }
    }

    // A wrapper to show notification on successful setting save
    const saveSettingAndNotify = async (saveFunction, ...args) => {
        const success = await saveFunction(...args);
        if (success) {
            showNotification('Setting saved.');
        }
        return success;
    };

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('ViniPlayDB_v3', 1); // Version bump for new channel object structure
            request.onerror = () => reject("Error opening IndexedDB.");
            request.onsuccess = (event) => resolve(event.target.result);
            request.onupgradeneeded = (event) => {
                const dbInstance = event.target.result;
                if (!dbInstance.objectStoreNames.contains('guideData')) {
                    dbInstance.createObjectStore('guideData');
                }
            };
        });
    }

    async function saveDataToDB(key, data) {
        if (!db) return;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['guideData'], 'readwrite');
            const store = transaction.objectStore('guideData');
            const request = store.put(data, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject("Error saving data to DB.");
        });
    }

    async function loadDataFromDB(key) {
        if (!db) return null;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['guideData'], 'readonly');
            const store = transaction.objectStore('guideData');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject("Error loading data from DB.");
        });
    }
    
    async function clearDB() {
        if (!db) return;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['guideData'], 'readwrite');
            const store = transaction.objectStore('guideData');
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject("Error clearing DB.");
        });
    }

    // --- FIXED: M3U Parser (Client-side) ---
    function parseM3U(data) {
        const lines = data.split('\n');
        const channels = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXTINF:')) {
                const nextLine = lines[i + 1]?.trim();
                if (nextLine && (nextLine.startsWith('http') || nextLine.startsWith('rtp'))) {
                    const idMatch = line.match(/tvg-id="([^"]*)"/);
                    const logoMatch = line.match(/tvg-logo="([^"]*)"/);
                    const nameMatch = line.match(/tvg-name="([^"]*)"/);
                    const groupMatch = line.match(/group-title="([^"]*)"/);
                    const chnoMatch = line.match(/tvg-chno="([^"]*)"/); // For the channel number
                    const sourceMatch = line.match(/vini-source="([^"]*)"/); // For the source name
                    const commaIndex = line.lastIndexOf(',');
                    const displayName = (commaIndex !== -1) ? line.substring(commaIndex + 1).trim() : 'Unknown';
                    
                    channels.push({
                        id: idMatch ? idMatch[1] : `unknown-${Math.random()}`,
                        logo: logoMatch ? logoMatch[1] : '',
                        name: nameMatch ? nameMatch[1] : displayName,
                        group: groupMatch ? groupMatch[1] : 'Uncategorized',
                        chno: chnoMatch ? chnoMatch[1] : null,
                        source: sourceMatch ? sourceMatch[1] : 'Default',
                        displayName: displayName,
                        url: nextLine
                    });
                    i++;
                }
            }
        }
        return channels;
    }

    // --- UI & Navigation ---
    const showNotification = (message, isError = false, duration = 3000) => {
        UIElements.notificationMessage.textContent = message;
        UIElements.notificationModal.className = `fixed top-5 right-5 text-white py-2 px-4 rounded-lg shadow-lg z-[100] ${isError ? 'bg-red-500' : 'bg-green-500'}`;
        UIElements.notificationModal.classList.remove('hidden');
        setTimeout(() => { UIElements.notificationModal.classList.add('hidden'); }, duration);
    };
    
    const navigate = (path) => {
        window.history.pushState({}, path, window.location.origin + path);
        handleRouteChange();
    };

    const switchTab = (activeTab) => {
         const newPath = activeTab === 'guide' ? '/tvguide' : '/settings';
         if (window.location.pathname !== newPath) {
            navigate(newPath);
         } else {
            handleRouteChange();
         }
    };

    const handleRouteChange = () => {
        const path = window.location.pathname;
        const isGuide = path.startsWith('/tvguide') || path === '/';

        ['tabGuide', 'bottomNavGuide'].forEach(id => UIElements[id]?.classList.toggle('active', isGuide));
        ['tabSettings', 'bottomNavSettings'].forEach(id => UIElements[id]?.classList.toggle('active', !isGuide));
        
        UIElements.pageGuide.classList.toggle('hidden', !isGuide);
        UIElements.pageGuide.classList.toggle('flex', isGuide);
        UIElements.pageSettings.classList.toggle('hidden', isGuide);
        UIElements.pageSettings.classList.toggle('flex', !isGuide);
        
        UIElements.sidebarToggle.classList.toggle('hidden', !isGuide);
        if (appState.currentUser?.isAdmin && !isGuide) {
            refreshUserList();
        }
         if (!isGuide) {
            updateUIFromSettings();
        }
    };
    
    const openModal = (modal) => { modal.classList.replace('hidden', 'flex'); document.body.classList.add('modal-open'); };
    const closeModal = (modal) => {
        modal.classList.replace('flex', 'hidden');
        if (!document.querySelector('.fixed.inset-0.flex')) document.body.classList.remove('modal-open');
    };
    
    const showConfirm = (title, message, callback) => {
        UIElements.confirmTitle.textContent = title;
        UIElements.confirmMessage.textContent = message;
        confirmCallback = callback;
        openModal(UIElements.confirmModal);
    };

    const toggleSidebar = (show) => {
         UIElements.sidebarOverlay.classList.toggle('hidden', !show);
         UIElements.channelPanelContainer.classList.toggle('-translate-x-full', !show);
    };
    
    const setButtonLoadingState = (buttonEl, isLoading, originalContent) => {
        buttonEl.disabled = isLoading;
        const btnContentEl = buttonEl.querySelector('span');
        if(btnContentEl) {
            btnContentEl.innerHTML = isLoading ?
                `<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>Loading...</span>` :
                originalContent;
        }
    };

    const openEditorModal = (type, item = null) => {
        const isUserAgent = type === 'userAgent';
        const title = item ? `Edit ${isUserAgent ? 'User Agent' : 'Stream Profile'}` : `Create New ${isUserAgent ? 'User Agent' : 'Stream Profile'}`;
        const valueLabel = isUserAgent ? 'User Agent String' : 'Command';
        
        UIElements.editorTitle.textContent = title;
        UIElements.editorType.value = type;
        UIElements.editorId.value = item ? item.id : `custom-${Date.now()}`;
        UIElements.editorName.value = item ? item.name : '';
        UIElements.editorValueLabel.textContent = valueLabel;
        UIElements.editorValue.value = item ? (isUserAgent ? item.value : item.command) : '';
        
        const isDefault = item && item.isDefault;
        UIElements.editorName.disabled = isDefault;
        UIElements.editorValue.disabled = isDefault; 

        if (isDefault && !isUserAgent) { 
            const helpText = item.command === 'redirect'
                ? 'This built-in profile redirects the player to the stream URL directly. The command cannot be changed.'
                : 'This built-in profile uses the server to proxy the stream. The command cannot be changed.';
            UIElements.editorValue.value = helpText;
        }
        
        UIElements.editorSaveBtn.disabled = isDefault;
        openModal(UIElements.editorModal);
    };

    // --- Authentication Flow ---
    const showLoginScreen = (errorMsg = null) => {
        UIElements.authContainer.classList.remove('hidden');
        UIElements.appContainer.classList.add('hidden');
        UIElements.loginForm.classList.remove('hidden');
        UIElements.setupForm.classList.add('hidden');
        UIElements.authLoader.classList.add('hidden');
        if (errorMsg) {
            UIElements.loginError.textContent = errorMsg;
            UIElements.loginError.classList.remove('hidden');
        }
    };

    const showSetupScreen = () => {
        UIElements.authContainer.classList.remove('hidden');
        UIElements.appContainer.classList.add('hidden');
        UIElements.loginForm.classList.add('hidden');
        UIElements.setupForm.classList.remove('hidden');
        UIElements.authLoader.classList.add('hidden');
    };
    
    const showApp = (user) => {
        appState.currentUser = user;
        UIElements.authContainer.classList.add('hidden');
        UIElements.appContainer.classList.remove('hidden');
        UIElements.appContainer.classList.add('flex');
        
        UIElements.userDisplay.textContent = `Welcome, ${user.username}`;
        UIElements.userDisplay.classList.remove('hidden');
        UIElements.userManagementSection.classList.toggle('hidden', !user.isAdmin);

        if (!appState.appInitialized) {
            initMainApp();
            appState.appInitialized = true;
        } else {
             handleRouteChange();
        }
    };

    const checkAuthStatus = async () => {
        try {
            const res = await fetch('/api/auth/status');
            const status = await res.json();
            
            if (status.isLoggedIn) {
                showApp(status.user);
            } else {
                const setupRes = await fetch('/api/auth/needs-setup');
                const setup = await setupRes.json();
                if (setup.needsSetup) {
                    showSetupScreen();
                } else {
                    showLoginScreen();
                }
            }
        } catch (e) {
            console.error("Auth check failed:", e);
            showLoginScreen("Could not verify authentication status.");
        }
    };

    // --- Guide Logic ---
    const handleGuideLoad = (m3uContent, epgContent) => {
        if (!m3uContent || m3uContent.trim() === '#EXTM3U') {
            guideState.channels = [];
            guideState.programs = {};
        } else {
             guideState.channels = parseM3U(m3uContent);
             guideState.programs = epgContent || {};
        }
       
        saveDataToDB('channels', guideState.channels).catch(e => console.error(e));
        saveDataToDB('programs', guideState.programs).catch(e => console.error(e));
        
        finalizeGuideLoad(true);
    };

    const finalizeGuideLoad = (isFirstLoad = false) => {
        // Add favorite status to channels
        (guideState.settings.favorites || []).forEach(favId => {
            const channel = guideState.channels.find(c => c.id === favId);
            if (channel) channel.isFavorite = true;
        });

        // Populate unique channel groups and sources for filters
        guideState.channelGroups.clear();
        guideState.channelSources.clear();
        guideState.channels.forEach(ch => { 
            if(ch.group) guideState.channelGroups.add(ch.group);
            if(ch.source) guideState.channelSources.add(ch.source);
        });
        populateGroupFilter();
        populateSourceFilter();

        // Initialize Fuse.js for fuzzy search
        fuseChannels = new Fuse(guideState.channels, {
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
        
        fusePrograms = new Fuse(allPrograms, {
            keys: ['title'],
            threshold: 0.4,
            includeScore: true,
        });

        handleSearchAndFilter(isFirstLoad);
    };
    
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
        UIElements.sourceFilter.classList.toggle('hidden', guideState.channelSources.size <= 1);
    };

    const renderGuide = (channelsToRender, resetScroll = false) => {
        guideState.visibleChannels = channelsToRender;
        const showNoData = guideState.channels.length === 0;

        UIElements.guidePlaceholder.classList.toggle('hidden', !showNoData);
        UIElements.noDataMessage.classList.toggle('hidden', !showNoData);
        UIElements.initialLoadingIndicator.classList.add('hidden');

        const elementsToToggle = ['channelPanelContainer', 'resizer', 'logoColumn', 'timelineContainer'];
        elementsToToggle.forEach(id => UIElements[id].classList.toggle('hidden', showNoData));
        if (window.innerWidth >= 1024) { // lg breakpoint
            UIElements.channelPanelContainer.classList.toggle('lg:flex', !showNoData);
            UIElements.resizer.classList.toggle('lg:block', !showNoData);
        }

        if(showNoData) return;
        
        const currentScrollTop = UIElements.channelList.scrollTop;
        ['channelList', 'logoList', 'guideTimeline'].forEach(id => UIElements[id].innerHTML = '');
        UIElements.timeBar.innerHTML = '';
        
        UIElements.guideDateDisplay.textContent = guideState.currentDate.toLocaleDateString([], { weekday: 'short', month: 'long', day: 'numeric' });
        
        // Render time bar
        const timeBarContent = document.createElement('div');
        timeBarContent.className = 'relative h-full';
        timeBarContent.style.width = `${guideState.guideDurationHours * guideState.hourWidthPixels}px`;
        const guideStart = new Date(guideState.currentDate);
        guideStart.setHours(0, 0, 0, 0);
        for (let i = 0; i < guideState.guideDurationHours; i++) {
            const time = new Date(guideStart); time.setHours(guideStart.getHours() + i);
            timeBarContent.innerHTML += `<div class="absolute top-0 bottom-0 flex items-center justify-start px-2 text-xs text-gray-400 border-r border-gray-700/50" style="left: ${i * guideState.hourWidthPixels}px; width: ${guideState.hourWidthPixels}px;">${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
        }
        UIElements.timeBar.appendChild(timeBarContent);
        
        // Render channels and programs
        let channelRowsHTML = '';
        const sourceColors = ['bg-blue-600', 'bg-green-600', 'bg-pink-600', 'bg-yellow-500', 'bg-indigo-600', 'bg-red-600'];
        const sourceColorMap = new Map();
        let colorIndex = 0;
        
        channelsToRender.forEach(channel => {
            const channelName = channel.displayName || channel.name;

            if (!sourceColorMap.has(channel.source)) {
                sourceColorMap.set(channel.source, sourceColors[colorIndex % sourceColors.length]);
                colorIndex++;
            }
            const sourceBadgeColor = sourceColorMap.get(channel.source);
            const sourceBadgeHTML = guideState.channelSources.size > 1 ? `<span class="source-badge ${sourceBadgeColor} text-white">${channel.source}</span>` : '';
            const chnoBadgeHTML = channel.chno ? `<span class="chno-badge">${channel.chno}</span>` : '';

            // --- FIXED: Channel List Item HTML ---
            UIElements.channelList.innerHTML += `<div class="h-24 flex items-center justify-between p-2 border-b border-gray-700/50 flex-shrink-0">
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
            </div>`;
            
            UIElements.logoList.innerHTML += `<div class="h-24 flex items-center justify-center p-1 border-b border-gray-700/50 flex-shrink-0 cursor-pointer" data-url="${channel.url}" data-name="${channelName}" data-id="${channel.id}"><img src="${channel.logo}" onerror="this.onerror=null; this.src='https.placehold.co/48x48/1f2937/d1d5db?text=?';" class="w-14 h-14 object-contain pointer-events-none"></div>`;
            
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
            channelRowsHTML += `<div class="h-24 border-b border-gray-700/50 relative">${programsHTML}</div>`;
        });
        UIElements.guideTimeline.innerHTML = `<div id="now-line" class="absolute top-0 bottom-0 bg-red-500 w-0.5 z-20 hidden"></div>` + channelRowsHTML;
        
        const totalGuideHeight = channelsToRender.length * 96; // 96px for h-24
        setTimeout(() => {
            UIElements.channelList.scrollTop = resetScroll ? 0 : currentScrollTop;
            UIElements.guideTimeline.scrollTop = UIElements.channelList.scrollTop;
            UIElements.logoList.scrollTop = UIElements.channelList.scrollTop;
            updateNowLine(guideStart, resetScroll, totalGuideHeight);
        }, 0);
    };

    const updateNowLine = (guideStart, shouldScroll, totalGuideHeight) => {
        const nowLineEl = document.getElementById('now-line');
        if (!nowLineEl) return;

        nowLineEl.style.height = `${totalGuideHeight}px`;
        const now = new Date();
        const guideEnd = new Date(guideStart.getTime() + guideState.guideDurationHours * 3600 * 1000);
        
        if (now >= guideStart && now <= guideEnd) {
            const left = ((now - guideStart) / 3600000) * guideState.hourWidthPixels;
            nowLineEl.style.left = `${left}px`;
            nowLineEl.classList.remove('hidden');
            if (shouldScroll) UIElements.guideTimeline.scrollLeft = left - (UIElements.guideTimeline.clientWidth / 4);
        } else {
            nowLineEl.classList.add('hidden');
        }

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

        setTimeout(() => updateNowLine(guideStart, false, totalGuideHeight), 60000);
    };

    const handleSearchAndFilter = (isFirstLoad = false) => {
        const searchTerm = UIElements.searchInput.value.trim();
        const selectedGroup = UIElements.groupFilter.value;
        const selectedSource = UIElements.sourceFilter.value;
        let channelsForGuide = guideState.channels;
        
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
        
        if (selectedSource !== 'all') {
            channelsForGuide = channelsForGuide.filter(ch => ch.source === selectedSource);
        }
        
        if (searchTerm && fuseChannels && fusePrograms) {
            const lowerCaseSearchTerm = searchTerm.toLowerCase();
            channelsForGuide = channelsForGuide.filter(ch => 
                (ch.displayName || ch.name).toLowerCase().includes(lowerCaseSearchTerm) ||
                (ch.source && ch.source.toLowerCase().includes(lowerCaseSearchTerm)) ||
                (ch.chno && ch.chno.toLowerCase().includes(lowerCaseSearchTerm))
            );
            
            const channelResults = fuseChannels.search(searchTerm).slice(0, 10);
            
            let programResults = [];
            if (guideState.settings.searchScope === 'channels_programs') {
                programResults = fusePrograms.search(searchTerm).slice(0, 20);
            }

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

    // --- Player Logic ---
    const stopAndCleanupPlayer = () => {
        if (player) { player.destroy(); player = null; }
        UIElements.videoElement.src = "";
        UIElements.videoElement.removeAttribute('src');
        UIElements.videoElement.load();
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(console.error);
        closeModal(UIElements.videoModal);
    };

    const playChannel = (url, name, channelId) => {
        if (player) stopAndCleanupPlayer();
        if(channelId) {
            const recentChannels = [channelId, ...(guideState.settings.recentChannels || []).filter(id => id !== channelId)].slice(0, 15);
            guideState.settings.recentChannels = recentChannels;
            saveUserSetting('recentChannels', recentChannels);
        }
        
        const profileId = guideState.settings.activeStreamProfileId;
        const userAgentId = guideState.settings.activeUserAgentId;
        if (!profileId || !userAgentId) {
             showNotification("Active stream profile or user agent not set. Please check settings.", true);
             return;
        }

        const profile = (guideState.settings.streamProfiles || []).find(p => p.id === profileId);
        if (!profile) return showNotification("Stream profile not found.", true);
                
        const streamUrlToPlay = profile.command === 'redirect' ? url : `/stream?url=${encodeURIComponent(url)}&profileId=${profileId}&userAgentId=${userAgentId}`;

        if (mpegts.isSupported()) {
            player = mpegts.createPlayer({ type: 'mse', isLive: true, url: streamUrlToPlay });
            openModal(UIElements.videoModal);
            UIElements.videoTitle.textContent = name;
            player.attachMediaElement(UIElements.videoElement);
            player.load();
            UIElements.videoElement.volume = parseFloat(localStorage.getItem('iptvPlayerVolume') || 0.5);
            player.play().catch((err) => {
                console.error("MPEGTS Player Error:", err);
                showNotification("Could not play stream. Check browser console & server logs.", true);
                stopAndCleanupPlayer();
            });
        } else {
            showNotification('Your browser does not support MSE.', true);
        }
    };

    // --- Settings UI ---
    const populateTimezoneSelector = () => {
        UIElements.timezoneOffsetSelect.innerHTML = '';
        for (let i = 14; i >= -12; i--) {
            UIElements.timezoneOffsetSelect.innerHTML += `<option value="${i}">UTC${i >= 0 ? '+' : ''}${i}:00</option>`;
        }
    };

    const renderSourceTable = (sourceType) => {
        const tbody = UIElements[`${sourceType}SourcesTbody`];
        const sources = guideState.settings[`${sourceType}Sources`] || [];
        tbody.innerHTML = '';

        if (sources.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-gray-500 py-4">No ${sourceType.toUpperCase()} sources added.</td></tr>`;
            return;
        }

        sources.forEach(source => {
            const pathDisplay = source.type === 'file' ? (source.path.split('/').pop() || source.path.split('\\').pop()) : source.path;
            const lastUpdated = new Date(source.lastUpdated).toLocaleString();
            const tr = document.createElement('tr');
            tr.dataset.sourceId = source.id;
            tr.innerHTML = `
                <td>${source.name}</td>
                <td><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${source.type === 'file' ? 'bg-blue-200 text-blue-800' : 'bg-purple-200 text-purple-800'}">${source.type}</span></td>
                <td class="max-w-xs truncate" title="${pathDisplay}">${pathDisplay}</td>
                <td><span class="text-xs font-medium text-gray-400">${source.statusMessage || 'N/A'}</span></td>
                <td>${lastUpdated}</td>
                <td>
                    <label class="switch">
                        <input type="checkbox" class="activate-switch" ${source.isActive ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </td>
                <td class="text-right">
                    <div class="flex items-center justify-end gap-3">
                        <button class="action-btn edit-source-btn" title="Edit Source">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" /></svg>
                        </button>
                         <button class="action-btn delete-source-btn" title="Delete Source">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    };

    const updateUIFromSettings = () => {
        const settings = guideState.settings;
        
        settings.timezoneOffset = settings.timezoneOffset ?? Math.round(-(new Date().getTimezoneOffset() / 60));
        settings.autoRefresh = settings.autoRefresh || 0;
        settings.searchScope = settings.searchScope || 'channels_programs';
        
        UIElements.timezoneOffsetSelect.value = settings.timezoneOffset;
        UIElements.autoRefreshSelect.value = settings.autoRefresh;
        UIElements.searchScopeSelect.value = settings.searchScope;
        
        renderSourceTable('m3u');
        renderSourceTable('epg');

        const populateSelect = (selectId, items, activeId) => {
            const selectEl = UIElements[selectId];
            if (!selectEl) return;
            selectEl.innerHTML = '';
            (items || []).forEach(item => {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = item.name; 
                selectEl.appendChild(option);
            });
            if (activeId) selectEl.value = activeId;
        };

        populateSelect('userAgentSelect', settings.userAgents || [], settings.activeUserAgentId);
        populateSelect('streamProfileSelect', settings.streamProfiles || [], settings.activeStreamProfileId);

        const selectedProfile = (settings.streamProfiles || []).find(p => p.id === UIElements.streamProfileSelect.value);
        UIElements.editStreamProfileBtn.disabled = !selectedProfile;
        UIElements.deleteStreamProfileBtn.disabled = !selectedProfile || selectedProfile.isDefault;
        
        const selectedUA = (settings.userAgents || []).find(ua => ua.id === UIElements.userAgentSelect.value);
        UIElements.editUserAgentBtn.disabled = !selectedUA;
        UIElements.deleteUserAgentBtn.disabled = !selectedUA || selectedUA.isDefault;
    };
    
    // --- User Management UI (Admin) ---
    const openUserEditor = (user = null) => {
        UIElements.userEditorId.value = user ? user.id : '';
        UIElements.userEditorUsername.value = user ? user.username : '';
        UIElements.userEditorPassword.value = '';
        UIElements.userEditorIsAdmin.checked = user ? user.isAdmin : false;
        UIElements.userEditorTitle.textContent = user ? 'Edit User' : 'Add New User';
        UIElements.userEditorError.classList.add('hidden');
        openModal(UIElements.userEditorModal);
    };

    const refreshUserList = async () => {
        if (!appState.currentUser?.isAdmin) return;
        const res = await apiFetch('/api/users');
        if (!res) return;
        const users = await res.json();
        UIElements.userList.innerHTML = users.map(user => `
            <tr data-user-id="${user.id}">
                <td class="px-4 py-3 whitespace-nowrap text-sm text-white">${user.username}</td>
                <td class="px-4 py-3 whitespace-nowrap text-sm">${user.isAdmin ? '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-200 text-green-800">Admin</span>' : '<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-200 text-gray-800">User</span>'}</td>
                <td class="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                    <button class="text-blue-400 hover:text-blue-600 edit-user-btn">Edit</button>
                    <button class="text-red-400 hover:text-red-600 ml-4 delete-user-btn" ${appState.currentUser.username === user.username ? 'disabled' : ''}>Delete</button>
                </td>
            </tr>
        `).join('');
    };

    // --- Resizer Logic ---
    const makeModalResizable = (handleEl, containerEl, minWidth, minHeight, settingKey) => {
        let resizeDebounceTimer;
        handleEl.addEventListener('mousedown', e => {
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startWidth = containerEl.offsetWidth;
            const startHeight = containerEl.offsetHeight;

            const doResize = (e) => {
                const newWidth = startWidth + e.clientX - startX;
                const newHeight = startHeight + e.clientY - startY;
                containerEl.style.width = `${Math.max(minWidth, newWidth)}px`;
                containerEl.style.height = `${Math.max(minHeight, newHeight)}px`;
            };

            const stopResize = () => {
                window.removeEventListener('mousemove', doResize);
                window.removeEventListener('mouseup', stopResize);
                document.body.style.cursor = '';

                clearTimeout(resizeDebounceTimer);
                resizeDebounceTimer = setTimeout(() => {
                    saveUserSetting(settingKey, {
                        width: containerEl.offsetWidth,
                        height: containerEl.offsetHeight,
                    });
                }, 500);
            };

            document.body.style.cursor = 'se-resize';
            window.addEventListener('mousemove', doResize);
            window.addEventListener('mouseup', stopResize);
        }, false);
    };

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Main Navigation & Modals
        ['tabGuide', 'bottomNavGuide'].forEach(id => UIElements[id].addEventListener('click', () => switchTab('guide')));
        ['tabSettings', 'bottomNavSettings'].forEach(id => UIElements[id].addEventListener('click', () => switchTab('settings')));
        window.addEventListener('popstate', handleRouteChange);
        UIElements.confirmCancelBtn.addEventListener('click', () => closeModal(UIElements.confirmModal));
        UIElements.confirmOkBtn.addEventListener('click', () => { if (confirmCallback) confirmCallback(); closeModal(UIElements.confirmModal); });
        UIElements.detailsCloseBtn.addEventListener('click', () => closeModal(UIElements.programDetailsModal));
        UIElements.closeModal.addEventListener('click', stopAndCleanupPlayer);
        
        // Player controls
        UIElements.pipBtn.addEventListener('click', () => {
            if (document.pictureInPictureEnabled && UIElements.videoElement.readyState >= 3) { 
                UIElements.videoElement.requestPictureInPicture().catch(() => showNotification("Could not enter Picture-in-Picture.", true));
            }
        });
        UIElements.videoElement.addEventListener('enterpictureinpicture', () => closeModal(UIElements.videoModal));
        UIElements.videoElement.addEventListener('leavepictureinpicture', () => player && !UIElements.videoElement.paused ? openModal(UIElements.videoModal) : stopAndCleanupPlayer());
        UIElements.videoElement.addEventListener('volumechange', () => localStorage.setItem('iptvPlayerVolume', UIElements.videoElement.volume));

        // Sidebar
        UIElements.sidebarToggle.addEventListener('click', () => toggleSidebar(true));
        UIElements.sidebarOverlay.addEventListener('click', () => toggleSidebar(false));

        // Guide Interaction
        const playFromEvent = (e) => {
             const channelItem = e.target.closest('[data-url]');
             if (channelItem) {
                playChannel(channelItem.dataset.url, channelItem.dataset.name, channelItem.dataset.id);
                if (window.innerWidth < 1024) toggleSidebar(false);
             }
        };

        UIElements.channelList.addEventListener('click', (e) => {
            const favoriteStar = e.target.closest('.favorite-star');
            if (favoriteStar) {
                const channelId = favoriteStar.dataset.channelId;
                const channel = guideState.channels.find(c => c.id === channelId);
                if (!channel) return;
                channel.isFavorite = !channel.isFavorite;
                favoriteStar.classList.toggle('favorited', channel.isFavorite);
                guideState.settings.favorites = guideState.channels.filter(c => c.isFavorite).map(c => c.id);
                saveUserSetting('favorites', guideState.settings.favorites);
                if (UIElements.groupFilter.value === 'favorites') handleSearchAndFilter();
                return;
            }
            playFromEvent(e);
        });

        UIElements.logoList.addEventListener('click', playFromEvent);

        UIElements.guideTimeline.addEventListener('click', (e) => {
            const progItem = e.target.closest('.programme-item');
            if (!progItem) return;
            UIElements.detailsTitle.textContent = progItem.dataset.progTitle;
            const progStart = new Date(progItem.dataset.progStart);
            const progStop = new Date(progItem.dataset.progStop);
            UIElements.detailsTime.textContent = `${progStart.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})} - ${progStop.toLocaleTimeString([],{hour:'2-digit', minute:'2-digit'})}`;
            UIElements.detailsDesc.textContent = progItem.dataset.progDesc || "No description available.";
            UIElements.detailsPlayBtn.onclick = () => {
                playChannel(progItem.dataset.channelUrl, `${progItem.dataset.channelName} - ${progItem.dataset.progTitle}`, progItem.dataset.channelId);
                closeModal(UIElements.programDetailsModal);
            };
            openModal(UIElements.programDetailsModal);
        });

        // Guide Navigation & Search
        UIElements.prevDayBtn.addEventListener('click', () => { guideState.currentDate.setDate(guideState.currentDate.getDate() - 1); finalizeGuideLoad(); });
        UIElements.todayBtn.addEventListener('click', () => { guideState.currentDate = new Date(); renderGuide(guideState.visibleChannels, true); });
        UIElements.nowBtn.addEventListener('click', () => {
            const now = new Date();
            if (guideState.currentDate.toDateString() !== now.toDateString()) {
                guideState.currentDate = now;
                finalizeGuideLoad();
                setTimeout(() => renderGuide(guideState.visibleChannels, true), 50);
            } else {
                const guideStart = new Date(guideState.currentDate); guideStart.setHours(0,0,0,0);
                const scrollPos = ((now - guideStart) / 3600000) * guideState.hourWidthPixels - (UIElements.guideTimeline.clientWidth / 4);
                UIElements.guideTimeline.scrollTo({ left: scrollPos, behavior: 'smooth' });
            }
        });
        UIElements.nextDayBtn.addEventListener('click', () => { guideState.currentDate.setDate(guideState.currentDate.getDate() + 1); finalizeGuideLoad(); });
        UIElements.groupFilter.addEventListener('change', () => handleSearchAndFilter());
        UIElements.sourceFilter.addEventListener('change', () => handleSearchAndFilter());
        UIElements.searchInput.addEventListener('input', () => { clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(() => handleSearchAndFilter(false), 250); });
        document.addEventListener('click', e => { if (!UIElements.searchInput.contains(e.target) && !UIElements.searchResultsContainer.contains(e.target)) UIElements.searchResultsContainer.classList.add('hidden'); });

        UIElements.searchResultsContainer.addEventListener('click', e => {
            const programItem = e.target.closest('.search-result-program');
            const channelItem = e.target.closest('.search-result-channel');
            
            UIElements.searchResultsContainer.classList.add('hidden');
            UIElements.searchInput.value = '';

            if (channelItem) {
                const channelId = channelItem.dataset.channelId;
                const targetChannel = guideState.channels.find(ch => ch.id === channelId);
                if (!targetChannel) return;

                const groupOption = UIElements.groupFilter.querySelector(`option[value="${targetChannel.group.replace(/"/g, '&quot;')}"]`);
                UIElements.groupFilter.value = groupOption ? targetChannel.group : 'all';
                UIElements.sourceFilter.value = 'all'; 
                
                handleSearchAndFilter();

                setTimeout(() => {
                    const channelIndex = guideState.visibleChannels.findIndex(ch => ch.id === channelId);
                    if (channelIndex > -1) {
                        const yPos = channelIndex * 96; // 96px for h-24
                        [UIElements.guideTimeline, UIElements.channelList, UIElements.logoList].forEach(el => {
                            el.scrollTo({ top: yPos, behavior: 'smooth' });
                        });
                    }
                }, 100);

            } else if (programItem) {
                const channelId = programItem.dataset.channelId;
                const progStartISO = programItem.dataset.progStart;
                const progStartDate = new Date(progStartISO);

                guideState.currentDate = progStartDate;
                
                const targetChannel = guideState.channels.find(ch => ch.id === channelId);
                if (targetChannel) {
                    const groupOption = UIElements.groupFilter.querySelector(`option[value="${targetChannel.group.replace(/"/g, '&quot;')}"]`);
                    UIElements.groupFilter.value = groupOption ? targetChannel.group : 'all';
                    UIElements.sourceFilter.value = 'all';
                }

                finalizeGuideLoad();
                
                setTimeout(() => {
                    const guideStartTime = new Date(guideState.currentDate);
                    guideStartTime.setHours(0, 0, 0, 0);

                    const channelIndex = guideState.visibleChannels.findIndex(ch => ch.id === channelId);
                    if (channelIndex === -1) {
                        showNotification("Could not find channel in current view.", true);
                        return;
                    }
                    
                    const hScroll = ((progStartDate - guideStartTime) / 3600000) * guideState.hourWidthPixels;
                    const vScroll = channelIndex * 96;
                    
                    UIElements.guideTimeline.scrollTo({ top: vScroll, left: hScroll - (UIElements.guideTimeline.clientWidth / 4), behavior: 'smooth' });
                    
                    document.querySelectorAll('.programme-item.highlighted-search').forEach(el => el.classList.remove('highlighted-search'));
                    
                    const targetProg = Array.from(document.querySelectorAll('.programme-item')).find(p => p.dataset.channelId === channelId && p.dataset.progStart === progStartISO);
                    if (targetProg) {
                        targetProg.classList.add('highlighted-search');
                        setTimeout(() => targetProg.classList.remove('highlighted-search'), 5000);
                    }
                }, 200);
            }
        });

        // Guide Scrolling Sync
        let ignoreScroll = false;
        const syncScroll = (source, targets) => { if (!ignoreScroll) { ignoreScroll = true; targets.forEach(target => { if (target) target.scrollTop = source.scrollTop; }); ignoreScroll = false; } };
        UIElements.guideTimeline.addEventListener('scroll', (e) => { UIElements.timeBar.scrollLeft = e.target.scrollLeft; syncScroll(e.target, [UIElements.channelList, UIElements.logoList]); });
        UIElements.channelList.addEventListener('scroll', (e) => syncScroll(e.target, [UIElements.guideTimeline, UIElements.logoList]));
        UIElements.logoList.addEventListener('scroll', (e) => syncScroll(e.target, [UIElements.guideTimeline, UIElements.channelList]));

        // Panel Resizer
        UIElements.resizer.addEventListener('mousedown', e => {
            e.preventDefault();
            const startX = e.clientX, startWidth = UIElements.channelPanelContainer.offsetWidth;
            const doResize = (e) => UIElements.channelPanelContainer.style.width = `${Math.max(250, startWidth + e.clientX - startX)}px`;
            const stopResize = () => { window.removeEventListener('mousemove', doResize); window.removeEventListener('mouseup', stopResize); };
            window.addEventListener('mousemove', doResize);
            window.addEventListener('mouseup', stopResize);
        }, false);
        
        // Modal Resizers
        makeModalResizable(UIElements.videoResizeHandle, UIElements.videoModalContainer, 400, 300, 'playerDimensions');
        makeModalResizable(UIElements.detailsResizeHandle, UIElements.programDetailsContainer, 320, 250, 'programDetailsDimensions');

        // Settings Page - Source Management
        UIElements.processSourcesBtn.addEventListener('click', async () => {
             const originalContent = UIElements.processSourcesBtnContent.innerHTML;
             setButtonLoadingState(UIElements.processSourcesBtn, true, originalContent);
             const res = await apiFetch('/api/process-sources', { method: 'POST' });
             if(res && res.ok) {
                 const configResponse = await apiFetch(`/api/config?t=${Date.now()}`);
                 if (configResponse && configResponse.ok) {
                    const config = await configResponse.json();
                    if (!config.m3uContent) {
                         showNotification("No active M3U sources found or sources are empty.", true);
                         handleGuideLoad('', '');
                    } else {
                        handleGuideLoad(config.m3uContent, config.epgContent);
                        guideState.settings = config.settings || {};
                        updateUIFromSettings();
                        navigate('/tvguide');
                        showNotification('Sources processed successfully!');
                    }
                 } else {
                     showNotification("Failed to reload config after processing.", true);
                 }
             } else {
                 const data = res ? await res.json() : { error: 'Unknown error' };
                 showNotification(`Error processing sources: ${data.error}`, true);
             }
             setButtonLoadingState(UIElements.processSourcesBtn, false, originalContent);
        });

        const openSourceEditor = (sourceType, source = null) => {
            UIElements.sourceEditorTitle.textContent = `${source ? 'Edit' : 'Add'} ${sourceType.toUpperCase()} Source`;
            UIElements.sourceEditorForm.reset();
            UIElements.sourceEditorId.value = source ? source.id : '';
            UIElements.sourceEditorType.value = sourceType;
            UIElements.sourceEditorName.value = source ? source.name : '';
            UIElements.sourceEditorIsActive.checked = source ? source.isActive : true;
            
            let isFile = source ? source.type === 'file' : false;
            currentSourceTypeForEditor = isFile ? 'file' : 'url';
            UIElements.sourceEditorTypeBtnUrl.classList.toggle('bg-blue-600', !isFile);
            UIElements.sourceEditorTypeBtnFile.classList.toggle('bg-blue-600', isFile);
            UIElements.sourceEditorUrlContainer.classList.toggle('hidden', isFile);
            UIElements.sourceEditorFileContainer.classList.toggle('hidden', !isFile);
            
            if (source) {
                if (source.type === 'url') UIElements.sourceEditorUrl.value = source.path;
                if (source.type === 'file') {
                    UIElements.sourceEditorFileInfo.textContent = `Current file: ${source.path.split('/').pop()}`;
                    UIElements.sourceEditorFileInfo.classList.remove('hidden');
                }
            } else {
                 UIElements.sourceEditorFileInfo.classList.add('hidden');
            }

            openModal(UIElements.sourceEditorModal);
        };
        
        UIElements.addM3uBtn.addEventListener('click', () => openSourceEditor('m3u'));
        UIElements.addEpgBtn.addEventListener('click', () => openSourceEditor('epg'));
        UIElements.sourceEditorCancelBtn.addEventListener('click', () => closeModal(UIElements.sourceEditorModal));

        UIElements.sourceEditorTypeBtnUrl.addEventListener('click', () => {
             currentSourceTypeForEditor = 'url';
             UIElements.sourceEditorTypeBtnUrl.classList.add('bg-blue-600');
             UIElements.sourceEditorTypeBtnFile.classList.remove('bg-blue-600');
             UIElements.sourceEditorUrlContainer.classList.remove('hidden');
             UIElements.sourceEditorFileContainer.classList.add('hidden');
        });
        UIElements.sourceEditorTypeBtnFile.addEventListener('click', () => {
             currentSourceTypeForEditor = 'file';
             UIElements.sourceEditorTypeBtnUrl.classList.remove('bg-blue-600');
             UIElements.sourceEditorTypeBtnFile.classList.add('bg-blue-600');
             UIElements.sourceEditorUrlContainer.classList.add('hidden');
             UIElements.sourceEditorFileContainer.classList.remove('hidden');
        });

        // --- FIXED: Source Editor Form Submission ---
        UIElements.sourceEditorForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = UIElements.sourceEditorId.value;
            const sourceType = UIElements.sourceEditorType.value;
            
            const formData = new FormData();
            formData.append('sourceType', sourceType);
            formData.append('name', UIElements.sourceEditorName.value);
            formData.append('isActive', UIElements.sourceEditorIsActive.checked);
            
            if (currentSourceTypeForEditor === 'url') {
                formData.append('url', UIElements.sourceEditorUrl.value);
            } else if (UIElements.sourceEditorFile.files[0]) {
                formData.append('sourceFile', UIElements.sourceEditorFile.files[0]);
            } else if (!id) { // File is required for new file-based sources, but not for URL edits
                 showNotification('A file must be selected for new file-based sources.', true);
                 return;
            }
            
            if (id) {
                formData.append('id', id); // Send ID for updates
            }

            const res = await apiFetch('/api/sources', { method: 'POST', body: formData });

            if (res && res.ok) {
                const data = await res.json();
                guideState.settings = data.settings;
                updateUIFromSettings();
                closeModal(UIElements.sourceEditorModal);
                showNotification(`Source ${id ? 'updated' : 'added'} successfully.`);
            } else {
                 const data = res ? await res.json() : { error: 'An unknown error occurred.'};
                 showNotification(`Error: ${data.error}`, true);
            }
        });

        const handleSourceTableClick = async (e, sourceType) => {
            const target = e.target;
            const row = target.closest('tr');
            if (!row) return;
            const sourceId = row.dataset.sourceId;
            const source = guideState.settings[`${sourceType}Sources`].find(s => s.id === sourceId);
            if(!source) return;

            if (target.closest('.edit-source-btn')) {
                openSourceEditor(sourceType, source);
            } else if (target.closest('.delete-source-btn')) {
                showConfirm('Delete Source?', 'Are you sure?', async () => {
                    const res = await apiFetch(`/api/sources/${sourceType}/${sourceId}`, { method: 'DELETE' });
                    if(res?.ok) { 
                        const data = await res.json();
                        guideState.settings = data.settings;
                        updateUIFromSettings();
                        showNotification('Source deleted.'); 
                    } 
                    else if (res) { const data = await res.json(); showNotification(`Error: ${data.error}`, true); }
                });
            } else if (target.classList.contains('activate-switch')) {
                const isActive = target.checked;
                const res = await apiFetch(`/api/sources/${sourceType}/${sourceId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...source, isActive })
                });
                if (res?.ok) {
                    const data = await res.json();
                    guideState.settings = data.settings;
                    updateUIFromSettings();
                    showNotification('Source updated.');
                } else {
                    target.checked = !isActive; // Revert on failure
                }
            }
        };

        UIElements.m3uSourcesTbody.addEventListener('click', (e) => handleSourceTableClick(e, 'm3u'));
        UIElements.epgSourcesTbody.addEventListener('click', (e) => handleSourceTableClick(e, 'epg'));

        // General settings
        UIElements.clearDataBtn.addEventListener('click', () => {
            showConfirm('Clear All Data?', 'This will permanently delete ALL settings and files from the server and your browser cache. The page will reload.', async () => {
                await apiFetch('/api/data', { method: 'DELETE' });
                await clearDB();
                showNotification('All data cleared. Reloading...');
                setTimeout(() => window.location.reload(), 1500);
            });
        });
        
        UIElements.autoRefreshSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { autoRefresh: parseInt(e.target.value, 10) }));
        UIElements.timezoneOffsetSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { timezoneOffset: parseInt(e.target.value, 10) }));
        UIElements.searchScopeSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { searchScope: e.target.value }));
        
        // Player Settings
        UIElements.addUserAgentBtn.addEventListener('click', () => openEditorModal('userAgent'));
        UIElements.editUserAgentBtn.addEventListener('click', () => {
            const agent = guideState.settings.userAgents.find(ua => ua.id === UIElements.userAgentSelect.value);
            if (agent) openEditorModal('userAgent', agent);
        });
        UIElements.deleteUserAgentBtn.addEventListener('click', () => {
            const selectedId = UIElements.userAgentSelect.value;
            if (!selectedId) return;
            showConfirm('Delete User Agent?', 'Are you sure?', async () => {
                const updatedList = guideState.settings.userAgents.filter(ua => ua.id !== selectedId);
                const newActiveId = (guideState.settings.activeUserAgentId === selectedId) ? (updatedList[0]?.id || null) : guideState.settings.activeUserAgentId;
                const success = await saveGlobalSetting({ userAgents: updatedList, activeUserAgentId: newActiveId });
                if (success) {
                    updateUIFromSettings();
                    showNotification('User Agent deleted.');
                }
            });
        });
        UIElements.addStreamProfileBtn.addEventListener('click', () => openEditorModal('streamProfile'));
        UIElements.editStreamProfileBtn.addEventListener('click', () => {
            const profile = guideState.settings.streamProfiles.find(p => p.id === UIElements.streamProfileSelect.value);
            if (profile) openEditorModal('streamProfile', profile);
        });
        UIElements.deleteStreamProfileBtn.addEventListener('click', () => {
            const selectedId = UIElements.streamProfileSelect.value;
            const profile = guideState.settings.streamProfiles.find(p => p.id === selectedId);
            if (!profile || profile.isDefault) return;
            showConfirm('Delete Stream Profile?', 'Are you sure?', async () => {
                const updatedList = guideState.settings.streamProfiles.filter(p => p.id !== selectedId);
                const newActiveId = (guideState.settings.activeStreamProfileId === selectedId) ? (updatedList[0]?.id || null) : guideState.settings.activeStreamProfileId;
                const success = await saveGlobalSetting({ streamProfiles: updatedList, activeStreamProfileId: newActiveId });
                if (success) {
                    updateUIFromSettings();
                    showNotification('Stream Profile saved.');
                }
            });
        });
        UIElements.userAgentSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { activeUserAgentId: e.target.value }));
        UIElements.streamProfileSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { activeStreamProfileId: e.target.value }));

        // Editor Modal
        UIElements.editorCancelBtn.addEventListener('click', () => closeModal(UIElements.editorModal));
        UIElements.editorForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = UIElements.editorId.value, type = UIElements.editorType.value, name = UIElements.editorName.value.trim(), value = UIElements.editorValue.value.trim();
            if (!name || !value) return showNotification('Name and value cannot be empty.', true);
            
            const keyToSave = type === 'userAgent' ? 'userAgents' : 'streamProfiles';
            const list = guideState.settings[keyToSave] || [];
            const existingIndex = list.findIndex(item => item.id === id);

            if (existingIndex > -1) {
                list[existingIndex] = { ...list[existingIndex], name, [type === 'userAgent' ? 'value' : 'command']: value };
            } else {
                list.push(type === 'userAgent' ? { id, name, value } : { id, name, command: value, isDefault: false });
            }

            const success = await saveGlobalSetting({ [keyToSave]: list });
            if (success) {
                updateUIFromSettings();
                closeModal(UIElements.editorModal);
                showNotification(type === 'userAgent' ? 'User Agent saved.' : 'Stream Profile saved.');
            }
        });
        
        // Admin - User Management
        UIElements.addUserBtn.addEventListener('click', () => openUserEditor());
        UIElements.userEditorCancelBtn.addEventListener('click', () => closeModal(UIElements.userEditorModal));
        UIElements.userEditorForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = UIElements.userEditorId.value;
            const body = { username: UIElements.userEditorUsername.value, password: UIElements.userEditorPassword.value, isAdmin: UIElements.userEditorIsAdmin.checked };
            if (!body.password) delete body.password;

            const res = await apiFetch(id ? `/api/users/${id}` : '/api/users', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if (!res) return;
            const data = await res.json();
            if (res.ok) { closeModal(UIElements.userEditorModal); refreshUserList(); }
            else { UIElements.userEditorError.textContent = data.error; UIElements.userEditorError.classList.remove('hidden'); }
        });
        UIElements.userList.addEventListener('click', async (e) => {
            const target = e.target;
            if (target.disabled) return;
            const row = target.closest('tr');
            if (!row) return;
            const userId = row.dataset.userId;

            if (target.classList.contains('edit-user-btn')) {
                const res = await apiFetch('/api/users');
                if (!res) return;
                const users = await res.json();
                const user = users.find(u => u.id == userId);
                if(user) openUserEditor(user);
            }
            
            if (target.classList.contains('delete-user-btn')) {
                showConfirm('Delete User?', 'Are you sure?', async () => {
                     const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
                    if(res?.ok) { refreshUserList(); showNotification('User deleted.'); } 
                    else if (res) { const data = await res.json(); showNotification(`Error: ${data.error}`, true); }
                });
            }
        });
    }
    
    // --- Application Initialization ---
    const initMainApp = async () => {
        try { db = await openDB(); }
        catch(e) { console.error(e); showNotification("Could not initialize local cache.", true); }

        populateTimezoneSelector();
        setupEventListeners();

        try {
            const response = await apiFetch(`/api/config?t=${Date.now()}`);
            if (!response || !response.ok) throw new Error('Could not connect to the server.');
            const config = await response.json();
            guideState.settings = config.settings || {}; 
            
            if (guideState.settings.playerDimensions) {
                const { width, height } = guideState.settings.playerDimensions;
                if (width) UIElements.videoModalContainer.style.width = `${width}px`;
                if (height) UIElements.videoModalContainer.style.height = `${height}px`;
            }
             if (guideState.settings.programDetailsDimensions) {
                const { width, height } = guideState.settings.programDetailsDimensions;
                if (width) UIElements.programDetailsContainer.style.width = `${width}px`;
                if (height) UIElements.programDetailsContainer.style.height = `${height}px`;
            }
            
            updateUIFromSettings(); 

            UIElements.initialLoadingIndicator.classList.remove('hidden');
            UIElements.guidePlaceholder.classList.remove('hidden');

            const cachedChannels = await loadDataFromDB('channels');
            const cachedPrograms = await loadDataFromDB('programs');

            if (cachedChannels?.length > 0 && cachedPrograms) {
                guideState.channels = cachedChannels;
                guideState.programs = cachedPrograms;
                finalizeGuideLoad(true);
            } else if (config.m3uContent) {
                handleGuideLoad(config.m3uContent, config.epgContent);
            } else {
                UIElements.initialLoadingIndicator.classList.add('hidden');
                UIElements.noDataMessage.classList.remove('hidden');
            }
            
            handleRouteChange();

        } catch (e) {
            showNotification("Initialization failed: " + e.message, true);
            UIElements.initialLoadingIndicator.classList.add('hidden');
            UIElements.noDataMessage.classList.remove('hidden');
            navigate('/settings');
        }
    };

    // --- Auth Form Listeners ---
    UIElements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        UIElements.loginError.classList.add('hidden');
        const username = UIElements.loginUsername.value;
        const password = UIElements.loginPassword.value;
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            showApp(data.user);
        } else {
            UIElements.loginError.textContent = data.error;
            UIElements.loginError.classList.remove('hidden');
        }
    });

    UIElements.setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        UIElements.setupError.classList.add('hidden');
        const username = UIElements.setupUsername.value;
        const password = UIElements.setupPassword.value;
        const res = await fetch('/api/auth/setup-admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            showApp(data.user);
        } else {
            UIElements.setupError.textContent = data.error;
            UIElements.setupError.classList.remove('hidden');
        }
    });

    UIElements.logoutBtn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.reload();
    });

    // --- Start the App ---
    checkAuthStatus();
});
