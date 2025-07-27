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
    // Configure web-push with the loaded/generated keys
    webpush.setVapidDetails(
        'mailto:example@example.com', // This can be a placeholder
        vapidKeys.publicKey,
        vapidKeys.privateKey
    );
} catch (error) {
    console.error('[Push] FATAL: Could not load or generate VAPID keys.', error);
}


// Ensure the data and public directories exist.
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(SOURCES_DIR)) fs.mkdirSync(SOURCES_DIR, { recursive: true });


// --- Database Setup ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
    } else {
        console.log("Connected to the SQLite database.");
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                isAdmin INTEGER DEFAULT 0
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, key)
            )`);
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
                status TEXT NOT NULL DEFAULT 'active', -- NEW: can be 'active', 'sent', 'expired'
                notifiedAt TEXT, -- NEW: When the notification was sent
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE(user_id, programId) -- NEW: Prevent duplicate notifications for the same program
            )`);
            db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                endpoint TEXT UNIQUE NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )`);
        });
    }
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

// --- Authentication Middleware ---
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    } else {
        return res.status(401).json({ error: 'Authentication required.' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    } else {
        return res.status(403).json({ error: 'Administrator privileges required.' });
    }
};

// --- Helper Functions ---
function getSettings() {
    if (!fs.existsSync(SETTINGS_PATH)) {
        const defaultSettings = {
            m3uSources: [],
            epgSources: [],
            userAgents: [{ id: `default-ua-${Date.now()}`, name: 'ViniPlay Default', value: 'VLC/3.0.20 (Linux; x86_64)', isDefault: true }],
            streamProfiles: [
                { id: 'ffmpeg-default', name: 'ffmpeg (Built in)', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: true }
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
        return settings;
    } catch (e) {
        console.error("Could not parse settings.json, returning default.", e);
        return { m3uSources: [], epgSources: [], notificationLeadTime: 10 };
    }
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error("Error saving settings:", e);
    }
}

function fetchUrlContent(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrlContent(new URL(res.headers.location, url).href).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
            }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', (err) => reject(err));
    });
}


// --- EPG Parsing and Caching Logic ---
const parseEpgTime = (timeStr, offsetHours = 0) => {
    const match = timeStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*(([+-])(\d{2})(\d{2}))?/);
    if (!match) return new Date();
    
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
    const settings = getSettings();
    console.log('[PROCESS] Starting to process and merge all active sources.');

    let mergedM3uContent = '#EXTM3U\n';
    const activeM3uSources = settings.m3uSources.filter(s => s.isActive);
    for (const source of activeM3uSources) {
        console.log(`[M3U] Processing: ${source.name}`);
        try {
            let content = '';
            if (source.type === 'file') {
                const sourceFilePath = path.join(SOURCES_DIR, path.basename(source.path));
                if (fs.existsSync(sourceFilePath)) {
                    content = fs.readFileSync(sourceFilePath, 'utf-8');
                } else {
                    console.error(`[M3U] File not found for source "${source.name}": ${sourceFilePath}`);
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

        } catch (error) {
            console.error(`[M3U] Failed to process source "${source.name}":`, error.message);
            source.status = 'Error';
            source.statusMessage = 'Processing failed.';
        }
        source.lastUpdated = new Date().toISOString();
    }
    fs.writeFileSync(MERGED_M3U_PATH, mergedM3uContent);
    console.log(`[M3U] Finished merging ${activeM3uSources.length} M3U sources.`);

    const mergedProgramData = {};
    const timezoneOffset = settings.timezoneOffset || 0;
    const activeEpgSources = settings.epgSources.filter(s => s.isActive);

    for (const source of activeEpgSources) {
        console.log(`[EPG] Processing: ${source.name}`);
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
                        console.error(`[EPG] File not found for source "${source.name}": ${epgFilePath}`);
                        continue;
                     }
                }
            } else if (source.type === 'url') {
                xmlString = await fetchUrlContent(source.path);
                fs.writeFileSync(epgFilePath, xmlString);
            }

            const epgJson = xmlJS.xml2js(xmlString, { compact: true });
            const programs = epgJson.tv && epgJson.tv.programme ? [].concat(epgJson.tv.programme) : [];

            for (const prog of programs) {
                const originalChannelId = prog._attributes?.channel;
                if (!originalChannelId) continue;
                
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
        } catch (error) {
            console.error(`[EPG] Failed to process source "${source.name}":`, error.message);
            source.status = 'Error';
            source.statusMessage = 'Processing failed.';
        }
         source.lastUpdated = new Date().toISOString();
    }
    for (const channelId in mergedProgramData) {
        mergedProgramData[channelId].sort((a, b) => new Date(a.start) - new Date(b.start));
    }
    fs.writeFileSync(MERGED_EPG_JSON_PATH, JSON.stringify(mergedProgramData));
    console.log(`[EPG] Finished merging and parsing ${activeEpgSources.length} EPG sources.`);
    
    saveSettings(settings);
    return { success: true, message: 'Sources merged successfully.'};
}


const scheduleEpgRefresh = () => {
    clearTimeout(epgRefreshTimeout);
    let settings = getSettings();
    const refreshHours = parseInt(settings.autoRefresh, 10);
    
    if (refreshHours > 0) {
        console.log(`[EPG] Scheduling EPG refresh every ${refreshHours} hours.`);
        epgRefreshTimeout = setTimeout(async () => {
            console.log('[EPG] Triggering scheduled EPG refresh...');
            const activeEpgUrlSources = settings.epgSources.filter(s => s.isActive && s.type === 'url');
            for(const source of activeEpgUrlSources) {
                try {
                    console.log(`[EPG] Refreshing ${source.name} from ${source.path}`);
                    const content = await fetchUrlContent(source.path);
                    const epgFilePath = path.join(SOURCES_DIR, `epg_${source.id}.xml`);
                    fs.writeFileSync(epgFilePath, content);
                } catch(error) {
                     console.error(`[EPG] Scheduled refresh for ${source.name} failed:`, error.message);
                }
            }
            await processAndMergeSources();
            scheduleEpgRefresh();
            
        }, refreshHours * 3600 * 1000);
    }
};

// --- Authentication API Endpoints ---
app.get('/api/auth/needs-setup', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM users WHERE isAdmin = 1", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ needsSetup: row.count === 0 });
    });
});

app.post('/api/auth/setup-admin', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM users", [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row.count > 0) return res.status(403).json({ error: "Setup has already been completed." });
        
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: "Username and password are required." });

        bcrypt.hash(password, saltRounds, (err, hash) => {
            if (err) return res.status(500).json({ error: 'Error hashing password.' });
            db.run("INSERT INTO users (username, password, isAdmin) VALUES (?, ?, 1)", [username, hash], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                req.session.userId = this.lastID;
                req.session.username = username;
                req.session.isAdmin = true;
                res.json({ success: true, user: { username, isAdmin: true } });
            });
        });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: "Invalid username or password." });
        
        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {
                req.session.userId = user.id;
                req.session.username = user.username;
                req.session.isAdmin = user.isAdmin === 1;
                res.json({
                    success: true,
                    user: { username: user.username, isAdmin: user.isAdmin === 1 }
                });
            } else {
                res.status(401).json({ error: "Invalid username or password." });
            }
        });
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Could not log out.' });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({ isLoggedIn: true, user: { username: req.session.username, isAdmin: req.session.isAdmin } });
    } else {
        res.json({ isLoggedIn: false });
    }
});


// --- User Management API Endpoints (Admin only) ---
app.get('/api/users', requireAdmin, (req, res) => {
    db.all("SELECT id, username, isAdmin FROM users ORDER BY username", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', requireAdmin, (req, res) => {
    const { username, password, isAdmin } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password are required." });
    
    bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) return res.status(500).json({ error: 'Error hashing password' });
        db.run("INSERT INTO users (username, password, isAdmin) VALUES (?, ?, ?)", [username, hash, isAdmin ? 1 : 0], function (err) {
            if (err) return res.status(400).json({ error: "Username already exists." });
            res.json({ success: true, id: this.lastID });
        });
    });
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { username, password, isAdmin } = req.body;

    const updateUser = () => {
        if (password) {
            bcrypt.hash(password, saltRounds, (err, hash) => {
                if (err) return res.status(500).json({ error: 'Error hashing password' });
                db.run("UPDATE users SET username = ?, password = ?, isAdmin = ? WHERE id = ?", [username, hash, isAdmin ? 1 : 0, id], (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    if (req.session.userId == id) req.session.isAdmin = isAdmin;
                    res.json({ success: true });
                });
            });
        } else {
            db.run("UPDATE users SET username = ?, isAdmin = ? WHERE id = ?", [username, isAdmin ? 1 : 0, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                 if (req.session.userId == id) req.session.isAdmin = isAdmin;
                res.json({ success: true });
            });
        }
    };
    
    if (req.session.userId == id && !isAdmin) {
         db.get("SELECT COUNT(*) as count FROM users WHERE isAdmin = 1", [], (err, row) => {
            if (err || row.count <= 1) {
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
    if (req.session.userId == id) return res.status(403).json({ error: "You cannot delete your own account." });
    
    db.run("DELETE FROM users WHERE id = ?", id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});


// --- Protected IPTV API Endpoints ---
app.get('/api/config', requireAuth, (req, res) => {
    try {
        let config = { m3uContent: null, epgContent: null, settings: {} };
        let globalSettings = getSettings();
        config.settings = globalSettings;

        if (fs.existsSync(MERGED_M3U_PATH)) config.m3uContent = fs.readFileSync(MERGED_M3U_PATH, 'utf-8');
        if (fs.existsSync(MERGED_EPG_JSON_PATH)) config.epgContent = JSON.parse(fs.readFileSync(MERGED_EPG_JSON_PATH, 'utf-8'));
        
        db.all(`SELECT key, value FROM user_settings WHERE user_id = ?`, [req.session.userId], (err, rows) => {
            if (err) {
                console.error("Error fetching user settings:", err);
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
            }
            res.json(config);
        });

    } catch (error) {
        console.error("Error reading config:", error);
        res.status(500).json({ error: "Could not load configuration from server." });
    }
});


const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, SOURCES_DIR),
        filename: (req, file, cb) => {
            cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
        }
    })
});


app.post('/api/sources', requireAuth, upload.single('sourceFile'), async (req, res) => {
    const { sourceType, name, url, isActive, id } = req.body;

    if (!sourceType || !name) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Source type and name are required.' });
    }

    const settings = getSettings();
    const sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;

    if (id) {
        const sourceIndex = sourceList.findIndex(s => s.id === id);
        if (sourceIndex === -1) {
            if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Source to update not found.' });
        }

        const sourceToUpdate = sourceList[sourceIndex];
        sourceToUpdate.name = name;
        sourceToUpdate.isActive = isActive === 'true';
        sourceToUpdate.lastUpdated = new Date().toISOString();

        if (req.file) { 
            if (sourceToUpdate.type === 'file' && fs.existsSync(sourceToUpdate.path)) {
                try {
                    fs.unlinkSync(sourceToUpdate.path);
                } catch (e) { console.error("Could not delete old source file:", e); }
            }

            const extension = sourceType === 'm3u' ? '.m3u' : '.xml';
            const newPath = path.join(SOURCES_DIR, `${sourceType}_${id}${extension}`);
            try {
                fs.renameSync(req.file.path, newPath);
                sourceToUpdate.path = newPath;
                sourceToUpdate.type = 'file';
            } catch (e) {
                console.error('Error renaming updated source file:', e);
                return res.status(500).json({ error: 'Could not save updated file.' });
            }
        } else if (url) {
            if (sourceToUpdate.type === 'file' && fs.existsSync(sourceToUpdate.path)) {
                try {
                    fs.unlinkSync(sourceToUpdate.path);
                } catch (e) { console.error("Could not delete old source file:", e); }
            }
            sourceToUpdate.path = url;
            sourceToUpdate.type = 'url';
        }

        saveSettings(settings);
        res.json({ success: true, message: 'Source updated successfully.', settings });

    } else { 
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
            return res.status(400).json({ error: 'URL is required for URL-type source.' });
        }

        if (req.file) {
            const extension = sourceType === 'm3u' ? '.m3u' : '.xml';
            const newPath = path.join(SOURCES_DIR, `${sourceType}_${newSource.id}${extension}`);
            try {
                fs.renameSync(req.file.path, newPath);
                newSource.path = newPath;
            } catch (e) {
                console.error('Error renaming new source file:', e);
                return res.status(500).json({ error: 'Could not save uploaded file.' });
            }
        }

        sourceList.push(newSource);
        saveSettings(settings);
        res.json({ success: true, message: 'Source added successfully.', settings });
    }
});


app.put('/api/sources/:sourceType/:id', requireAuth, (req, res) => {
    const { sourceType, id } = req.params;
    const { name, path: newPath, isActive } = req.body;
    
    const settings = getSettings();
    const sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;
    const sourceIndex = sourceList.findIndex(s => s.id === id);

    if (sourceIndex === -1) {
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
    res.json({ success: true, message: 'Source updated.', settings });
});

app.delete('/api/sources/:sourceType/:id', requireAuth, (req, res) => {
    const { sourceType, id } = req.params;
    
    const settings = getSettings();
    let sourceList = sourceType === 'm3u' ? settings.m3uSources : settings.epgSources;
    const source = sourceList.find(s => s.id === id);
    
    if (source && source.type === 'file' && fs.existsSync(source.path)) {
        try {
            fs.unlinkSync(source.path);
        } catch (e) {
            console.error(`Could not delete source file: ${source.path}`, e);
        }
    }
    
    const newList = sourceList.filter(s => s.id !== id);
    if (sourceType === 'm3u') settings.m3uSources = newList;
    else settings.epgSources = newList;

    saveSettings(settings);
    res.json({ success: true, message: 'Source deleted.', settings });
});

app.post('/api/process-sources', requireAuth, async (req, res) => {
    try {
        const result = await processAndMergeSources();
        res.json(result);
    }
    catch (error) {
        console.error("Error during manual source processing:", error);
        res.status(500).json({ error: 'Failed to process sources.' });
    }
});


app.post('/api/save/settings', requireAuth, async (req, res) => {
    try {
        let currentSettings = getSettings();
        
        const oldTimezone = currentSettings.timezoneOffset;
        const oldRefresh = currentSettings.autoRefresh;

        const updatedSettings = { ...currentSettings, ...req.body };

        const userSpecificKeys = ['favorites', 'playerDimensions', 'programDetailsDimensions', 'recentChannels', 'notificationLeadTime'];
        userSpecificKeys.forEach(key => delete updatedSettings[key]);

        saveSettings(updatedSettings);
        
        if (updatedSettings.timezoneOffset !== oldTimezone) {
            console.log("Timezone changed, re-processing sources.");
            await processAndMergeSources();
        }
        if (updatedSettings.autoRefresh !== oldRefresh) {
            console.log("Auto-refresh setting changed, rescheduling.");
            scheduleEpgRefresh();
        }

        res.json({ success: true, message: 'Settings saved.', settings: updatedSettings });
    } catch (error) {
        console.error("Error saving settings:", error);
        res.status(500).json({ error: "Could not save settings." });
    }
});

app.post('/api/user/settings', requireAuth, (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'A setting key is required.' });
    
    const valueJson = JSON.stringify(value);
    const userId = req.session.userId;

    db.run(
        `UPDATE user_settings SET value = ? WHERE user_id = ? AND key = ?`,
        [valueJson, userId, key],
        function (err) {
            if (err) {
                console.error('Error updating user setting:', err);
                return res.status(500).json({ error: 'Could not save user setting.' });
            }
            
            if (this.changes === 0) {
                db.run(
                    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`,
                    [userId, key, valueJson],
                    (insertErr) => {
                        if (insertErr) {
                            console.error('Error inserting user setting:', insertErr);
                            return res.status(500).json({ error: 'Could not save user setting.' });
                        }
                        res.json({ success: true });
                    }
                );
            } else {
                res.json({ success: true });
            }
        }
    );
});

