// A Node.js server for the VINI PLAY IPTV Player.
// Implements server-side EPG parsing, secure environment variables, and improved logging.

// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const SQLiteStore = require('connect-sqlite3')(session);
const xmlJS = require('xml-js');
const webpush = require('web-push');
const jwt = require('jsonwebtoken');

const app = express();
const port = 8998;
const saltRounds = 10;
const sourceRefreshTimers = new Map();
let notificationCheckInterval = null;

// --- Configuration ---
const DATA_DIR = '/data';
const VAPID_KEYS_PATH = path.join(DATA_DIR, 'vapid.json');
const JWT_SECRET_PATH = path.join(DATA_DIR, 'jwt_secret.json');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(DATA_DIR, 'viniplay.db');
const MERGED_M3U_PATH = path.join(DATA_DIR, 'playlist.m3u');
const MERGED_EPG_JSON_PATH = path.join(DATA_DIR, 'epg.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// --- Feature Flags/Debug Options ---
const ENABLE_FFMPEG_DEBUG_LOGS = process.env.FFMPEG_DEBUG_LOGS === 'true'; // Set FFMPEG_DEBUG_LOGS=true in .env to enable verbose FFmpeg logs

console.log(`[INIT] Application starting. Data directory: ${DATA_DIR}, Public directory: ${PUBLIC_DIR}`);
if (ENABLE_FFMPEG_DEBUG_LOGS) {
    console.warn('[INIT] FFMPEG_DEBUG_LOGS is ENABLED. This will produce very verbose FFmpeg output!');
}

// --- Automatic VAPID Key Generation ---
let vapidKeys = {};
try {
    if (fs.existsSync(VAPID_KEYS_PATH)) {
        console.log('[Push] Loading existing VAPID keys...');
        vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8'));
    } else {
        console.log('[Push] VAPID keys not found. Generating new keys...');
        vapidKeys = webpush.generateVAPIDKeys();
        fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(vapidKeys, null, 2));
        console.log('[Push] New VAPID keys generated and saved.');
    }
    webpush.setVapidDetails(
        'mailto:example@example.com',
        vapidKeys.publicKey,
        vapidKeys.privateKey
    );
} catch (error) {
    console.error('[Push] FATAL: Could not load or generate VAPID keys.', error);
}

// --- Automatic JWT Secret Generation/Loading ---
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    try {
        if (fs.existsSync(JWT_SECRET_PATH)) {
            console.log('[SECURITY] Loading existing JWT secret from file...');
            JWT_SECRET = fs.readFileSync(JWT_SECRET_PATH, 'utf-8').trim();
            if (!JWT_SECRET) {
                 throw new Error("JWT secret file is empty.");
            }
        } else {
            console.log('[SECURITY] JWT secret not found in environment or file. Generating new secret...');
            JWT_SECRET = require('crypto').randomBytes(64).toString('hex');
            fs.writeFileSync(JWT_SECRET_PATH, JWT_SECRET);
            console.log('[SECURITY] New JWT secret generated and saved to file.');
        }
    } catch (error) {
        console.error('[SECURITY] FATAL: Could not load or generate JWT secret. Please set JWT_SECRET in your .env or ensure /data is writable. Error:', error);
        process.exit(1);
    }
} else {
    console.log('[SECURITY] JWT_SECRET is configured via environment variable.');
}

// Ensure the data and public directories exist.
try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`[INIT] Created data directory: ${DATA_DIR}`);
    }
    if (!fs.existsSync(PUBLIC_DIR)) {
        fs.mkdirSync(PUBLIC_DIR, { recursive: true });
        console.log(`[INIT] Created public directory: ${PUBLIC_DIR}`);
    }
    if (!fs.existsSync(SOURCES_DIR)) {
        fs.mkdirSync(SOURCES_DIR, { recursive: true });
        console.log(`[INIT] Created sources directory: ${SOURCES_DIR}`);
    }
} catch (mkdirError) {
    console.error(`[INIT] FATAL: Failed to create necessary directories: ${mkdirError.message}`);
    process.exit(1);
}

// --- Database Setup ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error("[DB] Error opening database:", err.message);
        process.exit(1);
    } else {
        console.log("[DB] Connected to the SQLite database.");
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                isAdmin INTEGER DEFAULT 0
            )`, (createErr) => {
                if (createErr) console.error("[DB] Error creating 'users' table:", createErr.message);
                else console.log("[DB] 'users' table checked/created.");
            });
            db.run(`CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, key)
            )`, (createErr) => {
                if (createErr) console.error("[DB] Error creating 'user_settings' table:", createErr.message);
                else console.log("[DB] 'user_settings' table checked/created.");
            });
            db.run(`CREATE TABLE IF NOT EXISTS multiview_layouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                layout_data TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`, (createErr) => {
                if (createErr) console.error("[DB] Error creating 'multiview_layouts' table:", createErr.message);
                else console.log("[DB] 'multiview_layouts' table checked/created.");
            });
            db.run(`CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                channelId TEXT NOT NULL,
                channelName TEXT NOT NULL,
                channelLogo TEXT,
                programTitle TEXT NOT NULL,
                programDesc TEXT,
                programStart TEXT NOT NULL,
                programStop TEXT NOT NULL,
                notificationTime TEXT NOT NULL,
                programId TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                triggeredAt TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`, (createErr) => {
                if (createErr) console.error("[DB] Error creating 'notifications' table:", createErr.message);
                else console.log("[DB] 'notifications' table checked/created.");

                db.all("PRAGMA table_info(notifications)", (err, rows) => {
                    if (err) {
                        console.error("[DB_MIGRATION] Error checking notifications table info:", err.message);
                        return;
                    }
                    const columnNames = rows.map(row => row.name);
                    
                    if (!columnNames.includes('status')) {
                        db.run("ALTER TABLE notifications ADD COLUMN status TEXT DEFAULT 'pending'", (alterErr) => {
                            if (alterErr) console.error("[DB_MIGRATION] Error adding 'status' column:", alterErr.message);
                            else console.log("[DB_MIGRATION] Added 'status' column to 'notifications' table.");
                        });
                    } else {
                        console.log("[DB_MIGRATION] 'status' column already exists in 'notifications' table.");
                    }

                    if (!columnNames.includes('triggeredAt')) {
                        db.run("ALTER TABLE notifications ADD COLUMN triggeredAt TEXT", (alterErr) => {
                            if (alterErr) console.error("[DB_MIGRATION] Error adding 'triggeredAt' column:", alterErr.message);
                            else console.log("[DB_MIGRATION] Added 'triggeredAt' column to 'notifications' table.");
                        });
                    } else {
                        console.log("[DB_MIGRATION] 'triggeredAt' column already exists in 'notifications' table.");
                    }
                });
            });
            db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                endpoint TEXT UNIQUE NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`, (createErr) => {
                if (createErr) console.error("[DB] Error creating 'push_subscriptions' table:", createErr.message);
                else console.log("[DB] 'push_subscriptions' table checked/created.");
            });
        });
    }
});

// --- Middleware ---
app.use(express.static(PUBLIC_DIR));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === 'fallback-secret-key-for-dev' || sessionSecret === 'replace_this_with_a_very_long_random_and_secret_string') {
    console.warn('[SECURITY] Using a weak or default SESSION_SECRET. Please set a strong, random value in your .env file!');
} else {
    console.log('[SECURITY] SESSION_SECRET is configured.');
}

