/**
 * settings.js
 * * Manages all functionality of the Settings page, including
 * data sources, player settings, and user management.
 */

import { appState, guideState, UIElements } from './state.js';
import { apiFetch, saveGlobalSetting } from './api.js';
import { showNotification, openModal, closeModal, showConfirm, setButtonLoadingState } from './ui.js';
import { handleGuideLoad } from './guide.js';
import { navigate } from './ui.js';

let currentSourceTypeForEditor = 'url';

// --- UI Rendering ---

/**
 * Populates the timezone selector dropdown.
 */
export const populateTimezoneSelector = () => {
    UIElements.timezoneOffsetSelect.innerHTML = '';
    for (let i = 14; i >= -12; i--) {
        UIElements.timezoneOffsetSelect.innerHTML += `<option value="${i}">UTC${i >= 0 ? '+' : ''}${i}:00</option>`;
    }
};

/**
 * Renders the M3U or EPG source table.
 * @param {('m3u'|'epg')} sourceType - The type of source to render.
 */
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

/**
 * Updates all settings UI elements based on the current state.
 */
export const updateUIFromSettings = () => {
    const settings = guideState.settings;

    // Ensure settings have default values if not present
    settings.timezoneOffset = settings.timezoneOffset ?? Math.round(-(new Date().getTimezoneOffset() / 60));
    settings.autoRefresh = settings.autoRefresh || 0;
    settings.searchScope = settings.searchScope || 'channels_programs';

    // Update dropdowns
    UIElements.timezoneOffsetSelect.value = settings.timezoneOffset;
    UIElements.autoRefreshSelect.value = settings.autoRefresh;
    UIElements.searchScopeSelect.value = settings.searchScope;

    // Render tables
    renderSourceTable('m3u');
    renderSourceTable('epg');

    // Helper to populate select elements
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

    // Update button states based on selection
    const selectedProfile = (settings.streamProfiles || []).find(p => p.id === UIElements.streamProfileSelect.value);
    UIElements.editStreamProfileBtn.disabled = !selectedProfile;
    UIElements.deleteStreamProfileBtn.disabled = !selectedProfile || selectedProfile.isDefault;

    const selectedUA = (settings.userAgents || []).find(ua => ua.id === UIElements.userAgentSelect.value);
    UIElements.editUserAgentBtn.disabled = !selectedUA;
    UIElements.deleteUserAgentBtn.disabled = !selectedUA || selectedUA.isDefault;

    // Ensure user list is always populated for admins when this page is viewed.
    if (appState.currentUser?.isAdmin) {
        refreshUserList();
    }
};


// --- User Management (Admin) ---

/**
 * Fetches the user list from the server and renders it.
 */
export const refreshUserList = async () => {
    if (!appState.currentUser?.isAdmin) return;
    try {
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
    } catch (error) {
        console.error("Failed to refresh user list:", error);
        UIElements.userList.innerHTML = `<tr><td colspan="3" class="text-center text-red-400 py-4">Failed to load users.</td></tr>`;
    }
};

/**
 * Opens the user editor modal, optionally pre-filled with user data.
 * @param {object|null} user - The user object to edit, or null to add a new user.
 */
const openUserEditor = (user = null) => {
    UIElements.userEditorId.value = user ? user.id : '';
    UIElements.userEditorUsername.value = user ? user.username : '';
    UIElements.userEditorPassword.value = '';
    UIElements.userEditorIsAdmin.checked = user ? user.isAdmin : false;
    UIElements.userEditorTitle.textContent = user ? 'Edit User' : 'Add New User';
    UIElements.userEditorError.classList.add('hidden');
    openModal(UIElements.userEditorModal);
};

// --- Modals and Editors ---

/**
 * Opens the source editor modal.
 * @param {('m3u'|'epg')} sourceType - The type of source.
 * @param {object|null} source - The source object to edit, or null for a new one.
 */
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

/**
 * Opens the generic editor modal for User Agents or Stream Profiles.
 * @param {('userAgent'|'streamProfile')} type - The type of item to edit.
 * @param {object|null} item - The item to edit, or null for a new one.
 */
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
        const helpText = item.command === 'redirect' ?
            'This built-in profile redirects the player to the stream URL directly. The command cannot be changed.' :
            'This built-in profile uses the server to proxy the stream. The command cannot be changed.';
        UIElements.editorValue.value = helpText;
    }

    UIElements.editorSaveBtn.disabled = isDefault;
    openModal(UIElements.editorModal);
};

// --- Event Listeners ---

/**
 * A wrapper to save a setting and show a notification on success.
 * @param {Function} saveFunction - The async function that saves the setting.
 * @param  {...any} args - Arguments to pass to the save function.
 */