// --- Notification Endpoints ---

app.get('/api/notifications/vapid-public-key', requireAuth, (req, res) => {
    if (!vapidKeys.publicKey) {
        return res.status(500).json({ error: 'VAPID public key not available on the server.' });
    }
    res.send(vapidKeys.publicKey);
});

app.post('/api/notifications/subscribe', requireAuth, (req, res) => {
    const subscription = req.body;
    const userId = req.session.userId;

    if (!subscription || !subscription.endpoint) {
        return res.status(400).json({ error: 'Invalid subscription object.' });
    }

    const { endpoint, keys: { p256dh, auth } } = subscription;

    db.run(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id`,
        [userId, endpoint, p256dh, auth],
        function(err) {
            if (err) {
                console.error('Error saving push subscription:', err);
                return res.status(500).json({ error: 'Could not save subscription.' });
            }
            console.log(`[Push] User ${userId} subscribed with endpoint: ${endpoint}`);
            res.status(201).json({ success: true });
        }
    );
});

app.post('/api/notifications/unsubscribe', requireAuth, (req, res) => {
    const { endpoint } = req.body;
    if (!endpoint) {
        return res.status(400).json({ error: 'Endpoint is required to unsubscribe.' });
    }

    db.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", [endpoint, req.session.userId], (err) => {
        if (err) {
            console.error('Error deleting push subscription:', err);
            return res.status(500).json({ error: 'Could not unsubscribe.' });
        }
        console.log(`[Push] User ${req.session.userId} unsubscribed from endpoint: ${endpoint}`);
        res.json({ success: true });
    });
});

app.post('/api/notifications', requireAuth, (req, res) => {
    const { channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, scheduledTime, programId } = req.body;

    if (!channelId || !programTitle || !programStart || !scheduledTime || !programId) {
        return res.status(400).json({ error: 'Missing required notification fields.' });
    }

    // NEW: Use ON CONFLICT to update an existing notification if it's re-added.
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
                status='active'`, // Reset status to active if it's re-enabled
        [req.session.userId, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, scheduledTime, programId],
        function (err) {
            if (err) {
                console.error('Error adding notification to database:', err);
                return res.status(500).json({ error: 'Could not add notification.' });
            }
             // Fetch the inserted/updated record to get its ID to return to the client
            db.get(`SELECT id FROM notifications WHERE user_id = ? AND programId = ?`, [req.session.userId, programId], (err, row) => {
                 if (err || !row) {
                    console.error('Could not retrieve notification ID after insert/update:', err);
                    return res.status(500).json({ error: 'Could not retrieve notification ID after insert.' });
                 }
                 res.status(201).json({ success: true, id: row.id });
            });
        }
    );
});