app.use(
  session({
    store: new SQLiteStore({
        db: 'viniplay.db',
        dir: DATA_DIR,
        table: 'sessions'
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
    },
  })
);

// --- Authentication Middleware ---
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        console.log(`[AUTH] User ${req.session.username} (ID: ${req.session.userId}) authenticated for ${req.path}`);
        return next();
    } else {
        console.warn(`[AUTH] Authentication required for ${req.path}. Session invalid or missing.`);
        return res.status(401).json({ error: 'Authentication required.' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        console.log(`[AUTH] Admin user ${req.session.username} (ID: ${req.session.userId}) authorized for ${req.path}`);
        return next();
    } else {
        console.warn(`[AUTH] Admin privileges required for ${req.path}. User is not admin or session invalid.`);
        return res.status(403).json({ error: 'Administrator privileges required.' });
    }
};

// --- Helper Functions ---
function getSettings() {
    console.log('[SETTINGS] Attempting to load settings...');
    if (!fs.existsSync(SETTINGS_PATH)) {
        console.log('[SETTINGS] settings.json not found, creating default settings.');
        const defaultSettings = {
            m3uSources: [],
            epgSources: [],
            userAgents: [{ id: `default-ua-${Date.now()}`, name: 'ViniPlay Default', value: 'VLC/3.0.20 (Linux; x86_64)', isDefault: true }],
            streamProfiles: [
                // FFmpeg Stream Copy profile
                { id: 'ffmpeg-copy', name: 'FFmpeg (Stream Copy)', command: '-user_agent "{clientUserAgent}" -i "{streamUrl}" -c copy -f mpegts -bsf:v h264_mp4toannexb -flags +global_header pipe:1', isDefault: true },
                // FFmpeg Transcode profile
                { id: 'ffmpeg-transcode', name: 'FFmpeg (Transcode to H264/AAC)', command: '-user_agent "{clientUserAgent}" -i "{streamUrl}" -c:v libx264 -preset veryfast -crf 23 -flags +global_header -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: false },
                // Direct Redirect profile (no FFmpeg involved)
                { id: 'redirect', name: 'Direct Redirect', command: 'redirect', isDefault: true }
            ],
            activeUserAgentId: `default-ua-${Date.now()}`,
            activeStreamProfileId: 'ffmpeg-copy',
            searchScope: 'channels_only', // MODIFIED: Set default to 'channels_only'
            timezoneOffset: Math.round(-(new Date().getTimezoneOffset() / 60)),
            notificationLeadTime: 10
        };
        try {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2));
            console.log('[SETTINGS] Default settings created and saved.');
        } catch (writeErr) {
            console.error('[SETTINGS] Error saving default settings:', writeErr);
        }
        return defaultSettings;
    }
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        if (!settings.m3uSources) settings.m3uSources = [];
        if (!settings.epgSources) settings.epgSources = [];
        settings.m3uSources.forEach(s => { if (s.refreshHours === undefined) s.refreshHours = 0; });
        settings.epgSources.forEach(s => { if (s.refreshHours === undefined) s.refreshHours = 0; });
        if (settings.notificationLeadTime === undefined) settings.notificationLeadTime = 10;
        if (!settings.streamProfiles) settings.streamProfiles = [];
        if (!settings.searchScope) settings.searchScope = 'channels_only'; // Ensure existing settings also default to channels_only if not set

        // Filter out the "aggressive" profile if it exists and update existing ones.
        const updatedProfiles = settings.streamProfiles
            .filter(p => p.id !== 'ffmpeg-force-transcode') // Remove the problematic aggressive profile
            .map(p => {
                if (p.id === 'ffmpeg-copy') {
                    return { id: 'ffmpeg-copy', name: 'FFmpeg (Stream Copy)', command: '-user_agent "{clientUserAgent}" -i "{streamUrl}" -c copy -f mpegts -bsf:v h264_mp4toannexb -flags +global_header pipe:1', isDefault: p.isDefault };
                }
                if (p.id === 'ffmpeg-transcode') {
                    return { id: 'ffmpeg-transcode', name: 'FFmpeg (Transcode to H264/AAC)', command: '-user_agent "{clientUserAgent}" -i "{streamUrl}" -c:v libx264 -preset veryfast -crf 23 -flags +global_header -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: p.isDefault };
                }
                if (p.id === 'redirect') { // Ensure redirect is properly configured
                    return { id: 'redirect', name: 'Direct Redirect', command: 'redirect', isDefault: p.isDefault };
                }
                return p; // Return other existing profiles as is
            });

        // Add back standard profiles if they were somehow missing (e.g., in an old settings file)
        const currentProfileIds = new Set(updatedProfiles.map(p => p.id));
        if (!currentProfileIds.has('ffmpeg-copy')) {
            updatedProfiles.unshift({ id: 'ffmpeg-copy', name: 'FFmpeg (Stream Copy)', command: '-user_agent "{clientUserAgent}" -i "{streamUrl}" -c copy -f mpegts -bsf:v h264_mp4toannexb -flags +global_header pipe:1', isDefault: true });
        }
        if (!currentProfileIds.has('ffmpeg-transcode')) {
            updatedProfiles.push({ id: 'ffmpeg-transcode', name: 'FFmpeg (Transcode to H264/AAC)', command: '-user_agent "{clientUserAgent}" -i "{streamUrl}" -c:v libx264 -preset veryfast -crf 23 -flags +global_header -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: false });
        }
        if (!currentProfileIds.has('redirect')) {
            updatedProfiles.push({ id: 'redirect', name: 'Direct Redirect', command: 'redirect', isDefault: true });
        }
        
        settings.streamProfiles = updatedProfiles;

        // Ensure activeStreamProfileId is set to a valid profile. If the aggressive one was active, switch to ffmpeg-copy.
        if (!settings.activeStreamProfileId || !new Set(settings.streamProfiles.map(p => p.id)).has(settings.activeStreamProfileId)) {
            settings.activeStreamProfileId = 'ffmpeg-copy'; // Default to 'ffmpeg-copy' if current is invalid
            console.log('[SETTINGS] Resetting activeStreamProfileId to "ffmpeg-copy" due to old or missing ID.');
        }

        console.log('[SETTINGS] Settings loaded successfully.');
        return settings;
    } catch (e) {
        console.error("[SETTINGS] Could not parse settings.json, returning default. Error:", e.message);
        return { m3uSources: [], epgSources: [], notificationLeadTime: 10, searchScope: 'channels_only' }; // Ensure default is returned here too
    }
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        console.log('[SETTINGS] Settings saved successfully.');
        updateAndScheduleSourceRefreshes();
    } catch (e) {
        console.error("[SETTINGS] Error saving settings:", e);
    }
}

function fetchUrlContent(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        console.log(`[FETCH] Attempting to fetch URL content: ${url}`);
        protocol.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log(`[FETCH] Redirecting to: ${res.headers.location}`);
                return fetchUrlContent(new URL(res.headers.location, url).href).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                console.error(`[FETCH] Failed to fetch ${url}: Status Code ${res.statusCode}`);
                return reject(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log(`[FETCH] Successfully fetched content from: ${url}`);
                resolve(data);
            });
        }).on('error', (err) => {
            console.error(`[FETCH] Network error fetching ${url}: ${err.message}`);
            reject(err);
        });
    });
}

// --- EPG Parsing and Caching Logic ---
const parseEpgTime = (timeStr, offsetHours = 0) => {
    const match = timeStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*(([+-])(\d{2})(\d{2}))?/);
    if (!match) {
        console.warn(`[EPG_PARSE] Invalid time format encountered: ${timeStr}`);
        return new Date();
    }
    
    const [ , year, month, day, hours, minutes, seconds, , sign, tzHours, tzMinutes] = match;
    let date;
    if (sign && tzHours && tzMinutes) {
        const epgOffsetMinutes = (parseInt(tzHours) * 60 + parseInt(tzMinutes)) * (sign === '+' ? 1 : -1);
        date = new Date(Date.UTC(year, parseInt(month) - 1, day, hours, minutes, seconds));
        date.setUTCMinutes(date.getUTCMinutes() - epgOffsetMinutes);
    } else {
        date = new Date(Date.UTC(year, parseInt(month) - 1, day, hours, minutes, seconds));
        date.setUTCHours(date.getUTCHours() - offsetHours);
    }
    return date;
};