const saveSettingAndNotify = async (saveFunction, ...args) => {
    const updatedSettings = await saveFunction(...args);
    if (updatedSettings) {
        // Merge returned settings into local state
        Object.assign(guideState.settings, updatedSettings);
        showNotification('Setting saved.');
    }
    return !!updatedSettings;
};

/**
 * Sets up all event listeners for the settings page.
 */
export function setupSettingsEventListeners() {

    // --- Source Management ---
    UIElements.processSourcesBtn.addEventListener('click', async () => {
        const originalContent = UIElements.processSourcesBtnContent.innerHTML;
        setButtonLoadingState(UIElements.processSourcesBtn, true, originalContent);
        const res = await apiFetch('/api/process-sources', { method: 'POST' });
        if (res && res.ok) {
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
    
    UIElements.addM3uBtn.addEventListener('click', () => openSourceEditor('m3u'));
    UIElements.addEpgBtn.addEventListener('click', () => openSourceEditor('epg'));
    UIElements.sourceEditorCancelBtn.addEventListener('click', () => closeModal(UIElements.sourceEditorModal));

    // --- Source Editor ---
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
        } else if (!id) {
             showNotification('A file must be selected for new file-based sources.', true);
             return;
        }
        
        if (id) formData.append('id', id);

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

    // --- Source Table Clicks ---
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
            showConfirm('Delete Source?', 'This will delete the source configuration. The downloaded file (if any) will also be removed.', async () => {
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

    // --- General Settings ---
    UIElements.autoRefreshSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { autoRefresh: parseInt(e.target.value, 10) }));
    UIElements.timezoneOffsetSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { timezoneOffset: parseInt(e.target.value, 10) }));
    UIElements.searchScopeSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { searchScope: e.target.value }));

    // --- Player Settings ---
    UIElements.addUserAgentBtn.addEventListener('click', () => openEditorModal('userAgent'));
    UIElements.editUserAgentBtn.addEventListener('click', () => {
        const agent = guideState.settings.userAgents.find(ua => ua.id === UIElements.userAgentSelect.value);
        if (agent) openEditorModal('userAgent', agent);
    });
    UIElements.deleteUserAgentBtn.addEventListener('click', () => {
        const selectedId = UIElements.userAgentSelect.value;
        showConfirm('Delete User Agent?', 'Are you sure?', async () => {
            const updatedList = guideState.settings.userAgents.filter(ua => ua.id !== selectedId);
            const newActiveId = (guideState.settings.activeUserAgentId === selectedId) ? (updatedList[0]?.id || null) : guideState.settings.activeUserAgentId;
            const settings = await saveGlobalSetting({ userAgents: updatedList, activeUserAgentId: newActiveId });
            if (settings) {
                Object.assign(guideState.settings, settings);
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
        showConfirm('Delete Stream Profile?', 'Are you sure?', async () => {
            const updatedList = guideState.settings.streamProfiles.filter(p => p.id !== selectedId);
            const newActiveId = (guideState.settings.activeStreamProfileId === selectedId) ? (updatedList[0]?.id || null) : guideState.settings.activeStreamProfileId;
            const settings = await saveGlobalSetting({ streamProfiles: updatedList, activeStreamProfileId: newActiveId });
            if (settings) {
                Object.assign(guideState.settings, settings);
                updateUIFromSettings();
                showNotification('Stream Profile saved.');
            }
        });
    });
    UIElements.userAgentSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { activeUserAgentId: e.target.value }));
    UIElements.streamProfileSelect.addEventListener('change', (e) => saveSettingAndNotify(saveGlobalSetting, { activeStreamProfileId: e.target.value }));
    
    // --- Editor Modal ---
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

        const settings = await saveGlobalSetting({ [keyToSave]: list });
        if (settings) {
            Object.assign(guideState.settings, settings);
            updateUIFromSettings();
            closeModal(UIElements.editorModal);
            showNotification(type === 'userAgent' ? 'User Agent saved.' : 'Stream Profile saved.');
        }
    });
    
    // --- User Management ---
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

    // --- Danger Zone ---
    UIElements.clearDataBtn.addEventListener('click', () => {
        showConfirm('Clear All Data?', 'This will permanently delete ALL settings and files from the server and your browser cache. The page will reload.', async () => {
            await apiFetch('/api/data', { method: 'DELETE' });
            if (appState.db) {
                await new Promise((resolve, reject) => {
                    const req = appState.db.transaction(['guideData'], 'readwrite').objectStore('guideData').clear();
                    req.onsuccess = resolve;
                    req.onerror = reject;
                });
            }
            showNotification('All data cleared. Reloading...');
            setTimeout(() => window.location.reload(), 1500);
        });
    });
}