app.get('/api/notifications', requireAuth, (req, res) => {
    // NEW: This endpoint now returns both active and past notifications
    const userId = req.session.userId;
    const pastLimit = 10;

    const responsePayload = {
        active: [],
        past: []
    };

    // Get active notifications
    db.all(`SELECT id, user_id, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, notificationTime as scheduledTime, programId, status
            FROM notifications 
            WHERE user_id = ? AND status = 'active'
            ORDER BY notificationTime ASC`,
        [userId],
        (err, activeRows) => {
            if (err) {
                console.error('Error fetching active notifications from database:', err);
                return res.status(500).json({ error: 'Could not retrieve notifications.' });
            }
            responsePayload.active = activeRows || [];

            // Get past (sent/expired) notifications
            db.all(`SELECT id, user_id, channelId, channelName, channelLogo, programTitle, programDesc, programStart, programStop, notificationTime as scheduledTime, programId, status, notifiedAt
                    FROM notifications
                    WHERE user_id = ? AND status != 'active'
                    ORDER BY notifiedAt DESC
                    LIMIT ?`,
                [userId, pastLimit],
                (err, pastRows) => {
                    if (err) {
                        console.error('Error fetching past notifications from database:', err);
                        return res.status(500).json({ error: 'Could not retrieve notifications.' });
                    }
                    responsePayload.past = pastRows || [];
                    res.json(responsePayload);
                }
            );
        }
    );
});