async function processAndMergeSources() {
    console.log('[PROCESS] Starting to process and merge all active sources.');
    const settings = getSettings();

    let mergedM3uContent = '#EXTM3U\n';
    const activeM3uSources = settings.m3uSources.filter(s => s.isActive);
    if (activeM3uSources.length === 0) {
        console.log('[PROCESS] No active M3U sources found.');
    }

    for (const source of activeM3uSources) {
        console.log(`[M3U] Processing source: "${source.name}" (ID: ${source.id}, Type: ${source.type}, Path: ${source.path})`);
        try {
            let content = '';
            let sourcePathForLog = source.path;

            if (source.type === 'file') {
                const sourceFilePath = path.join(SOURCES_DIR, path.basename(source.path));
                if (fs.existsSync(sourceFilePath)) {
                    content = fs.readFileSync(sourceFilePath, 'utf-8');
                    sourcePathForLog = sourceFilePath;
                } else {
                    console.error(`[M3U] File not found for source "${source.name}": ${sourceFilePath}. Skipping.`);
                    source.status = 'Error';
                    source.statusMessage = 'File not found.';
                    continue;
                }
            } else if (source.type === 'url') {
                content = await fetchUrlContent(source.path);
            }

            const lines = content.split('\n');
            let processedContent = '';
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (line.startsWith('#EXTINF:')) {
                    const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
                    const tvgId = tvgIdMatch ? tvgIdMatch[1] : `no-id-${Math.random()}`; 
                    const uniqueChannelId = `${source.id}_${tvgId}`;

                    const commaIndex = line.lastIndexOf(',');
                    const attributesPart = commaIndex !== -1 ? line.substring(0, commaIndex) : line;
                    const namePart = commaIndex !== -1 ? line.substring(commaIndex) : '';

                    let processedAttributes = attributesPart;
                    if (tvgIdMatch) {
                        processedAttributes = processedAttributes.replace(/tvg-id="[^"]*"/, `tvg-id="${uniqueChannelId}"`);
                    } else {
                        const extinfEnd = processedAttributes.indexOf(' ') + 1;
                        processedAttributes = processedAttributes.slice(0, extinfEnd) + `tvg-id="${uniqueChannelId}" ` + processedAttributes.slice(extinfEnd);
                    }
                    
                    processedAttributes += ` vini-source="${source.name}"`;
                    line = processedAttributes + namePart;
                }
                if (line) {
                   processedContent += line + '\n';
                }
            }
            
            mergedM3uContent += processedContent.replace(/#EXTM3U/i, '') + '\n';
            source.status = 'Success';
            source.statusMessage = 'Processed successfully.';
            console.log(`[M3U] Source "${source.name}" processed successfully from ${sourcePathForLog}.`);

        } catch (error) {
            console.error(`[M3U] Failed to process source "${source.name}" from ${source.path}:`, error.message);
            source.status = 'Error';
            source.statusMessage = `Processing failed: ${error.message.substring(0, 100)}...`;
        }
        source.lastUpdated = new Date().toISOString();
    }
    try {
        fs.writeFileSync(MERGED_M3U_PATH, mergedM3uContent);
        console.log(`[M3U] Merged M3U content saved to ${MERGED_M3U_PATH}.`);
    } catch (writeErr) {
        console.error(`[M3U] Error writing merged M3U file: ${writeErr.message}`);
    }

    const mergedProgramData = {};
    const timezoneOffset = settings.timezoneOffset || 0;
    const activeEpgSources = settings.epgSources.filter(s => s.isActive);
    if (activeEpgSources.length === 0) {
        console.log('[PROCESS] No active EPG sources found.');
    }

    for (const source of activeEpgSources) {
        console.log(`[EPG] Processing source: "${source.name}" (ID: ${source.id}, Type: ${source.type}, Path: ${source.path})`);
        try {
            let xmlString = '';
            let epgFilePath = path.join(SOURCES_DIR, `epg_${source.id}.xml`);

            if (source.type === 'file') {
                if (fs.existsSync(source.path)) {
                    xmlString = fs.readFileSync(source.path, 'utf-8');
                    epgFilePath = source.path;
                } else {
                    console.error(`[EPG] File not found for source "${source.name}": ${source.path}. Skipping.`);
                    source.status = 'Error';
                    source.statusMessage = 'File not found.';
                    continue;
                }
            } else if (source.type === 'url') {
                xmlString = await fetchUrlContent(source.path);
                try {
                    fs.writeFileSync(epgFilePath, xmlString);
                    console.log(`[EPG] Downloaded EPG for "${source.name}" saved to ${epgFilePath}.`);
                } catch (writeErr) {
                    console.error(`[EPG] Error saving EPG file from URL for "${source.name}": ${writeErr.message}`);
                }
            }

            const epgJson = xmlJS.xml2js(xmlString, { compact: true });
            const programs = epgJson.tv && epgJson.tv.programme ? [].concat(epgJson.tv.programme) : [];

            if (programs.length === 0) {
                console.warn(`[EPG] No programs found in EPG source "${source.name}". Check XML structure.`);
            }

            const m3uSourceProviders = settings.m3uSources.filter(m3u => m3u.isActive);

            for (const prog of programs) {
                const originalChannelId = prog._attributes?.channel;
                if (!originalChannelId) {
                    console.warn(`[EPG] Program without channel ID found in "${source.name}". Skipping.`);
                    continue;
                }
                
                for(const m3uSource of m3uSourceProviders) {
                    const uniqueChannelId = `${m3uSource.id}_${originalChannelId}`;

                    if (!mergedProgramData[uniqueChannelId]) {
                        mergedProgramData[uniqueChannelId] = [];
                    }

                    const titleNode = prog.title && prog.title._cdata ? prog.title._cdata : (prog.title?._text || 'No Title');
                    const descNode = prog.desc && prog.desc._cdata ? prog.desc._cdata : (prog.desc?._text || '');
                    
                    mergedProgramData[uniqueChannelId].push({
                        start: parseEpgTime(prog._attributes.start, timezoneOffset).toISOString(),
                        stop: parseEpgTime(prog._attributes.stop, timezoneOffset).toISOString(),
                        title: titleNode.trim(),
                        desc: descNode.trim()
                    });
                }
            }
            source.status = 'Success';
            source.statusMessage = 'Processed successfully.';
            console.log(`[EPG] Source "${source.name}" processed successfully from ${source.path}.`);

        } catch (error) {
            console.error(`[EPG] Failed to process source "${source.name}" from ${source.path}:`, error.message);
            source.status = 'Error';
            source.statusMessage = `Processing failed: ${error.message.substring(0, 100)}...`;
        }
         source.lastUpdated = new Date().toISOString();
    }
    for (const channelId in mergedProgramData) {
        mergedProgramData[channelId].sort((a, b) => new Date(a.start) - new Date(b.start));
    }
    try {
        fs.writeFileSync(MERGED_EPG_JSON_PATH, JSON.stringify(mergedProgramData));
        console.log(`[EPG] Merged EPG JSON content saved to ${MERGED_EPG_JSON_PATH}.`);
    } catch (writeErr) {
        console.error(`[EPG] Error writing merged EPG JSON file: ${writeErr.message}`);
    }
    
    return { success: true, message: 'Sources merged successfully.', updatedSettings: settings };
}

// --- NEW: Per-Source Refresh Scheduler ---
const updateAndScheduleSourceRefreshes = () => {
    console.log('[SCHEDULER] Updating and scheduling all source refreshes...');
    const settings = getSettings();
    const allSources = [...(settings.m3uSources || []), ...(settings.epgSources || [])];
    const activeUrlSources = new Set();

    allSources.forEach(source => {
        if (source.type === 'url' && source.isActive && source.refreshHours > 0) {
            activeUrlSources.add(source.id);
            if (sourceRefreshTimers.has(source.id)) {
                clearTimeout(sourceRefreshTimers.get(source.id));
            }
            console.log(`[SCHEDULER] Scheduling refresh for "${source.name}" (ID: ${source.id}) every ${source.refreshHours} hours.`);
            
            const scheduleNext = () => {
                const timeoutId = setTimeout(async () => {
                    console.log(`[SCHEDULER_RUN] Auto-refresh triggered for "${source.name}".`);
                    try {
                        const result = await processAndMergeSources();
                        if(result.success) {
                            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(result.updatedSettings, null, 2));
                            console.log(`[SCHEDULER_RUN] Successfully refreshed and processed sources for "${source.name}".`);
                        }
                    } catch (error) {
                        console.error(`[SCHEDULER_RUN] Auto-refresh for "${source.name}" failed:`, error.message);
                    }
                    scheduleNext();
                }, source.refreshHours * 3600 * 1000);

                sourceRefreshTimers.set(source.id, timeoutId);
            };
            scheduleNext();
        }
    });

    for (const [sourceId, timeoutId] of sourceRefreshTimers.entries()) {
        if (!activeUrlSources.has(sourceId)) {
            console.log(`[SCHEDULER] Clearing obsolete refresh timer for source ID: ${sourceId}`);
            clearTimeout(timeoutId);
            sourceRefreshTimers.delete(sourceId);
        }
    }
    console.log(`[SCHEDULER] Finished scheduling. Active timers: ${sourceRefreshTimers.size}`);
};

// --- Authentication API Endpoints ---
app.get('/api/auth/needs-setup', (req, res) => {
    console.log('[AUTH_API] Received request for /api/auth/needs-setup');
    db.get("SELECT COUNT(*) as count FROM users WHERE isAdmin = 1", [], (err, row) => {
        if (err) {
            console.error('[AUTH_API] Error checking admin user count:', err.message);
            return res.status(500).json({ error: err.message });
        }
        const needsSetup = row.count === 0;
        console.log(`[AUTH_API] Admin user count: ${row.count}. Needs setup: ${needsSetup}`);
        res.json({ needsSetup });
    });
});

