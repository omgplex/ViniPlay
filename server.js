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

const app = express();
const port = 8998;
const saltRounds = 10;
let epgRefreshTimeout = null;
let notificationCheckInterval = null;

// --- Configuration ---
const DATA_DIR = '/data';
const VAPID_KEYS_PATH = path.join(DATA_DIR, 'vapid.json');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_PATH = path.join(DATA_DIR, 'viniplay.db');
const MERGED_M3U_PATH = path.join(DATA_DIR, 'playlist.m3u');
const MERGED_EPG_JSON_PATH = path.join(DATA_DIR, 'epg.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// Declare db and vapidKeys globally so they can be accessed by API endpoints
let db;
let vapidKeys = {};

// --- Server Initialization Function ---
async function initializeServer() {
    console.log('[SERVER_INIT] Starting server initialization...');

    // 1. Ensure the data and public directories exist.
    console.log('[SERVER_INIT] Checking/creating necessary directories...');
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
        if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });
        console.log('[SERVER_INIT] Directories checked/created successfully.');
    } catch (dirErr) {
        console.error('[SERVER_INIT] FATAL: Error creating directories.', dirErr);
        process.exit(1);
    }

    // 2. Automatic VAPID Key Generation/Loading
    try {
        if (fs.existsSync(VAPID_KEYS_PATH)) {
            console.log('[SERVER_INIT][Push] Loading existing VAPID keys from', VAPID_KEYS_PATH);
            vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8'));
            console.log('[SERVER_INIT][Push] VAPID keys loaded.');
        } else {
            console.log('[SERVER_INIT][Push] VAPID keys not found. Generating new keys...');
            vapidKeys = webpush.generateVAPIDKeys();
            fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(vapidKeys, null, 2));
            console.log('[SERVER_INIT][Push] New VAPID keys generated and saved to', VAPID_KEYS_PATH);
        }
        // Configure web-push with the loaded/generated keys
        webpush.setVapidDetails(
            'mailto:example@example.com', // This can be a placeholder
            vapidKeys.publicKey,
            vapidKeys.privateKey
        );
        console.log('[SERVER_INIT][Push] web-push configured successfully.');
    } catch (error) {
        console.error('[SERVER_INIT][Push] FATAL: Could not load or generate VAPID keys. Exiting.', error);
        process.exit(1); // Critical error, exit process
    }

    // 3. Database Setup
    console.log('[SERVER_INIT] Connecting to SQLite database and ensuring schema...');
    db = await new Promise((resolve, reject) => {
        const sqliteDb = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error("[SERVER_INIT][DB] Error opening database:", err.message);
                reject(err);
                return;
            }
            console.log("[SERVER_INIT][DB] Connected to the SQLite database.");
            
            sqliteDb.serialize(() => {
                let errorOccurred = false;
                const runAndCheck = (sql, tableName, callback) => {
                    sqliteDb.run(sql, (err) => {
                        if (err) {
                            console.error(`[SERVER_INIT][DB] Error creating table ${tableName}:`, err.message);
                            errorOccurred = true;
                            // Do not reject immediately here, let the serial execution finish for all tables
                        } else {
                            console.log(`[SERVER_INIT][DB] Table ${tableName} checked/created.`);
                            if (callback) callback();
                        }
                    });
                };

                runAndCheck(`CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE,
                    password TEXT,
                    isAdmin INTEGER DEFAULT 0
                )`, 'users', () => {
                    if (errorOccurred) return;
                    runAndCheck(`CREATE TABLE IF NOT EXISTS user_settings (
                        user_id INTEGER NOT NULL,
                        key TEXT NOT NULL,
                        value TEXT,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        PRIMARY KEY (user_id, key)
                    )`, 'user_settings', () => {
                        if (errorOccurred) return;
                        runAndCheck(`CREATE TABLE IF NOT EXISTS notifications (
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
                            status TEXT NOT NULL DEFAULT 'active',
                            notifiedAt TEXT,
                            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                            UNIQUE(user_id, programId)
                        )`, 'notifications', () => {
                            if (errorOccurred) return;
                            runAndCheck(`CREATE TABLE IF NOT EXISTS push_subscriptions (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                user_id INTEGER NOT NULL,
                                endpoint TEXT UNIQUE NOT NULL,
                                p256dh TEXT NOT NULL,
                                auth TEXT NOT NULL,
                                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                            )`, 'push_subscriptions', () => {
                                if (errorOccurred) {
                                    reject(new Error("One or more database tables failed to create."));
                                } else {
                                    console.log("[SERVER_INIT][DB] All database schemas checked/created successfully.");
                                    resolve(sqliteDb);
                                }
                            });
                        });
                    });
                });
            });
        });
    });


    // --- Middleware ---
    app.use(express.static(PUBLIC_DIR));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));

    app.use(
      session({
        store: new SQLiteStore({
            db: 'viniplay.db',
            dir: DATA_DIR,
            table: 'sessions'
        }),
        secret: process.env.SESSION_SECRET || 'fallback-secret-key-for-dev',
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        },
      })
    );
    console.log('[SERVER_INIT] Express middleware and session configured.');

    // --- Authentication Middleware ---
    const requireAuth = (req, res, next) => {
        if (req.session && req.session.userId) {
            console.log(`[AUTH_MIDDLEWARE] User ID ${req.session.userId} authenticated.`);
            return next();
        } else {
            console.log(`[AUTH_MIDDLEWARE] Authentication required for path: ${req.path}`);
            return res.status(401).json({ error: 'Authentication required.' });
        }
    };

    const requireAdmin = (req, res, next) => {
        if (req.session && req.session.isAdmin) {
            console.log(`[AUTH_MIDDLEWARE] User ID ${req.session.userId} is admin.`);
            return next();
        } else {
            console.log(`[AUTH_MIDDLEWARE] Admin privileges required for path: ${req.path}`);
            return res.status(403).json({ error: 'Administrator privileges required.' });
        }
    };

    // --- Helper Functions ---
    function getSettings() {
        if (!fs.existsSync(SETTINGS_PATH)) {
            console.log('[SETTINGS] settings.json not found, creating default settings.');
            const defaultSettings = {
                m3uSources: [],
                epgSources: [],
                userAgents: [{ id: `default-ua-${Date.now()}`, name: 'ViniPlay Default', value: 'VLC/3.0.20 (Linux; x86_64)', isDefault: true }],
                streamProfiles: [
                    { id: 'ffmpeg-default', name: 'ffmpeg (Built in)', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c:v libx64 -preset veryfast -crf 23 -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: true }
                ],
                activeUserAgentId: `default-ua-${Date.now()}`,
                activeStreamProfileId: 'ffmpeg-default',
                searchScope: 'channels_programs',
                autoRefresh: 0,
                timezoneOffset: Math.round(-(new Date().getTimezoneOffset() / 60)),
                notificationLeadTime: 10
            };
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2));
            return defaultSettings;
        }
        try {
            const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            if (!settings.m3uSources) settings.m3uSources = [];
            if (!settings.epgSources) settings.epgSources = [];
            if (settings.notificationLeadTime === undefined) settings.notificationLeadTime = 10;
            console.log('[SETTINGS] settings.json loaded successfully.');
            return settings;
        } catch (e) {
            console.error("[SETTINGS] Could not parse settings.json, returning default.", e);
            return { m3uSources: [], epgSources: [], notificationLeadTime: 10 };
        }
    }

    function saveSettings(settings) {
        try {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
            console.log('[SETTINGS] settings.json saved successfully.');
        } catch (e) {
            console.error("[SETTINGS] Error saving settings:", e);
        }
    }

    function fetchUrlContent(url) {
        console.log(`[FETCH_URL] Attempting to fetch content from: ${url}`);
        return new Promise((resolve, reject) => {
            const protocol = url.startsWith('https') ? https : http;
            protocol.get(url, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    console.log(`[FETCH_URL] Redirecting to: ${res.headers.location}`);
                    return fetchUrlContent(new URL(res.headers.location, url).href).then(resolve, reject);
                }
                if (res.statusCode !== 200) {
                    console.error(`[FETCH_URL] Failed to fetch ${url}: Status Code ${res.statusCode}`);
                    return reject(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
                }
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    console.log(`[FETCH_URL] Successfully fetched content from: ${url}`);
                    resolve(data);
                });
            }).on('error', (err) => {
                console.error(`[FETCH_URL] Error fetching content from ${url}:`, err);
                reject(err);
            });
        });
    }


    // --- EPG Parsing and Caching Logic ---
    const parseEpgTime = (timeStr, offsetHours = 0) => {
        const match = timeStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*(([+-])(\d{2})(\d{2}))?/);
        if (!match) {
            console.warn(`[EPG_PARSE] Invalid time string format: ${timeStr}`);
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
        console.log('[PROCESS_SOURCES] Starting to process and merge all active sources.');
        const settings = getSettings();

        let mergedM3uContent = '#EXTM3U\n';
        const activeM3uSources = settings.m3uSources.filter(s => s.isActive);
        console.log(`[PROCESS_SOURCES] Found ${activeM3uSources.length} active M3U sources.`);
        for (const source of activeM3uSources) {
            console.log(`[PROCESS_SOURCES][M3U] Processing: ${source.name} (Type: ${source.type}, Path: ${source.path})`);
            try {
                let content = '';
                if (source.type === 'file') {
                    const sourceFilePath = path.join(SOURCES_DIR, path.basename(source.path));
                    if (fs.existsSync(sourceFilePath)) {
                        content = fs.readFileSync(sourceFilePath, 'utf-8');
                    } else {
                        console.error(`[PROCESS_SOURCES][M3U] File not found for source "${source.name}": ${sourceFilePath}`);
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
                        const tvgId = tvgIdMatch ? tvgIdMatch[1] : `no-id-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`; 
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
                console.log(`[PROCESS_SOURCES][M3U] Source "${source.name}" processed successfully.`);

            } catch (error) {
                console.error(`[PROCESS_SOURCES][M3U] Failed to process source "${source.name}":`, error.message);
                source.status = 'Error';
                source.statusMessage = 'Processing failed.';
            }
            source.lastUpdated = new Date().toISOString();
        }
        fs.writeFileSync(MERGED_M3U_PATH, mergedM3uContent);
        console.log(`[PROCESS_SOURCES][M3U] Finished merging M3U sources to ${MERGED_M3U_PATH}.`);

        const mergedProgramData = {};
        const timezoneOffset = settings.timezoneOffset || 0;
        const activeEpgSources = settings.epgSources.filter(s => s.isActive);
        console.log(`[PROCESS_SOURCES] Found ${activeEpgSources.length} active EPG sources.`);

        for (const source of activeEpgSources) {
            console.log(`[PROCESS_SOURCES][EPG] Processing: ${source.name} (Type: ${source.type}, Path: ${source.path})`);
            try {
                let xmlString = '';
                const epgFilePath = path.join(SOURCES_DIR, `epg_${source.id}.xml`);
                if (source.type === 'file') {
                    if (fs.existsSync(epgFilePath)) {
                        xmlString = fs.readFileSync(epgFilePath, 'utf-8');
                    } else {
                        const oldPath = path.join(SOURCES_DIR, path.basename(source.path));
                        if (fs.existsSync(oldPath)) {
                            xmlString = fs.readFileSync(oldPath, 'utf-8');
                        } else {
                            console.error(`[PROCESS_SOURCES][EPG] File not found for source "${source.name}": ${epgFilePath}`);
                            source.status = 'Error';
                            source.statusMessage = 'File not found.';
                            continue;
                        }
                    }
                } else if (source.type === 'url') {
                    xmlString = await fetchUrlContent(source.path);
                    fs.writeFileSync(epgFilePath, xmlString);
                    console.log(`[PROCESS_SOURCES][EPG] EPG content from URL saved to ${epgFilePath}.`);
                }

                const epgJson = xmlJS.xml2js(xmlString, { compact: true, ignoreComment: true, alwaysArray: ['programme', 'channel'] });
                const programs = epgJson.tv && epgJson.tv.programme ? epgJson.tv.programme : [];
                console.log(`[PROCESS_SOURCES][EPG] Found ${programs.length} programs in EPG source "${source.name}".`);

                for (const prog of programs) {
                    const originalChannelId = prog._attributes?.channel;
                    if (!originalChannelId) {
                        // console.warn(`[PROCESS_SOURCES][EPG] Program without channel ID found in source "${source.name}":`, prog);
                        continue;
                    }
                    
                    const m3uSourceProviders = settings.m3uSources.filter(m3u => m3u.isActive);

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
                console.log(`[PROCESS_SOURCES][EPG] Source "${source.name}" processed successfully.`);
            } catch (error) {
                console.error(`[PROCESS_SOURCES][EPG] Failed to process source "${source.name}":`, error.message);
                source.status = 'Error';
                source.statusMessage = 'Processing failed.';
            }
            source.lastUpdated = new Date().toISOString();
        }
        for (const channelId in mergedProgramData) {
            mergedProgramData[channelId].sort((a, b) => new Date(a.start) - new Date(b.start));
        }
        fs.writeFileSync(MERGED_EPG_JSON_PATH, JSON.stringify(mergedProgramData));
        console.log(`[PROCESS_SOURCES][EPG] Finished merging and parsing EPG sources to ${MERGED_EPG_JSON_PATH}. Total channels with EPG data: ${Object.keys(mergedProgramData).length}`);
        
        saveSettings(settings);
        console.log('[PROCESS_SOURCES] All sources processed and settings saved.');
        return { success: true, message: 'Sources merged successfully.'};
    }


    const scheduleEpgRefresh = () => {
        clearTimeout(epgRefreshTimeout);
        let settings = getSettings();
        const refreshHours = parseInt(settings.autoRefresh, 10);
        
        if (refreshHours > 0) {
            console.log(`[EPG_REFRESH] Scheduling EPG refresh every ${refreshHours} hours.`);
            epgRefreshTimeout = setTimeout(async () => {
                console.log('[EPG_REFRESH] Triggering scheduled EPG refresh...');
                const activeEpgUrlSources = settings.epgSources.filter(s => s.isActive && s.type === 'url');
                for(const source of activeEpgUrlSources) {
                    try {
                        console.log(`[EPG_REFRESH] Refreshing ${source.name} from ${source.path}`);
                        const content = await fetchUrlContent(source.path);
                        const epgFilePath = path.join(SOURCES_DIR, `epg_${source.id}.xml`);
                        fs.writeFileSync(epgFilePath, content);
                    } catch(error) {
                        console.error(`[EPG_REFRESH] Scheduled refresh for ${source.name} failed:`, error.message);
                    }
                }
                await processAndMergeSources();
                scheduleEpgRefresh();
                
            }, refreshHours * 3600 * 1000);
        } else {
            console.log('[EPG_REFRESH] Automatic EPG refresh is disabled.');
        }
    };

    // --- Authentication API Endpoints ---
    app.get('/api/auth/needs-setup', (req, res) => {
        console.log('[API_AUTH] GET /api/auth/needs-setup received.');
        db.get("SELECT COUNT(*) as count FROM users WHERE isAdmin = 1", [], (err, row) => {
            if (err) {
                console.error('[API_AUTH] Error checking admin count:', err.message);
                return res.status(500).json({ error: err.message });
            }
            console.log(`[API_AUTH] Admin count: ${row.count}. Needs setup: ${row.count === 0}`);
            res.json({ needsSetup: row.count === 0 });
        });
    });

    app.post('/api/auth/setup-admin', (req, res) => {
        console.log('[API_AUTH] POST /api/auth/setup-admin received. Body:', req.body.username ? `{username: ${req.body.username}, password: [HIDDEN]}` : '[empty body]');
        db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
            if (err) {
                console.error('[API_AUTH] Error checking user count for setup:', err.message);
                return res.status(500).json({ error: err.message });
            }
            if (row.count > 0) {
                console.warn('[API_AUTH] Setup attempted but users already exist.');
                return res.status(403).json({ error: "Setup has already been completed." });
            }
            
            const { username, password } = req.body;
            if (!username || !password) {
                console.warn('[API_AUTH] Setup attempt with missing username or password.');
                return res.status(400).json({ error: "Username and password are required." });
            }

            bcrypt.hash(password, saltRounds, (err, hash) => {
                if (err) {
                    console.error('[API_AUTH] Error hashing password during setup:', err);
                    return res.status(500).json({ error: 'Error hashing password.' });
                }
                db.run("INSERT INTO users (username, password, isAdmin) VALUES (?, ?, 1)", [username, hash], function(err) {
                    if (err) {
                        console.error('[API_AUTH] Error inserting admin user:', err.message);
                        return res.status(500).json({ error: err.message });
                    }
                    req.session.userId = this.lastID;
                    req.session.username = username;
                    req.session.isAdmin = true;
                    console.log(`[API_AUTH] Admin user ${username} created and session set. User ID: ${this.lastID}`);
                    res.json({ success: true, user: { username, isAdmin: true } });
                });
            });
        });
    });

    app.post('/api/auth/login', (req, res) => {
        console.log('[API_AUTH] POST /api/auth/login received. Body:', req.body.username ? `{username: ${req.body.username}, password: [HIDDEN]}` : '[empty body]');
        const { username, password } = req.body;
        db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
            if (err) {
                console.error('[API_AUTH] Error during login DB query:', err.message);
                return res.status(500).json({ error: err.message });
            }
            if (!user) {
                console.warn(`[API_AUTH] Login failed: User "${username}" not found.`);
                return res.status(401).json({ error: "Invalid username or password." });
            }
            
            bcrypt.compare(password, user.password, (err, result) => {
                if (err) {
                    console.error('[API_AUTH] Error comparing password hash:', err);
                    return res.status(500).json({ error: 'Server error during login.' });
                }
                if (result) {
                    req.session.userId = user.id;
                    req.session.username = user.username;
                    req.session.isAdmin = user.isAdmin === 1;
                    console.log(`[API_AUTH] User "${username}" logged in successfully. User ID: ${user.id}`);
                    res.json({
                        success: true,
                        user: { username: user.username, isAdmin: user.isAdmin === 1 }
                    });
                } else {
                    console.warn(`[API_AUTH] Login failed: Incorrect password for user "${username}".`);
                    res.status(401).json({ error: "Invalid username or password." });
                }
            });
        });
    });

    app.post('/api/auth/logout', (req, res) => {
        console.log('[API_AUTH] POST /api/auth/logout received. User ID:', req.session.userId);
        req.session.destroy(err => {
            if (err) {
                console.error('[API_AUTH] Error destroying session during logout:', err);
                return res.status(500).json({ error: 'Could not log out.' });
            }
            res.clearCookie('connect.sid');
            console.log('[API_AUTH] Session destroyed, cookie cleared. Logout successful.');
            res.json({ success: true });
        });
    });

    app.get('/api/auth/status', (req, res) => {
        console.log('[API_AUTH] GET /api/auth/status received.');
        if (req.session && req.session.userId) {
            console.log(`[API_AUTH] User is logged in. User ID: ${req.session.userId}, Username: ${req.session.username}, IsAdmin: ${req.session.isAdmin}`);
            res.json({ isLoggedIn: true, user: { username: req.session.username, isAdmin: req.session.isAdmin } });
        } else {
            console.log('[API_AUTH] User is NOT logged in.');
            res.json({ isLoggedIn: false });
        }
    });


    // --- User Management API Endpoints (Admin only) ---
    app.get('/api/users', requireAdmin, (req, res) => {
        console.log('[API_USERS] GET /api/users received.');
        db.all("SELECT id, username, isAdmin FROM users ORDER BY username", [], (err, rows) => {
            if (err) {
                console.error('[API_USERS] Error fetching users:', err.message);
                return res.status(500).json({ error: err.message });
            }
            console.log(`[API_USERS] Fetched ${rows.length} users.`);
            res.json(rows);
        });
    });

    app.post('/api/users', requireAdmin, (req, res) => {
        console.log('[API_USERS] POST /api/users received. Body:', req.body.username ? `{username: ${req.body.username}, isAdmin: ${req.body.isAdmin}}` : '[empty body]');
        const { username, password, isAdmin } = req.body;
        if (!username || !password) {
            console.warn('[API_USERS] Add user failed: Username or password missing.');
            return res.status(400).json({ error: "Username and password are required." });
        }
        
        bcrypt.hash(password, saltRounds, (err, hash) => {
            if (err) {
                console.error('[API_USERS] Error hashing password for new user:', err);
                return res.status(500).json({ error: 'Error hashing password' });
            }
            db.run("INSERT INTO users (username, password, isAdmin) VALUES (?, ?, ?)", [username, hash, isAdmin ? 1 : 0], function (err) {
                if (err) {
                    console.error('[API_USERS] Error inserting new user:', err.message);
                    return res.status(400).json({ error: "Username already exists." });
                }
                console.log(`[API_USERS] User "${username}" added. ID: ${this.lastID}`);
                res.json({ success: true, id: this.lastID });
            });
        });
    });

    app.put('/api/users/:id', requireAdmin, (req, res) => {
        console.log(`[API_USERS] PUT /api/users/${req.params.id} received. Body:`, req.body.username ? `{username: ${req.body.username}, isAdmin: ${req.body.isAdmin}}` : '[empty body]');
        const { id } = req.params;
        const { username, password, isAdmin } = req.body;

        const updateUser = () => {
            if (password) {
                bcrypt.hash(password, saltRounds, (err, hash) => {
                    if (err) {
                        console.error('[API_USERS] Error hashing password for update:', err);
                        return res.status(500).json({ error: 'Error hashing password' });
                    }
                    db.run("UPDATE users SET username = ?, password = ?, isAdmin = ? WHERE id = ?", [username, hash, isAdmin ? 1 : 0, id], (err) => {
                        if (err) {
                            console.error('[API_USERS] Error updating user (with password):', err.message);
                            return res.status(500).json({ error: err.message });
                        }
                        if (req.session.userId == id) req.session.isAdmin = isAdmin;
                        console.log(`[API_USERS] User ID ${id} updated (with password).`);
                        res.json({ success: true });
                    });
                });
            } else {
                db.run("UPDATE users SET username = ?, isAdmin = ? WHERE id = ?", [username, isAdmin ? 1 : 0, id], (err) => {
                    if (err) {
                        console.error('[API_USERS] Error updating user (no password):', err.message);
                        return res.status(500).json({ error: err.message });
                    }
                    if (req.session.userId == id) req.session.isAdmin = isAdmin;
                    console.log(`[API_USERS] User ID ${id} updated (no password).`);
                    res.json({ success: true });
                });
            }
        };
        
        if (req.session.userId == id && !isAdmin) {
            console.warn(`[API_USERS] Admin user ${id} attempting to remove own admin privileges.`);
            db.get("SELECT COUNT(*) as count FROM users WHERE isAdmin = 1", [], (err, row) => {
                if (err) {
                    console.error('[API_USERS] Error checking admin count for privilege removal:', err.message);
                    return res.status(500).json({ error: err.message });
                }
                if (row.count <= 1) {
                    console.warn(`[API_USERS] Cannot remove last administrator privileges for user ${id}.`);
                    return res.status(403).json({error: "Cannot remove the last administrator."});
                }
                updateUser();
            });
        } else {
            updateUser();
        }
    });

    app.delete('/api/users/:id', requireAdmin, (req, res) => {
        console.log(`[API_USERS] DELETE /api/users/${req.params.id} received.`);
        const { id } = req.params;
        if (req.session.userId == id) {
            console.warn(`[API_USERS] Attempt to delete own account by user ${id}.`);
            return res.status(403).json({ error: "You cannot delete your own account." });
        }
        
        db.run("DELETE FROM users WHERE id = ?", id, function(err) {
            if (err) {
                console.error('[API_USERS] Error deleting user:', err.message);
                return res.status(500).json({ error: err.message });
            }
            console.log(`[API_USERS] User ID ${id} deleted. Changes: ${this.changes}`);
            res.json({ success: true });
        });
    });


    // --- Protected IPTV API Endpoints ---
    app.get('/api/config', requireAuth, (req, res) => {
        console.log('[API_CONFIG] GET /api/config received.');
        try {
            let config = { m3uContent: null, epgContent: null, settings: {} };
            let globalSettings = getSettings();
            config.settings = globalSettings;

            if (fs.existsSync(MERGED_M3U_PATH)) {
                config.m3uContent = fs.readFileSync(MERGED_M3U_PATH, 'utf-8');
                console.log(`[API_CONFIG] Loaded M3U content from ${MERGED_M3U_PATH}`);
            } else {
                console.log(`[API_CONFIG] No M3U content found at ${MERGED_M3U_PATH}`);
            }
            if (fs.existsSync(MERGED_EPG_JSON_PATH)) {
                config.epgContent = JSON.parse(fs.readFileSync(MERGED_EPG_JSON_PATH, 'utf-8'));
                console.log(`[API_CONFIG] Loaded EPG content from ${MERGED_EPG_JSON_PATH}`);
            } else {
                console.log(`[API_CONFIG] No EPG content found at ${MERGED_EPG_JSON_PATH}`);
            }
            
            db.all(`SELECT key, value FROM user_settings WHERE user_id = ?`, [req.session.userId], (err, rows) => {
                if (err) {
                    console.error("[API_CONFIG] Error fetching user settings:", err);
                    return res.json(config);
                }
                if (rows) {
                    const userSettings = {};
                    rows.forEach(row => {
                        try {
                            userSettings[row.key] = JSON.parse(row.value);
                        } catch (e) {
                            userSettings[row.key] = row.value;
                        }
                    });
                    config.settings = { ...config.settings, ...userSettings };
                    console.log(`[API_CONFIG] Merged ${rows.length} user settings for user ${req.session.userId}.`);
                } else {
                    console.log(`[API_CONFIG] No user settings found for user ${req.session.userId}.`);
                }
                res.json(config);
            });

        } catch (error) {
            console.error("[API_CONFIG] Error reading config:", error);
            res.status(500).json({ error: "Could not load configuration from server." });
        }
    });


    const upload = multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => {
                console.log(`[MULTER] Uploading file: ${file.originalname} to ${SOURCES_DIR}`);
                cb(null, SOURCES_DIR);
            },
            filename: (req, file, cb) => {
                const newFileName = `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`;
                console.log(`[MULTER] Renaming ${file.originalname} to ${newFileName}`);
                cb(null, newFileName);
            }
        })
    });


    app.post('/api/sources', requireAuth, upload.single('sourceFile'), async (req, res) => {
        console.log('[API_SOURCES] POST /api/sources received. Body:', req.body);
        console.log('[API_SOURCES] File:', req.file ? req.file.filename : 'none');
        const { sourceType, name, url, isActive, id } = req.body;

        if (!sourceType || !name) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            console.warn('[API_SOURCES] Add/update source failed: Source type or name missing.');
            return res.status(400).json({ error: 'Source type and name are required.' });
        }

        const settings = getSettings();
        const sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;

        if (id) {
            console.log(`[API_SOURCES] Updating existing source with ID: ${id}`);
            const sourceIndex = sourceList.findIndex(s => s.id === id);
            if (sourceIndex === -1) {
                if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                console.warn(`[API_SOURCES] Source to update with ID ${id} not found.`);
                return res.status(404).json({ error: 'Source to update not found.' });
            }

            const sourceToUpdate = sourceList[sourceIndex];
            sourceToUpdate.name = name;
            sourceToUpdate.isActive = isActive === 'true';
            sourceToUpdate.lastUpdated = new Date().toISOString();

            if (req.file) { 
                console.log(`[API_SOURCES] New file uploaded for source ${id}. Deleting old file if exists.`);
                if (sourceToUpdate.type === 'file' && fs.existsSync(sourceToUpdate.path)) {
                    try {
                        fs.unlinkSync(sourceToUpdate.path);
                        console.log(`[API_SOURCES] Old file ${sourceToUpdate.path} deleted.`);
                    } catch (e) { console.error("[API_SOURCES] Could not delete old source file:", e); }
                }

                const extension = sourceType === 'm3u' ? '.m3u' : '.xml';
                const newPath = path.join(SOURCES_DIR, `${sourceType}_${id}${extension}`);
                try {
                    fs.renameSync(req.file.path, newPath);
                    sourceToUpdate.path = newPath;
                    sourceToUpdate.type = 'file';
                    console.log(`[API_SOURCES] Uploaded file renamed to ${newPath}.`);
                } catch (e) {
                    console.error('[API_SOURCES] Error renaming updated source file:', e);
                    return res.status(500).json({ error: 'Could not save updated file.' });
                }
            } else if (url) {
                console.log(`[API_SOURCES] Source ${id} updated to URL type. Deleting old file if exists.`);
                if (sourceToUpdate.type === 'file' && fs.existsSync(sourceToUpdate.path)) {
                    try {
                        fs.unlinkSync(sourceToUpdate.path);
                        console.log(`[API_SOURCES] Old file ${sourceToUpdate.path} deleted.`);
                    } catch (e) { console.error("[API_SOURCES] Could not delete old source file:", e); }
                }
                sourceToUpdate.path = url;
                sourceToUpdate.type = 'url';
            }

            saveSettings(settings);
            console.log(`[API_SOURCES] Source ID ${id} updated successfully.`);
            res.json({ success: true, message: 'Source updated successfully.', settings });

        } else { 
            console.log('[API_SOURCES] Adding new source.');
            const newSource = {
                id: `src-${Date.now()}`,
                name,
                type: req.file ? 'file' : 'url',
                path: req.file ? req.file.path : url,
                isActive: isActive === 'true',
                lastUpdated: new Date().toISOString(),
                status: 'Pending',
                statusMessage: 'Source added. Process to load data.'
            };

            if (newSource.type === 'url' && !newSource.path) {
                console.warn('[API_SOURCES] New URL source failed: URL missing.');
                return res.status(400).json({ error: 'URL is required for URL-type source.' });
            }

            if (req.file) {
                const extension = sourceType === 'm3u' ? '.m3u' : '.xml';
                const newPath = path.join(SOURCES_DIR, `${sourceType}_${newSource.id}${extension}`);
                try {
                    fs.renameSync(req.file.path, newPath);
                    newSource.path = newPath;
                } catch (e) {
                    console.error('[API_SOURCES] Error renaming new source file:', e);
                    return res.status(500).json({ error: 'Could not save uploaded file.' });
                }
            }

            sourceList.push(newSource);
            saveSettings(settings);
            console.log(`[API_SOURCES] New source "${name}" added. ID: ${newSource.id}`);
            res.json({ success: true, message: 'Source added successfully.', settings });
        }
    });


    app.put('/api/sources/:sourceType/:id', requireAuth, (req, res) => {
        console.log(`[API_SOURCES] PUT /api/sources/${req.params.sourceType}/${req.params.id} received. Body:`, req.body);
        const { sourceType, id } = req.params;
        const { name, path: newPath, isActive } = req.body;
        
        const settings = getSettings();
        const sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;
        const sourceIndex = sourceList.findIndex(s => s.id === id);

        if (sourceIndex === -1) {
            console.warn(`[API_SOURCES] Source with ID ${id} not found for update.`);
            return res.status(404).json({ error: 'Source not found.' });
        }

        const source = sourceList[sourceIndex];
        source.name = name ?? source.name;
        source.isActive = isActive ?? source.isActive;
        if (source.type === 'url') {
            source.path = newPath ?? source.path;
        }
        source.lastUpdated = new Date().toISOString();

        saveSettings(settings);
        console.log(`[API_SOURCES] Source ${sourceType} ID ${id} updated.`);
        res.json({ success: true, message: 'Source updated.', settings });
    });

    app.delete('/api/sources/:sourceType/:id', requireAuth, (req, res) => {
        console.log(`[API_SOURCES] DELETE /api/sources/${req.params.sourceType}/${req.params.id} received.`);
        const { sourceType, id } = req.params;
        
        const settings = getSettings();
        let sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;
        const source = sourceList.find(s => s.id === id);
        
        if (source && source.type === 'file' && fs.existsSync(source.path)) {
            try {
                fs.unlinkSync(source.path);
                console.log(`[API_SOURCES] Deleted associated file: ${source.path}`);
            } catch (e) {
                console.error(`[API_SOURCES] Could not delete source file: ${source.path}`, e);
            }
        }
        
        const newList = sourceList.filter(s => s.id !== id);
        if (sourceType === 'm3u') settings.m3uSources = newList;
        else settings.epgSources = newList;

        saveSettings(settings);
        console.log(`[API_SOURCES] Source ${sourceType} ID ${id} deleted.`);
        res.json({ success: true, message: 'Source deleted.', settings });
    });

    app.post('/api/process-sources', requireAuth, async (req, res) => {
        console.log('[API_PROCESS_SOURCES] POST /api/process-sources received.');
        try {
            const result = await processAndMergeSources();
            console.log('[API_PROCESS_SOURCES] Sources processing complete. Result:', result);
            res.json(result);
        }
        catch (error) {
            console.error("[API_PROCESS_SOURCES] Error during manual source processing:", error);
            res.status(500).json({ error: 'Failed to process sources.' });
        }
    });


    app.post('/api/save/settings', requireAuth, async (req, res) => {
        console.log('[API_SETTINGS] POST /api/save/settings received. Body:', req.body);
        try {
            let currentSettings = getSettings();
            
            const oldTimezone = currentSettings.timezoneOffset;
            const oldRefresh = currentSettings.autoRefresh;

            const updatedSettings = { ...currentSettings, ...req.body };

            const userSpecificKeys = ['favorites', 'playerDimensions', 'programDetailsDimensions', 'recentChannels', 'notificationLeadTime'];
            userSpecificKeys.forEach(key => delete updatedSettings[key]);

            saveSettings(updatedSettings);
            
            if (updatedSettings.timezoneOffset !== oldTimezone) {
                console.log("[API_SETTINGS] Timezone changed from", oldTimezone, "to", updatedSettings.timezoneOffset, ". Re-processing sources.");
                await processAndMergeSources();
            }
            if (updatedSettings.autoRefresh !== oldRefresh) {
                console.log("[API_SETTINGS] Auto-refresh setting changed from", oldRefresh, "to", updatedSettings.autoRefresh, ". Rescheduling.");
                scheduleEpgRefresh();
            }

            console.log('[API_SETTINGS] Settings saved successfully.');
            res.json({ success: true, message: 'Settings saved.', settings: updatedSettings });
        } catch (error) {
            console.error("[API_SETTINGS] Error saving settings:", error);
            res.status(500).json({ error: "Could not save settings." });
        }
    });

    app.post('/api/user/settings', requireAuth, (req, res) => {
        console.log('[API_USER_SETTINGS] POST /api/user/settings received. Body:', req.body.key ? `{key: ${req.body.key}, value: [HIDDEN]}` : '[empty body]');
        const { key, value } = req.body;
        if (!key) {
            console.warn('[API_USER_SETTINGS] User setting failed: Key missing.');
            return res.status(400).json({ error: 'A setting key is required.' });
        }
        
        const valueJson = JSON.stringify(value);
        const userId = req.session.userId;

        db.run(
            `UPDATE user_settings SET value = ? WHERE user_id = ? AND key = ?`,
            [valueJson, userId, key],
            function (err) {
                if (err) {
                    console.error('[API_USER_SETTINGS] Error updating user setting:', err);
                    return res.status(500).json({ error: 'Could not save user setting.' });
                }
                
                if (this.changes === 0) {
                    console.log(`[API_USER_SETTINGS] No existing user setting found for key "${key}", inserting new.`);
                    db.run(
                        `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`,
                        [userId, key, valueJson],
                        (insertErr) => {
                            if (insertErr) {
                                console.error('[API_USER_SETTINGS] Error inserting user setting:', insertErr);
                                return res.status(500).json({ error: 'Could not save user setting.' });
                            }
                            console.log(`[API_USER_SETTINGS] User setting "${key}" inserted for user ${userId}.`);
                            res.json({ success: true });
                        }
                    );
                } else {
                    console.log(`[API_USER_SETTINGS] User setting "${key}" updated for user ${userId}.`);
                    res.json({ success: true });
                }
            }
        );
    });

    // --- Notification Endpoints ---

    app.get('/api/notifications/vapid-public-key', requireAuth, (req, res) => {
        console.log('[API_NOTIFICATIONS] GET /api/notifications/vapid-public-key received.');
        if (!vapidKeys.publicKey) {
            console.error('[API_NOTIFICATIONS] VAPID public key not available on the server.');
            return res.status(500).json({ error: 'VAPID public key not available on the server.' });
        }
        console.log('[API_NOTIFICATIONS] Sending VAPID public key.');
        res.send(vapidKeys.publicKey);
    });

    app.post('/api/notifications/subscribe', requireAuth, (req, res) => {
        console.log('[API_NOTIFICATIONS] POST /api/notifications/subscribe received. Endpoint:', req.body.endpoint);
        const subscription = req.body;
        const userId = req.session.userId;

        if (!subscription || !subscription.endpoint) {
            console.warn('[API_NOTIFICATIONS] Subscribe failed: Invalid subscription object.');
            return res.status(400).json({ error: 'Invalid subscription object.' });
        }

        const { endpoint, keys: { p256dh, auth } } = subscription;

        db.run(
            `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id`,
            [userId, endpoint, p256dh, auth],
            function(err) {
                if (err) {
                    console.error('[API_NOTIFICATIONS] Error saving push subscription:', err);
                    return res.status(500).json({ error: 'Could not save subscription.' });
                }
                console.log(`[API_NOTIFICATIONS][Push] User ${userId} subscribed with endpoint: ${endpoint}. Changes: ${this.changes}`);
                res.status(201).json({ success: true });
            }
        );
    });

    app.post('/api/notifications/unsubscribe', requireAuth, (req, res) => {
        console.log('[API_NOTIFICATIONS] POST /api/notifications/unsubscribe received. Endpoint:', req.body.endpoint);
        const { endpoint } = req.body;
        if (!endpoint) {
            console.warn('[API_NOTIFICATIONS] Unsubscribe failed: Endpoint missing.');
            return res.status(400).json({ error: 'Endpoint is required to unsubscribe.' });
        }

        db.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", [endpoint, req.session.userId], function(err) {
            if (err) {
                console.error('[API_NOTIFICATIONS] Error deleting push subscription:', err);
                return res.status(500).json({ error: 'Could not unsubscribe.' });
            }
            console.log(`[API_NOTIFICATIONS][Push] User ${req.session.userId} unsubscribed from endpoint: ${endpoint}. Changes: ${this.changes}`);
            res.json({ success: true });
        });
    });

    app.post('/api/notifications', requireAuth, (req, res) => {
        console.log('[API_NOTIFICATIONS] POST /api/notifications received. Program:', req.body.programTitle, 'Channel:', req.body.channelName);
        const { channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, scheduledTime, programId } = req.body;

        if (!channelId || !programTitle || !programStart || !scheduledTime || !programId) {
            console.warn('[API_NOTIFICATIONS] Add notification failed: Missing required fields.');
            return res.status(400).json({ error: 'Missing required notification fields.' });
        }

        db.run(`INSERT INTO notifications (user_id, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, notificationTime, programId)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, programId) DO UPDATE SET
                    channelName=excluded.channelName,
                    channelLogo=excluded.channelLogo,
                    programTitle=excluded.programTitle,
                    programDesc=excluded.programDesc,
                    programStart=excluded.programStart,
                    programStop=excluded.programStop,
                    notificationTime=excluded.notificationTime,
                    status='active'`,
            [req.session.userId, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, scheduledTime, programId],
            function (err) {
                if (err) {
                    console.error('[API_NOTIFICATIONS] Error adding/updating notification to database:', err);
                    return res.status(500).json({ error: 'Could not add notification.' });
                }
                console.log(`[API_NOTIFICATIONS] Notification added/updated for user ${req.session.userId}, program ${programId}. Changes: ${this.changes}`);
                db.get(`SELECT id FROM notifications WHERE user_id = ? AND programId = ?`, [req.session.userId, programId], (err, row) => {
                    if (err || !row) {
                        console.error('[API_NOTIFICATIONS] Could not retrieve notification ID after insert/update:', err);
                        return res.status(500).json({ error: 'Could not retrieve notification ID after insert.' });
                    }
                    console.log(`[API_NOTIFICATIONS] Retrieved notification ID: ${row.id}`);
                    res.status(201).json({ success: true, id: row.id });
                });
            }
        );
    });

    app.get('/api/notifications', requireAuth, (req, res) => {
        console.log('[API_NOTIFICATIONS] GET /api/notifications received. User ID:', req.session.userId);
        const userId = req.session.userId;
        const pastLimit = 10;

        const responsePayload = {
            active: [],
            past: []
        };

        db.all(`SELECT id, user_id, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, notificationTime as scheduledTime, programId, status
                FROM notifications 
                WHERE user_id = ? AND status = 'active'
                ORDER BY notificationTime ASC`,
            [userId],
            (err, activeRows) => {
                if (err) {
                    console.error('[API_NOTIFICATIONS] Error fetching active notifications from database:', err);
                    return res.status(500).json({ error: 'Could not retrieve active notifications.' });
                }
                responsePayload.active = activeRows || [];
                console.log(`[API_NOTIFICATIONS] Fetched ${activeRows.length} active notifications.`);

                db.all(`SELECT id, user_id, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, notificationTime as scheduledTime, programId, status, notifiedAt
                        FROM notifications
                        WHERE user_id = ? AND status != 'active'
                        ORDER BY notifiedAt DESC
                        LIMIT ?`,
                    [userId, pastLimit],
                    (err, pastRows) => {
                        if (err) {
                            console.error('[API_NOTIFICATIONS] Error fetching past notifications from database:', err);
                            return res.status(500).json({ error: 'Could not retrieve past notifications.' });
                        }
                        responsePayload.past = pastRows || [];
                        console.log(`[API_NOTIFICATIONS] Fetched ${pastRows.length} past notifications.`);
                        res.json(responsePayload);
                    }
                );
            }
        );
    });

    app.delete('/api/notifications/:id', requireAuth, (req, res) => {
        console.log(`[API_NOTIFICATIONS] DELETE /api/notifications/${req.params.id} received. User ID:`, req.session.userId);
        const { id } = req.params;
        db.run(`DELETE FROM notifications WHERE id = ? AND user_id = ?`,
            [id, req.session.userId],
            function (err) {
                if (err) {
                    console.error('[API_NOTIFICATIONS] Error deleting notification from database:', err);
                    return res.status(500).json({ error: 'Could not delete notification.' });
                }
                if (this.changes === 0) {
                    console.warn(`[API_NOTIFICATIONS] Notification ID ${id} not found or unauthorized for deletion.`);
                    return res.status(404).json({ error: 'Notification not found or unauthorized.' });
                }
                console.log(`[API_NOTIFICATIONS] Notification ID ${id} deleted. Changes: ${this.changes}`);
                res.json({ success: true });
            }
        );
    });


    app.delete('/api/data', requireAuth, (req, res) => {
        console.log('[API_DATA] DELETE /api/data received. User ID:', req.session.userId);
        try {
            [MERGED_M3U_PATH, MERGED_EPG_JSON_PATH, SETTINGS_PATH].forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log(`[API_DATA] Deleted file: ${file}`);
                }
            });
            if(fs.existsSync(SOURCES_DIR)) {
                fs.rmSync(SOURCES_DIR, { recursive: true, force: true });
                fs.mkdirSync(SOURCES_DIR, { recursive: true });
                console.log(`[API_DATA] Recreated SOURCES_DIR: ${SOURCES_DIR}`);
            }
            
            db.run(`DELETE FROM user_settings WHERE user_id = ?`, [req.session.userId], function(err) {
                if(err) console.error('[API_DATA] Error deleting user_settings:', err);
                else console.log(`[API_DATA] Deleted ${this.changes} user_settings for user ${req.session.userId}.`);
            });
            db.run(`DELETE FROM notifications WHERE user_id = ?`, [req.session.userId], function(err) {
                if(err) console.error('[API_DATA] Error deleting notifications:', err);
                else console.log(`[API_DATA] Deleted ${this.changes} notifications for user ${req.session.userId}.`);
            });
            db.run(`DELETE FROM push_subscriptions WHERE user_id = ?`, [req.session.userId], function(err) {
                if(err) console.error('[API_DATA] Error deleting push_subscriptions:', err);
                else console.log(`[API_DATA] Deleted ${this.changes} push_subscriptions for user ${req.session.userId}.`);
            });

            console.log('[API_DATA] All data cleared for user.');
            res.json({ success: true, message: 'All data has been cleared.' });
        } catch (error) {
            console.error("[API_DATA] Error clearing data:", error);
            res.status(500).json({ error: "Failed to clear data." });
        }
    });

    app.get('/stream', requireAuth, (req, res) => {
        console.log('[STREAM] GET /stream received. Query:', req.query);
        const { url: streamUrl, profileId, userAgentId } = req.query;
        if (!streamUrl) {
            console.warn('[STREAM] Stream request failed: URL missing.');
            return res.status(400).send('Error: `url` query parameter is required.');
        }

        let settings = getSettings();
        
        const profile = (settings.streamProfiles || []).find(p => p.id === profileId);
        if (!profile) {
            console.warn(`[STREAM] Stream request failed: Stream profile with ID "${profileId}" not found.`);
            return res.status(404).send(`Error: Stream profile with ID "${profileId}" not found.`);
        }

        if (profile.command === 'redirect') {
            console.log(`[STREAM] Redirecting to stream URL: ${streamUrl}`);
            return res.redirect(302, streamUrl);
        }
        
        const userAgent = (settings.userAgents || []).find(ua => ua.id === userAgentId);
        if (!userAgent) {
            console.warn(`[STREAM] Stream request failed: User agent with ID "${userAgentId}" not found.`);
            return res.status(404).send(`Error: User agent with ID "${userAgentId}" not found.`);
        }
        
        console.log(`[STREAM] Proxying: ${streamUrl}`);
        console.log(`[STREAM] Profile: "${profile.name}"`);
        console.log(`[STREAM] User Agent: "${userAgent.name}"`);

        const commandTemplate = profile.command
            .replace(/{streamUrl}/g, streamUrl)
            .replace(/{userAgent}|{clientUserAgent}/g, userAgent.value);
            
        const args = (commandTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(arg => arg.replace(/^"|"$/g, ''));
        console.log(`[STREAM] FFMPEG command: ffmpeg ${args.join(' ')}`);

        const ffmpeg = spawn('ffmpeg', args);
        res.setHeader('Content-Type', 'video/mp2t');
        ffmpeg.stdout.pipe(res);
        
        ffmpeg.stderr.on('data', (data) => {
            console.error(`[FFMPEG_ERROR] ${streamUrl}: ${data.toString()}`); // Log FFMPEG stderr output
        });

        ffmpeg.on('close', (code) => {
            if (code !== 0) console.log(`[STREAM] ffmpeg process for ${streamUrl} exited with code ${code}`);
            res.end();
        });

        req.on('close', () => {
            console.log(`[STREAM] Client closed connection for ${streamUrl}. Killing ffmpeg process (PID: ${ffmpeg.pid}).`);
            ffmpeg.kill('SIGKILL');
        });
    });


    async function checkAndSendNotifications() {
        console.log('[PUSH_CHECK] Checking for due notifications...');
        try {
            const now = new Date();
            const dueNotifications = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM notifications WHERE notificationTime <= ? AND status = 'active'", [now.toISOString()], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            if (dueNotifications.length > 0) {
                console.log(`[PUSH_CHECK] Found ${dueNotifications.length} due notifications to send.`);
            } else {
                console.log('[PUSH_CHECK] No due notifications found.');
            }

            for (const notification of dueNotifications) {
                console.log(`[PUSH_CHECK] Processing notification ID: ${notification.id} for user ${notification.user_id}, program: "${notification.programTitle}"`);
                const subscriptions = await new Promise((resolve, reject) => {
                    db.all("SELECT * FROM push_subscriptions WHERE user_id = ?", [notification.user_id], (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows);
                    });
                });
                console.log(`[PUSH_CHECK] Found ${subscriptions.length} subscriptions for user ${notification.user_id}.`);

                const payload = JSON.stringify({
                    title: `Upcoming: ${notification.programTitle}`,
                    body: `Starts at ${new Date(notification.programStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${notification.channelName}`,
                    icon: notification.channelLogo || 'https://i.imgur.com/rwa8SjI.png',
                    data: {
                        url: `/tvguide`,
                        programId: notification.programId,
                        channelId: notification.channelId
                    }
                });

                let notificationSentSuccessfully = false;
                const sendPromises = subscriptions.map(sub => {
                    const pushSubscription = {
                        endpoint: sub.endpoint,
                        keys: { p256dh: sub.p256dh, auth: sub.auth }
                    };
                    console.log(`[PUSH_CHECK] Attempting to send to endpoint: ${sub.endpoint}`);
                    return webpush.sendNotification(pushSubscription, payload)
                        .then(() => {
                            notificationSentSuccessfully = true;
                            console.log(`[PUSH_CHECK] Notification sent successfully to endpoint: ${sub.endpoint}`);
                        })
                        .catch(error => {
                            if (error.statusCode === 410) {
                                console.log(`[PUSH_CHECK] Subscription expired or invalid (410 GONE). Deleting endpoint: ${sub.endpoint}`);
                                db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint], (err) => {
                                    if(err) console.error(`[PUSH_CHECK] Error deleting expired subscription ${sub.endpoint}:`, err);
                                });
                            } else {
                                console.error(`[PUSH_CHECK] Error sending notification to ${sub.endpoint}: Status ${error.statusCode}, Body: ${error.body}`);
                            }
                        });
                });

                await Promise.all(sendPromises);

                const newStatus = notificationSentSuccessfully ? 'sent' : 'expired';
                db.run("UPDATE notifications SET status = ?, notifiedAt = ? WHERE id = ?", [newStatus, new Date().toISOString(), notification.id], (err) => {
                    if (err) console.error(`[PUSH_CHECK] Error updating notification status for ${notification.id}:`, err);
                    else console.log(`[PUSH_CHECK] Marked notification ${notification.id} as ${newStatus}.`);
                });
            }
        } catch (error) {
            console.error('[PUSH_CHECK] Uncaught error in checkAndSendNotifications:', error);
        }
    }


    // --- Main Route Handling ---
    app.get('*', (req, res) => {
        const pathToFile = path.join(PUBLIC_DIR, req.path);
        if(fs.existsSync(pathToFile) && fs.lstatSync(pathToFile).isFile()){
            console.log(`[STATIC_FILE] Serving: ${req.path}`);
            return res.sendFile(pathToFile);
        }
        console.log(`[ROUTE] Catch-all route. Serving index.html for: ${req.path}`);
        res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });

    // --- Server Start ---
    app.listen(port, () => {
        console.log(`\n\n=== VINI PLAY server listening at http://localhost:${port} ===`);
        console.log(`Data is stored in the host directory mapped to ${DATA_DIR}`);
        console.log(`Serving frontend from: ${PUBLIC_DIR}\n`);

        // Schedule periodic tasks after server starts
        scheduleEpgRefresh();
        if (notificationCheckInterval) clearInterval(notificationCheckInterval);
        notificationCheckInterval = setInterval(checkAndSendNotifications, 60000);
        console.log('[SERVER_INIT] Notification checker started. Will check for due notifications every minute.');
        console.log('[SERVER_INIT] Server fully initialized and running.');
    });
}

// Call the initialization function and handle any top-level errors
initializeServer().catch(error => {
    console.error('FATAL: Server initialization failed unexpectedly:', error);
    process.exit(1); // Exit process if initialization fails
});