app.delete('/api/notifications/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM notifications WHERE id = ? AND user_id = ?`,
        [id, req.session.userId],
        function (err) {
            if (err) {
                console.error('Error deleting notification from database:', err);
                return res.status(500).json({ error: 'Could not delete notification.' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Notification not found or unauthorized.' });
            }
            res.json({ success: true });
        }
    );
});


app.delete('/api/data', requireAuth, (req, res) => {
    try {
        [MERGED_M3U_PATH, MERGED_EPG_JSON_PATH, SETTINGS_PATH].forEach(file => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        });
        if(fs.existsSync(SOURCES_DIR)) {
            fs.rmSync(SOURCES_DIR, { recursive: true, force: true });
            fs.mkdirSync(SOURCES_DIR, { recursive: true });
        }
        
        db.run(`DELETE FROM user_settings WHERE user_id = ?`, [req.session.userId]);
        db.run(`DELETE FROM notifications WHERE user_id = ?`, [req.session.userId]);
        db.run(`DELETE FROM push_subscriptions WHERE user_id = ?`, [req.session.userId]);

        res.json({ success: true, message: 'All data has been cleared.' });
    } catch (error) {
        console.error("Error clearing data:", error);
        res.status(500).json({ error: "Failed to clear data." });
    }
});

app.get('/stream', requireAuth, (req, res) => {
    const { url: streamUrl, profileId, userAgentId } = req.query;
    if (!streamUrl) return res.status(400).send('Error: `url` query parameter is required.');

    let settings = getSettings();
    
    const profile = (settings.streamProfiles || []).find(p => p.id === profileId);
    if (!profile) return res.status(404).send(`Error: Stream profile with ID "${profileId}" not found.`);

    if (profile.command === 'redirect') {
        return res.redirect(302, streamUrl);
    }
    
    const userAgent = (settings.userAgents || []).find(ua => ua.id === userAgentId);
    if (!userAgent) return res.status(404).send(`Error: User agent with ID "${userAgentId}" not found.`);
    
    console.log(`[STREAM] Proxying: ${streamUrl}`);
    console.log(`[STREAM] Profile: "${profile.name}"`);
    console.log(`[STREAM] User Agent: "${userAgent.name}"`);

    const commandTemplate = profile.command
        .replace(/{streamUrl}/g, streamUrl)
        .replace(/{userAgent}|{clientUserAgent}/g, userAgent.value);
        
    const args = (commandTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(arg => arg.replace(/^"|"$/g, ''));

    const ffmpeg = spawn('ffmpeg', args);
    res.setHeader('Content-Type', 'video/mp2t');
    ffmpeg.stdout.pipe(res);
    
    ffmpeg.stderr.on('data', (data) => {
        console.error(`[FFMPEG_ERROR] ${streamUrl}: ${data}`);
    });

    ffmpeg.on('close', (code) => {
        if (code !== 0) console.log(`[STREAM] ffmpeg process for ${streamUrl} exited with code ${code}`);
        res.end();
    });

    req.on('close', () => {
        console.log(`[STREAM] Client closed connection for ${streamUrl}. Killing ffmpeg.`);
        ffmpeg.kill('SIGKILL');
    });
});


async function checkAndSendNotifications() {
    try {
        const now = new Date();
        const dueNotifications = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM notifications WHERE notificationTime <= ? AND status = 'active'", [now.toISOString()], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (dueNotifications.length > 0) {
            console.log(`[Push] Found ${dueNotifications.length} due notifications to send.`);
        }

        for (const notification of dueNotifications) {
            const subscriptions = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM push_subscriptions WHERE user_id = ?", [notification.user_id], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });

            const payload = JSON.stringify({
                title: `Upcoming: ${notification.programTitle}`,
                body: `Starts at ${new Date(notification.programStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} on ${notification.channelName}`,
                icon: notification.channelLogo || 'https://i.imgur.com/rwa8SjI.png',
                data: {
                    // NEW: Pass programId and channelId in the data payload
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

                return webpush.sendNotification(pushSubscription, payload)
                    .then(() => {
                        notificationSentSuccessfully = true; // Mark as sent if at least one subscription succeeds
                        console.log(`[Push] Notification sent to endpoint: ${sub.endpoint}`);
                    })
                    .catch(error => {
                        if (error.statusCode === 410) {
                            console.log(`[Push] Subscription expired or invalid. Deleting endpoint: ${sub.endpoint}`);
                            db.run("DELETE FROM push_subscriptions WHERE endpoint = ?", [sub.endpoint]);
                        } else {
                            console.error(`[Push] Error sending notification to ${sub.endpoint}:`, error.statusCode, error.body);
                        }
                    });
            });

            await Promise.all(sendPromises);

            // NEW: Instead of deleting, update the status to 'sent' or 'expired'.
            // This preserves the notification for history and the guide's visual indicator.
            const newStatus = notificationSentSuccessfully ? 'sent' : 'expired';
            db.run("UPDATE notifications SET status = ?, notifiedAt = ? WHERE id = ?", [newStatus, new Date().toISOString(), notification.id], (err) => {
                if (err) console.error(`[Push] Error updating sent notification ${notification.id}:`, err);
                else console.log(`[Push] Marked notification ${notification.id} as ${newStatus}.`);
            });
        }
    } catch (error) {
        console.error('[Push] Error in checkAndSendNotifications:', error);
    }
}


// --- Main Route Handling ---
app.get('*', (req, res) => {
    const pathToFile = path.join(PUBLIC_DIR, req.path);
    if(fs.existsSync(pathToFile) && fs.lstatSync(pathToFile).isFile()){
        return res.sendFile(pathToFile);
    }
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// --- Server Start ---
app.listen(port, () => {
    console.log(`VINI PLAY server listening at http://localhost:${port}`);
    console.log(`Data is stored in the host directory mapped to ${DATA_DIR}`);
    console.log(`Serving frontend from: ${PUBLIC_DIR}`);

    scheduleEpgRefresh();

    if (notificationCheckInterval) clearInterval(notificationCheckInterval);
    notificationCheckInterval = setInterval(checkAndSendNotifications, 60000);
    console.log('[Push] Notification checker started. Will check for due notifications every minute.');
});