app.post('/api/auth/setup-admin', (req, res) => {
    console.log('[AUTH_API] Received request for /api/auth/setup-admin');
    db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
        if (err) {
            console.error('[AUTH_API] Error checking user count during admin setup:', err.message);
            return res.status(500).json({ error: err.message });
        }
        if (row.count > 0) {
            console.warn('[AUTH_API] Setup attempted but users already exist. Denying setup.');
            return res.status(403).json({ error: "Setup has already been completed." });
        }
        
        const { username, password } = req.body;
        if (!username || !password) {
            console.warn('[AUTH_API] Admin setup failed: Username and/or password missing.');
            return res.status(400).json({ error: "Username and password are required." });
        }

        bcrypt.hash(password, saltRounds, (err, hash) => {
            if (err) {
                console.error('[AUTH_API] Error hashing password during admin setup:', err);
                return res.status(500).json({ error: 'Error hashing password.' });
            }
            db.run("INSERT INTO users (username, password, isAdmin) VALUES (?, ?, 1)", [username, hash], function(err) {
                if (err) {
                    console.error('[AUTH_API] Error inserting admin user:', err.message);
                    return res.status(500).json({ error: err.message });
                }
                req.session.userId = this.lastID;
                req.session.username = username;
                req.session.isAdmin = true;
                console.log(`[AUTH_API] Admin user "${username}" created successfully (ID: ${this.lastID}). Session set.`);
                res.json({ success: true, user: { username: req.session.username, isAdmin: req.session.isAdmin } });
            });
        });
    });
});

app.post('/api/auth/login', (req, res) => {
    console.log('[AUTH_API] Received request for /api/auth/login');
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) {
            console.error('[AUTH_API] Error querying user during login:', err.message);
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            console.warn(`[AUTH_API] Login failed for username "${username}": User not found.`);
            return res.status(401).json({ error: "Invalid username or password." });
        }
        
        bcrypt.compare(password, user.password, (err, result) => {
            if (err) {
                console.error('[AUTH_API] Error comparing password hash:', err);
                return res.status(500).json({ error: 'Authentication error.' });
            }
            if (result) {
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.isAdmin = user.isAdmin === 1;
                console.log(`[AUTH_API] User "${username}" (ID: ${user.id}) logged in successfully. Session set.`);
                res.json({
                    success: true,
                    user: { username: user.username, isAdmin: user.isAdmin === 1 }
                });
            } else {
                console.warn(`[AUTH_API] Login failed for username "${username}": Incorrect password.`);
                res.status(401).json({ error: "Invalid username or password." });
            }
        });
    });
});

app.post('/api/auth/logout', (req, res) => {
    console.log('[AUTH_API] Received request for /api/auth/logout');
    const username = req.session.username || 'unknown';
    req.session.destroy(err => {
        if (err) {
            console.error(`[AUTH_API] Error destroying session for user ${username}:`, err);
            return res.status(500).json({ error: 'Could not log out.' });
        }
        res.clearCookie('connect.sid');
        console.log(`[AUTH_API] User ${username} logged out. Session destroyed.`);
        res.json({ success: true });
    });
});

app.get('/api/auth/status', (req, res) => {
    console.log('[AUTH_API] Received request for /api/auth/status');
    if (req.session && req.session.userId) {
        console.log(`[AUTH_API] User ${req.session.username} (ID: ${req.session.userId}) is logged in.`);
        res.json({ isLoggedIn: true, user: { username: req.session.username, isAdmin: req.session.isAdmin } });
    } else {
        console.log('[AUTH_API] No active session found. User is not logged in.');
        res.json({ isLoggedIn: false });
    }
});

// --- User Management API Endpoints (Admin only) ---
app.get('/api/users', requireAdmin, (req, res) => {
    console.log('[USER_API] Fetching all users.');
    db.all("SELECT id, username, isAdmin FROM users ORDER BY username", [], (err, rows) => {
        if (err) {
            console.error('[USER_API] Error fetching users:', err.message);
            return res.status(500).json({ error: err.message });
        }
        console.log(`[USER_API] Found ${rows.length} users.`);
        res.json(rows);
    });
});

app.post('/api/users', requireAdmin, (req, res) => {
    console.log('[USER_API] Adding new user.');
    const { username, password, isAdmin } = req.body;
    if (!username || !password) {
        console.warn('[USER_API] Add user failed: Username and/or password missing.');
        return res.status(400).json({ error: "Username and password are required." });
    }
    
    bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) {
            console.error('[USER_API] Error hashing password for new user:', err);
            return res.status(500).json({ error: 'Error hashing password' });
        }
        db.run("INSERT INTO users (username, password, isAdmin) VALUES (?, ?, ?)", [username, hash, isAdmin ? 1 : 0], function (err) {
            if (err) {
                console.error('[USER_API] Error inserting new user:', err.message);
                return res.status(400).json({ error: "Username already exists." });
            }
            console.log(`[USER_API] User "${username}" added successfully (ID: ${this.lastID}).`);
            res.json({ success: true, id: this.lastID });
        });
    });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { username, password, isAdmin } = req.body;
    console.log(`[USER_API] Updating user ID: ${id}. Username: ${username}, IsAdmin: ${isAdmin}`);

    const updateUser = () => {
        if (password) {
            bcrypt.hash(password, saltRounds, (err, hash) => {
                if (err) {
                    console.error('[USER_API] Error hashing password during user update:', err);
                    return res.status(500).json({ error: 'Error hashing password' });
                }
                db.run("UPDATE users SET username = ?, password = ?, isAdmin = ? WHERE id = ?", [username, hash, isAdmin ? 1 : 0, id], (err) => {
                    if (err) {
                        console.error(`[USER_API] Error updating user ${id} with new password:`, err.message);
                        return res.status(500).json({ error: err.message });
                    }
                    if (req.session.userId == id) {
                        req.session.username = username;
                        req.session.isAdmin = isAdmin;
                        console.log(`[USER_API] Current user's session (ID: ${id}) updated.`);
                    }
                    console.log(`[USER_API] User ${id} updated successfully (with password change).`);
                    res.json({ success: true });
                });
            });
        } else {
            db.run("UPDATE users SET username = ?, isAdmin = ? WHERE id = ?", [username, isAdmin ? 1 : 0, id], (err) => {
                if (err) {
                    console.error(`[USER_API] Error updating user ${id} without password change:`, err.message);
                    return res.status(500).json({ error: err.message });
                }
                 if (req.session.userId == id) {
                    req.session.username = username;
                    req.session.isAdmin = isAdmin;
                    console.log(`[USER_API] Current user's session (ID: ${id}) updated.`);
                 }
                console.log(`[USER_API] User ${id} updated successfully (without password change).`);
                res.json({ success: true });
            });
        }
    };
    
    if (req.session.userId == id && !isAdmin) {
        console.log(`[USER_API] Attempting to demote current admin user ${id}. Checking if last admin.`);
         db.get("SELECT COUNT(*) as count FROM users WHERE isAdmin = 1", [], (err, row) => {
            if (err) {
                console.error('[USER_API] Error checking admin count for demotion:', err.message);
                return res.status(500).json({ error: err.message });
            }
            if (row.count <= 1) {
                console.warn(`[USER_API] Cannot demote user ${id}: They are the last administrator.`);
                return res.status(403).json({error: "Cannot remove the last administrator."});
            }
            updateUser();
         });
    } else {
        updateUser();
    }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    console.log(`[USER_API] Deleting user ID: ${id}`);
    if (req.session.userId == id) {
        console.warn(`[USER_API] Attempted to delete own account for user ${id}.`);
        return res.status(403).json({ error: "You cannot delete your own account." });
    }
    
    db.run("DELETE FROM users WHERE id = ?", id, function(err) {
        if (err) {
            console.error(`[USER_API] Error deleting user ${id}:`, err.message);
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            console.warn(`[USER_API] User ${id} not found for deletion.`);
            return res.status(404).json({ error: 'User not found.' });
        }
        console.log(`[USER_API] User ${id} deleted successfully.`);
        res.json({ success: true });
    });
});

// --- Protected IPTV API Endpoints ---
app.get('/api/config', requireAuth, (req, res) => {
    console.log('[API] Fetching /api/config for user:', req.session.username);
    try {
        let config = { m3uContent: null, epgContent: null, settings: {} };
        let globalSettings = getSettings();
        config.settings = globalSettings;

        if (fs.existsSync(MERGED_M3U_PATH)) {
            config.m3uContent = fs.readFileSync(MERGED_M3U_PATH, 'utf-8');
            console.log(`[API] Loaded M3U content from ${MERGED_M3U_PATH}.`);
        } else {
            console.log(`[API] No merged M3U file found at ${MERGED_M3U_PATH}.`);
        }
        if (fs.existsSync(MERGED_EPG_JSON_PATH)) {
            try {
                config.epgContent = JSON.parse(fs.readFileSync(MERGED_EPG_JSON_PATH, 'utf-8'));
                console.log(`[API] Loaded EPG content from ${MERGED_EPG_JSON_PATH}.`);
            } catch (parseError) {
                console.error(`[API] Error parsing merged EPG JSON from ${MERGED_EPG_JSON_PATH}: ${parseError.message}`);
                config.epgContent = {};
            }
        } else {
            console.log(`[API] No merged EPG JSON file found at ${MERGED_EPG_JSON_PATH}.`);
        }
        
        db.all(`SELECT key, value FROM user_settings WHERE user_id = ?`, [req.session.userId], (err, rows) => {
            if (err) {
                console.error("[API] Error fetching user settings:", err);
                return res.status(200).json(config);
            }
            if (rows) {
                const userSettings = {};
                rows.forEach(row => {
                    try {
                        userSettings[row.key] = JSON.parse(row.value);
                    } catch (e) {
                        userSettings[row.key] = row.value;
                        console.warn(`[API] User setting key "${row.key}" could not be parsed as JSON. Storing as raw string.`);
                    }
                });
                config.settings = { ...config.settings, ...userSettings };
                console.log(`[API] Merged user settings for user ID: ${req.session.userId}`);
            }
            res.status(200).json(config);
        });

    } catch (error) {
        console.error("[API] Error reading config or related files:", error);
        res.status(500).json({ error: "Could not load configuration from server." });
    }
});

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            if (!fs.existsSync(SOURCES_DIR)) {
                fs.mkdirSync(SOURCES_DIR, { recursive: true });
            }
            cb(null, SOURCES_DIR);
        },
        filename: (req, file, cb) => {
            cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
        }
    })
});

app.post('/api/sources', requireAuth, upload.single('sourceFile'), async (req, res) => {
    const { sourceType, name, url, isActive, id, refreshHours } = req.body;
    console.log(`[SOURCES_API] ${id ? 'Updating' : 'Adding'} source. Type: ${sourceType}, Name: ${name}`);

    if (!sourceType || !name) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.warn('[SOURCES_API] Source type or name missing for source operation.');
        return res.status(400).json({ error: 'Source type and name are required.' });
    }

    const settings = getSettings();
    const sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;

    if (id) {
        const sourceIndex = sourceList.findIndex(s => s.id === id);
        if (sourceIndex === -1) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.warn(`[SOURCES_API] Source ID ${id} not found for update.`);
            return res.status(404).json({ error: 'Source to update not found.' });
        }

        const sourceToUpdate = sourceList[sourceIndex];
        console.log(`[SOURCES_API] Found existing source for update: ${sourceToUpdate.name}`);
        sourceToUpdate.name = name;
        sourceToUpdate.isActive = isActive === 'true';
        sourceToUpdate.refreshHours = parseInt(refreshHours, 10) || 0;
        sourceToUpdate.lastUpdated = new Date().toISOString();

        if (req.file) {
            console.log(`[SOURCES_API] New file uploaded for source ${id}. Deleting old file if exists.`);
            if (sourceToUpdate.type === 'file' && fs.existsSync(sourceToUpdate.path)) {
                try {
                    fs.unlinkSync(sourceToUpdate.path);
                    console.log(`[SOURCES_API] Deleted old file: ${sourceToUpdate.path}`);
                } catch (e) { console.error("[SOURCES_API] Could not delete old source file:", e); }
            }

            const extension = sourceType === 'm3u' ? '.m3u' : '.xml';
            const newPath = path.join(SOURCES_DIR, `${sourceType}_${id}${extension}`);
            try {
                fs.renameSync(req.file.path, newPath);
                sourceToUpdate.path = newPath;
                sourceToUpdate.type = 'file';
                console.log(`[SOURCES_API] Renamed uploaded file to: ${newPath}`);
            } catch (e) {
                console.error('[SOURCES_API] Error renaming updated source file:', e);
                return res.status(500).json({ error: 'Could not save updated file.' });
            }
        } else if (url !== undefined) {
            console.log(`[SOURCES_API] URL provided for source ${id}.`);
            if (sourceToUpdate.type === 'file' && fs.existsSync(sourceToUpdate.path)) {
                try {
                    fs.unlinkSync(sourceToUpdate.path);
                    console.log(`[SOURCES_API] Deleted old file (switching to URL): ${sourceToUpdate.path}`);
                } catch (e) { console.error("[SOURCES_API] Could not delete old source file (on type change):", e); }
            }
            sourceToUpdate.path = url;
            sourceToUpdate.type = 'url';
        } else if (sourceToUpdate.type === 'file' && !req.file && (!sourceToUpdate.path || !fs.existsSync(sourceToUpdate.path))) {
            console.warn(`[SOURCES_API] Existing file source ${id} has no file and no new file/URL provided.`);
            return res.status(400).json({ error: 'Existing file source requires a new file if original is missing.' });
        }

        saveSettings(settings);
        console.log(`[SOURCES_API] Source ${id} updated successfully.`);
        res.json({ success: true, message: 'Source updated successfully.', settings: getSettings() });
    } else {
        const newSource = {
            id: `src-${Date.now()}`,
            name,
            type: req.file ? 'file' : 'url',
            path: req.file ? req.file.path : url,
            isActive: isActive === 'true',
            refreshHours: parseInt(refreshHours, 10) || 0,
            lastUpdated: new Date().toISOString(),
            status: 'Pending',
            statusMessage: 'Source added. Process to load data.'
        };

        if (newSource.type === 'url' && !newSource.path) {
            console.warn('[SOURCES_API] New URL source failed: URL is required.');
            return res.status(400).json({ error: 'URL is required for URL-type source.' });
        }
        if (newSource.type === 'file' && !req.file) {
            console.warn('[SOURCES_API] New file source failed: A file must be selected.');
            return res.status(400).json({ error: 'A file must be selected for new file-based sources.' });
        }

        if (req.file) {
            const extension = sourceType === 'm3u' ? '.m3u' : '.xml';
            const newPath = path.join(SOURCES_DIR, `${sourceType}_${newSource.id}${extension}`);
            try {
                fs.renameSync(req.file.path, newPath);
                newSource.path = newPath;
                console.log(`[SOURCES_API] Renamed uploaded file for new source to: ${newPath}`);
            } catch (e) {
                console.error('[SOURCES_API] Error renaming new source file:', e);
                return res.status(500).json({ error: 'Could not save uploaded file.' });
            }
        }

        sourceList.push(newSource);
        saveSettings(settings);
        console.log(`[SOURCES_API] New source "${name}" added successfully (ID: ${newSource.id}).`);
        res.json({ success: true, message: 'Source added successfully.', settings: getSettings() });
    }
});

app.put('/api/sources/:sourceType/:id', requireAuth, (req, res) => {
    const { sourceType, id } = req.params;
    const { name, path: newPath, isActive } = req.body;
    console.log(`[SOURCES_API] Partial update source ID: ${id}, Type: ${sourceType}, isActive: ${isActive}`);
    
    const settings = getSettings();
    const sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;
    const sourceIndex = sourceList.findIndex(s => s.id === id);

    if (sourceIndex === -1) {
        console.warn(`[SOURCES_API] Source ID ${id} not found for partial update.`);
        return res.status(404).json({ error: 'Source not found.' });
    }

    const source = sourceList[sourceIndex];
    source.name = name ?? source.name;
    source.isActive = isActive ?? source.isActive;
    if (source.type === 'url' && newPath !== undefined) {
        source.path = newPath;
    }
    source.lastUpdated = new Date().toISOString();

    saveSettings(settings);
    console.log(`[SOURCES_API] Source ${id} partially updated.`);
    res.json({ success: true, message: 'Source updated.', settings: getSettings() });
});

app.delete('/api/sources/:sourceType/:id', requireAuth, (req, res) => {
    const { sourceType, id } = req.params;
    console.log(`[SOURCES_API] Deleting source ID: ${id}, Type: ${sourceType}`);
    
    const settings = getSettings();
    let sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;
    const source = sourceList.find(s => s.id === id);
    
    if (source && source.type === 'file' && fs.existsSync(source.path)) {
        try {
            fs.unlinkSync(source.path);
            console.log(`[SOURCES_API] Deleted associated file: ${source.path}`);
        } catch (e) {
            console.error(`[SOURCES_API] Could not delete source file: ${source.path}`, e);
        }
    }
    
    const initialLength = sourceList.length;
    const newList = sourceList.filter(s => s.id !== id);
    if (sourceType === 'm3u') settings.m3uSources = newList;
    else settings.epgSources = newList;

    if (newList.length === initialLength) {
        console.warn(`[SOURCES_API] Source ID ${id} not found for deletion.`);
        return res.status(404).json({ error: 'Source not found.' });
    }

    saveSettings(settings);
    console.log(`[SOURCES_API] Source ${id} deleted successfully.`);
    res.json({ success: true, message: 'Source deleted.', settings: getSettings() });
});

app.post('/api/process-sources', requireAuth, async (req, res) => {
    console.log('[API] Received request to /api/process-sources (manual trigger).');
    try {
        const result = await processAndMergeSources();
        if (result.success) {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(result.updatedSettings, null, 2));
            console.log('[API] Source processing completed and settings saved (manual trigger).');
            res.json({ success: true, message: 'Sources merged successfully.'});
        } else {
            res.status(500).json({ error: result.message || 'Failed to process sources.' });
        }
    }
    catch (error) {
        console.error("[API] Error during manual source processing:", error);
        res.status(500).json({ error: 'Failed to process sources. Check server logs.' });
    }
});

app.post('/api/save/settings', requireAuth, async (req, res) => {
    console.log('[API] Received request to /api/save/settings.');
    try {
        let currentSettings = getSettings();
        
        const oldTimezone = currentSettings.timezoneOffset;

        const updatedSettings = { ...currentSettings };
        for (const key in req.body) {
            if (!['favorites', 'playerDimensions', 'programDetailsDimensions', 'recentChannels', 'multiviewLayouts'].includes(key)) {
                updatedSettings[key] = req.body[key];
            } else {
                console.warn(`[SETTINGS_SAVE] Attempted to save user-specific key "${key}" to global settings. This is ignored.`);
            }
        }

        saveSettings(updatedSettings);
        
        if (updatedSettings.timezoneOffset !== oldTimezone) {
            console.log("[API] Timezone setting changed, re-processing sources.");
            const result = await processAndMergeSources();
             if (result.success) {
                fs.writeFileSync(SETTINGS_PATH, JSON.stringify(result.updatedSettings, null, 2));
             }
        }

        res.json({ success: true, message: 'Settings saved.', settings: getSettings() });
    } catch (error) {
        console.error("[API] Error saving global settings:", error);
        res.status(500).json({ error: "Could not save settings. Check server logs." });
    }
});

app.post('/api/user/settings', requireAuth, (req, res) => {
    console.log(`[API] Received request to /api/user/settings for user ${req.session.userId}.`);
    const { key, value } = req.body;
    if (!key) {
        console.warn('[API] User setting save failed: Key is missing.');
        return res.status(400).json({ error: 'A setting key is required.' });
    }
    
    const valueJson = JSON.stringify(value);
    const userId = req.session.userId;

    db.run(
        `UPDATE user_settings SET value = ? WHERE user_id = ? AND key = ?`,
        [valueJson, userId, key],
        function (err) {
            if (err) {
                console.error(`[API] Error updating user setting for user ${userId}, key ${key}:`, err);
                return res.status(500).json({ error: 'Could not save user setting.' });
            }
            
            if (this.changes === 0) {
                console.log(`[API] User setting for user ${userId}, key ${key} not found for update. Attempting insert.`);
                db.run(
                    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`,
                    [userId, key, valueJson],
                    (insertErr) => {
                        if (insertErr) {
                            console.error(`[API] Error inserting user setting for user ${userId}, key ${key}:`, insertErr);
                            return res.status(500).json({ error: 'Could not save user setting.' });
                        }
                        console.log(`[API] User setting for user ${userId}, key ${key} inserted successfully.`);
                        res.json({ success: true });
                    }
                );
            } else {
                console.log(`[API] User setting for user ${userId}, key ${key} updated successfully.`);
                res.json({ success: true });
            }
        }
    );
});

// --- Notification Endpoints ---
app.get('/api/notifications/vapid-public-key', requireAuth, (req, res) => {
    console.log('[PUSH_API] Request for VAPID public key.');
    if (!vapidKeys.publicKey) {
        console.error('[PUSH_API] VAPID public key not available on the server.');
        return res.status(500).json({ error: 'VAPID public key not available on the server.' });
    }
    res.send(vapidKeys.publicKey);
});

app.post('/api/notifications/subscribe', requireAuth, (req, res) => {
    console.log(`[PUSH_API] Subscribe request for user ${req.session.userId}.`);
    const subscription = req.body;
    const userId = req.session.userId;

    if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
        console.warn('[PUSH_API] Invalid subscription object received.');
        return res.status(400).json({ error: 'Invalid subscription object.' });
    }

    const { endpoint, keys: { p256dh, auth } } = subscription;

    db.run(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`,
        [userId, endpoint, p256dh, auth],
        function(err) {
            if (err) {
                console.error(`[PUSH_API] Error saving push subscription for user ${userId}:`, err);
                return res.status(500).json({ error: 'Could not save subscription.' });
            }
            console.log(`[PUSH] User ${userId} subscribed with endpoint: ${endpoint}. (ID: ${this.lastID || 'existing'})`);
            res.status(201).json({ success: true });
        }
    );
});

app.post('/api/notifications/unsubscribe', requireAuth, (req, res) => {
    console.log(`[PUSH_API] Unsubscribe request for user ${req.session.userId}.`);
    const { endpoint } = req.body;
    if (!endpoint) {
        console.warn('[PUSH_API] Unsubscribe failed: Endpoint is required.');
        return res.status(400).json({ error: 'Endpoint is required to unsubscribe.' });
    }

    db.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", [endpoint, req.session.userId], function(err) {
        if (err) {
            console.error(`[PUSH_API] Error deleting push subscription for user ${req.session.userId}, endpoint ${endpoint}:`, err);
            return res.status(500).json({ error: 'Could not unsubscribe.' });
        }
        if (this.changes === 0) {
            console.warn(`[PUSH_API] No subscription found for user ${req.session.userId} with endpoint ${endpoint} for deletion.`);
            return res.status(404).json({ error: 'Subscription not found or unauthorized.' });
        }
        console.log(`[PUSH] User ${req.session.userId} unsubscribed from endpoint: ${endpoint}`);
        res.json({ success: true });
    });
});

app.post('/api/notifications', requireAuth, (req, res) => {
    console.log(`[PUSH_API] Add notification request for user ${req.session.userId}.`);
    const { channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, scheduledTime, programId } = req.body;

    if (!channelId || !programTitle || !programStart || !scheduledTime || !programId) {
        console.warn('[PUSH_API] Missing required fields for adding notification.');
        return res.status(400).json({ error: 'Missing required notification fields.' });
    }

    db.run(`INSERT INTO notifications (user_id, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, notificationTime, programId, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [req.session.userId, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, scheduledTime, programId],
        function (err) {
            if (err) {
                console.error('[PUSH_API] Error adding notification to database:', err);
                return res.status(500).json({ error: 'Could not add notification.' });
            }
            console.log(`[PUSH_API] Notification added for program "${programTitle}" (ID: ${this.lastID}) for user ${req.session.userId}.`);
            res.status(201).json({ success: true, id: this.lastID });
        }
    );
});

app.get('/api/notifications', requireAuth, (req, res) => {
    console.log(`[PUSH_API] Fetching notifications for user ${req.session.userId}.`);
    db.all(`SELECT id, user_id, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, notificationTime as scheduledTime, programId, status, triggeredAt
            FROM notifications
            WHERE user_id = ?
            ORDER BY notificationTime DESC`,
        [req.session.userId],
        (err, rows) => {
            if (err) {
                console.error('[PUSH_API] Error fetching notifications from database:', err);
                return res.status(500).json({ error: 'Could not retrieve notifications.' });
            }
            console.log(`[PUSH_API] Found ${rows.length} notifications for user ${req.session.userId}.`);
            res.json(rows);
        }
    );
});

app.delete('/api/notifications/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    console.log(`[PUSH_API] Deleting notification ID: ${id} for user ${req.session.userId}.`);
    db.run(`DELETE FROM notifications WHERE id = ? AND user_id = ?`,
        [id, req.session.userId],
        function (err) {
            if (err) {
                console.error(`[PUSH_API] Error deleting notification ${id} from database:`, err);
                return res.status(500).json({ error: 'Could not delete notification.' });
            }
            if (this.changes === 0) {
                console.warn(`[PUSH_API] Notification ${id} not found or unauthorized for user ${req.session.userId}.`);
                return res.status(404).json({ error: 'Notification not found or unauthorized.' });
            }
            console.log(`[PUSH_API] Notification ${id} deleted successfully for user ${req.session.userId}.`);
            res.json({ success: true });
    });
});

app.delete('/api/data', requireAuth, (req, res) => {
    console.log(`[API] Received request to /api/data (clear all data) for user ${req.session.userId}.`);
    try {
        [MERGED_M3U_PATH, MERGED_EPG_JSON_PATH, SETTINGS_PATH, JWT_SECRET_PATH].forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
                console.log(`[API] Deleted file: ${file}`);
            }
        });
        if(fs.existsSync(SOURCES_DIR)) {
            fs.rmSync(SOURCES_DIR, { recursive: true, force: true });
            console.log(`[API] Removed sources directory: ${SOURCES_DIR}`);
            fs.mkdirSync(SOURCES_DIR, { recursive: true });
            console.log(`[API] Recreated empty sources directory: ${SOURCES_DIR}`);
        }
        
        db.run(`DELETE FROM user_settings WHERE user_id = ?`, [req.session.userId], (err) => {
            if (err) console.error(`[API] Error clearing user settings for user ${req.session.userId}:`, err.message);
            else console.log(`[API] Cleared user settings for user ${req.session.userId}.`);
        });
        db.run(`DELETE FROM notifications WHERE user_id = ?`, [req.session.userId], (err) => {
            if (err) console.error(`[API] Error clearing notifications for user ${req.session.userId}:`, err.message);
            else console.log(`[API] Cleared notifications for user ${req.session.userId}.`);
        });
        db.run(`DELETE FROM push_subscriptions WHERE user_id = ?`, [req.session.userId], (err) => {
            if (err) console.error(`[API] Error clearing push subscriptions for user ${req.session.userId}:`, err.message);
            else console.log(`[API] Cleared push subscriptions for user ${req.session.userId}.`);
        });

        console.log(`[API] All data cleared for user ${req.session.userId}.`);
        res.json({ success: true, message: 'All data has been cleared.' });
    } catch (error) {
        console.error("[API] Error clearing data:", error);
        res.status(500).json({ error: "Failed to clear data." });
    }
});

// NEW: Endpoint to generate a temporary stream token
app.get('/api/stream-token', requireAuth, (req, res) => {
    if (!JWT_SECRET) {
        console.error('[AUTH_API] JWT_SECRET is not configured. Cannot generate stream token.');
        return res.status(500).json({ error: 'Server not configured for stream tokens.' });
    }
    try {
        const token = jwt.sign({ userId: req.session.userId }, JWT_SECRET, { expiresIn: '5m' });
        console.log(`[AUTH_API] Stream token generated for user ${req.session.userId}.`);
        res.json({ token });
    } catch (error) {
        console.error('[AUTH_API] Error generating stream token:', error);
        res.status(500).json({ error: 'Failed to generate stream token.' });
    }
});

// MODIFIED: Stream endpoint now validates token instead of session cookie
app.get('/stream', (req, res) => {
    const { url: streamUrl, profileId, userAgentId, token } = req.query;
    
    let authenticatedUserId = null;

    if (token) {
        if (!JWT_SECRET) {
            console.error('[AUTH] JWT_SECRET is not configured. Cannot validate stream token.');
            return res.status(500).send('Authentication error: Server misconfiguration.');
        }
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            authenticatedUserId = decoded.userId;
            console.log(`[AUTH] Stream token valid for user ID: ${authenticatedUserId}.`);
        } catch (error) {
            console.warn(`[AUTH] Invalid or expired stream token for /stream request: ${error.message}`);
            return res.status(401).send('Unauthorized: Invalid or expired stream token.');
        }
    } else {
        if (req.session && req.session.userId) {
            authenticatedUserId = req.session.userId;
            console.log(`[AUTH] Stream accessed by authenticated session for user ID: ${authenticatedUserId}.`);
        } else {
            console.warn('[AUTH] Unauthorized access attempt to /stream: No token or valid session.');
            return res.status(401).send('Unauthorized: Stream token or active session required.');
        }
    }

    console.log(`[STREAM_DEBUG] Stream request received for user ${authenticatedUserId}.`);
    console.log(`[STREAM_DEBUG]   Query Parameters: url=${streamUrl}, profileId=${profileId}, userAgentId=${userAgentId}`);

    if (!streamUrl) {
        console.warn('[STREAM_DEBUG] Missing stream URL in request. Sending 400.');
        return res.status(400).send('Error: `url` query parameter is required.');
    }

    let settings = getSettings();
    
    const profile = (settings.streamProfiles || []).find(p => p.id === profileId);
    if (!profile) {
        console.error(`[STREAM_DEBUG] Stream profile with ID "${profileId}" not found in settings. Sending 404.`);
        return res.status(404).send(`Error: Stream profile with ID "${profileId}" not found.`);
    }
    console.log(`[STREAM_DEBUG] Found stream profile: ${JSON.stringify(profile)}`);

    if (profile.command === 'redirect') {
        console.log(`[STREAM_DEBUG] Stream profile command is 'redirect'. Redirecting to stream URL: ${streamUrl}`);
        return res.redirect(302, streamUrl);
    }
    
    const userAgent = (settings.userAgents || []).find(ua => ua.id === userAgentId);
    if (!userAgent) {
        console.error(`[STREAM_DEBUG] User agent with ID "${userAgentId}" not found in settings. Sending 404.`);
        return res.status(404).send(`Error: User agent with ID "${userAgentId}" not found.`);
    }
    console.log(`[STREAM_DEBUG] Found user agent: ${JSON.stringify(userAgent)}`);
    
    console.log(`[STREAM_DEBUG] Initiating FFmpeg proxy for stream: ${streamUrl}`);
    console.log(`[STREAM_DEBUG]   Using Profile Name: "${profile.name}"`);
    console.log(`[STREAM_DEBUG]   Using User Agent String: "${userAgent.value}"`);

    // Replace {clientUserAgent} with the user agent value, ensuring it's properly quoted
    const commandTemplate = profile.command
        .replace(/{streamUrl}/g, streamUrl)
        .replace(/{clientUserAgent}/g, userAgent.value);

    console.log(`[STREAM_DEBUG] Constructed FFmpeg command template: "${commandTemplate}"`);
        
    const args = (commandTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(arg => arg.replace(/^"|"$/g, ''));
    
    // Add debug logging flag if enabled
    if (ENABLE_FFMPEG_DEBUG_LOGS) {
        args.unshift('-loglevel', 'debug');
        console.log('[STREAM_DEBUG] Added -loglevel debug to FFmpeg arguments.');
    }

    console.log(`[STREAM_DEBUG] Final FFmpeg arguments array: [${args.map(a => `"${a}"`).join(', ')}]`);

    const ffmpeg = spawn('ffmpeg', args);
    console.log(`[STREAM_DEBUG] FFmpeg process spawned with PID: ${ffmpeg.pid}`);
    res.setHeader('Content-Type', 'video/mp2t'); // Standard for MPEG Transport Stream
    console.log(`[STREAM_DEBUG] Response header 'Content-Type: video/mp2t' set.`);
    
    ffmpeg.stdout.pipe(res);
    console.log('[STREAM_DEBUG] FFmpeg stdout piped to response.');
    
    ffmpeg.stderr.on('data', (data) => {
        console.error(`[FFMPEG_ERROR] PID: ${ffmpeg.pid} Stream: ${streamUrl} - ${data.toString().trim()}`);
    });

    ffmpeg.on('close', (code) => {
        if (code !== 0) {
            console.log(`[STREAM_DEBUG] FFmpeg process for ${streamUrl} (PID: ${ffmpeg.pid}) exited with code ${code}.`);
        } else {
            console.log(`[STREAM_DEBUG] FFmpeg process for ${streamUrl} (PID: ${ffmpeg.pid}) exited gracefully (code ${code}).`);
        }
        if (!res.headersSent) {
             console.error(`[STREAM_DEBUG] FFmpeg closed before headers sent. Sending 500 error.`);
             res.status(500).send('FFmpeg stream ended unexpectedly or failed to start.');
        } else {
            console.log(`[STREAM_DEBUG] Response already sent. Ending response stream.`);
            res.end();
        }
    });

    ffmpeg.on('error', (err) => {
        console.error(`[STREAM_DEBUG] Failed to start ffmpeg process for ${streamUrl} (PID: ${ffmpeg.pid || 'N/A'}): ${err.message}`);
        if (!res.headersSent) {
            res.status(500).send('Failed to start streaming service. Check server logs.');
        }
    });

    req.on('close', () => {
        console.log(`[STREAM_DEBUG] Client closed connection for ${streamUrl}. Attempting to kill ffmpeg process (PID: ${ffmpeg.pid}).`);
        if (!ffmpeg.killed) {
            ffmpeg.kill('SIGKILL');
            console.log(`[STREAM_DEBUG] FFmpeg process (PID: ${ffmpeg.pid}) kill signal sent.`);
        } else {
            console.log(`[STREAM_DEBUG] FFmpeg process (PID: ${ffmpeg.pid}) already dead.`);
        }
    });
});

// --- ADDED: Multi-View Layout API Endpoints ---
app.get('/api/multiview/layouts', requireAuth, (req, res) => {
    console.log(`[LAYOUT_API] Fetching layouts for user ${req.session.userId}.`);
    db.all("SELECT id, name, layout_data FROM multiview_layouts WHERE user_id = ?", [req.session.userId], (err, rows) => {
        if (err) {
            console.error('[LAYOUT_API] Error fetching layouts:', err.message);
            return res.status(500).json({ error: 'Could not retrieve layouts.' });
        }
        const layouts = rows.map(row => ({
            ...row,
            layout_data: JSON.parse(row.layout_data)
        }));
        console.log(`[LAYOUT_API] Found ${layouts.length} layouts for user ${req.session.userId}.`);
        res.json(layouts);
    });
});

app.post('/api/multiview/layouts', requireAuth, (req, res) => {
    const { name, layout_data } = req.body;
    console.log(`[LAYOUT_API] Saving layout "${name}" for user ${req.session.userId}.`);
    if (!name || !layout_data) {
        console.warn('[LAYOUT_API] Save failed: Name or layout_data is missing.');
        return res.status(400).json({ error: 'Layout name and data are required.' });
    }

    const layoutJson = JSON.stringify(layout_data);

    db.run("INSERT INTO multiview_layouts (user_id, name, layout_data) VALUES (?, ?, ?)",
        [req.session.userId, name, layoutJson],
        function (err) {
            if (err) {
                console.error('[LAYOUT_API] Error saving layout:', err.message);
                return res.status(500).json({ error: 'Could not save layout.' });
            }
            console.log(`[LAYOUT_API] Layout "${name}" saved with ID ${this.lastID} for user ${req.session.userId}.`);
            res.status(201).json({ success: true, id: this.lastID, name, layout_data });
        }
    );
});

app.delete('/api/multiview/layouts/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    console.log(`[LAYOUT_API] Deleting layout ID: ${id} for user ${req.session.userId}.`);
    db.run("DELETE FROM multiview_layouts WHERE id = ? AND user_id = ?", [id, req.session.userId], function(err) {
        if (err) {
            console.error(`[LAYOUT_API] Error deleting layout ${id}:`, err.message);
            return res.status(500).json({ error: 'Could not delete layout.' });
        }
        if (this.changes === 0) {
            console.warn(`[LAYOUT_API] Layout ${id} not found or user ${req.session.userId} not authorized.`);
            return res.status(404).json({ error: 'Layout not found or you do not have permission to delete it.' });
        }
        console.log(`[LAYOUT_API] Layout ${id} deleted successfully.`);
        res.json({ success: true });
    });
});

async function checkAndSendNotifications() {
    console.log('[PUSH_CHECKER] Running scheduled notification check.');
    try {
        const now = new Date();
        const nowIso = now.toISOString();
        const dueNotifications = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM notifications WHERE status = 'pending' AND notificationTime <= ?", [nowIso], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (dueNotifications.length > 0) {
            console.log(`[PUSH_CHECKER] Found ${dueNotifications.length} due notifications to process.`);
        } else {
            console.log('[PUSH_CHECKER] No due notifications found.');
        }

        for (const notification of dueNotifications) {
            console.log(`[PUSH_CHECKER] Processing notification ID: ${notification.id} for "${notification.programTitle}".`);
            if (new Date(notification.programStop).getTime() <= now.getTime()) {
                db.run("UPDATE notifications SET status = 'expired', triggeredAt = ? WHERE id = ?", [nowIso, notification.id], (err) => {
                    if (err) console.error(`[PUSH_CHECKER] Error marking notification ${notification.id} as expired:`, err.message);
                });
                console.log(`[PUSH_CHECKER] Notification for "${notification.programTitle}" (ID: ${notification.id}) expired. Program already ended.`);
                continue;
            }

            const subscriptions = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM push_subscriptions WHERE user_id = ?", [notification.user_id], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            if (subscriptions.length === 0) {
                console.log(`[PUSH_CHECKER] No active push subscriptions for user ${notification.user_id}. Marking notification ${notification.id} as expired.`);
                 db.run("UPDATE notifications SET status = 'expired', triggeredAt = ? WHERE id = ?", [nowIso, notification.id], (err) => {
                    if (err) console.error(`[PUSH_CHECKER] Error marking notification ${notification.id} as expired (no subscriptions):`, err.message);
                });
                continue;
            }

            const payload = JSON.stringify({
                title: `Upcoming: ${notification.programTitle}`,
                body: `Starts at ${new Date(notification.programStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${notification.channelName}`,
                icon: notification.channelLogo || 'https://i.imgur.com/rwa8SjI.png',
                data: {
                    url: `/tvguide?channelId=${notification.channelId}&programId=${notification.programId}`
                }
            });

            const sendPromises = subscriptions.map(sub => {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh, auth: sub.auth }
                };

                return webpush.sendNotification(pushSubscription, payload)
                    .then(() => {
                        console.log(`[PUSH_CHECKER] Notification "${notification.programTitle}" (ID: ${notification.id}) sent to endpoint: ${sub.endpoint}`);
                        db.run("UPDATE notifications SET status = 'sent', triggeredAt = ? WHERE id = ?", [nowIso, notification.id], (err) => {
                            if (err) console.error(`[PUSH_CHECKER] Error updating notification ${notification.id} status to sent:`, err.message);
                        });
                    })
                    .catch(error => {
                        console.error(`[PUSH_CHECKER] Error sending notification ${notification.id} to ${sub.endpoint}:`, error.statusCode, error.body || error.message);
                        if (error.statusCode === 410 || error.statusCode === 404) {
                            console.log(`[PUSH_CHECKER] Subscription expired or invalid (410/404). Deleting endpoint: ${sub.endpoint}`);
                            db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint], (err) => {
                                if (err) console.error(`[PUSH_CHECKER] Error deleting expired subscription ${sub.endpoint}:`, err.message);
                            });
                        }
                    });
            });

            await Promise.all(sendPromises);
        }
    } catch (error) {
        console.error('[PUSH_CHECKER] Unhandled error in checkAndSendNotifications:', error);
    }
}

// --- Main Route Handling ---
app.get('*', (req, res) => {
    const filePath = path.join(PUBLIC_DIR, req.path);

    if(fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()){
        console.log(`[HTTP] Serving static file: ${req.path}`);
        return res.sendFile(filePath);
    }
    console.log(`[HTTP] Serving index.html for path: ${req.path}`);
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// --- Server Start ---
app.listen(port, () => {
    console.log(`\n======================================================`);
    console.log(` VINI PLAY server listening at http://localhost:${port}`);
    console.log(` Data is stored persistently in your host's viniplay-data folder`);
    console.log(` Serving frontend from: ${PUBLIC_DIR}`);
    console.log(`======================================================\n`);

    processAndMergeSources().then((result) => {
        console.log('[INIT] Initial source processing complete.');
        if(result.success) {
             fs.writeFileSync(SETTINGS_PATH, JSON.stringify(result.updatedSettings, null, 2));
        }
        updateAndScheduleSourceRefreshes();
    }).catch(error => {
        console.error('[INIT] Initial source processing failed:', error.message);
    });

    if (notificationCheckInterval) clearInterval(notificationCheckInterval);
    notificationCheckInterval = setInterval(checkAndSendNotifications, 60000);
    console.log('[Push] Notification checker started. Will check for due notifications every minute.');
});
