// A Node.js server for the VINI PLAY IPTV Player.
// It serves static files and provides a backend for stream proxying,
// file uploads, and settings persistence, now with User Authentication and per-user settings.

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

const app = express();
const port = 8998;
const saltRounds = 10;

// --- Configuration ---
const DATA_DIR = '/data';
const DB_PATH = path.join(DATA_DIR, 'viniplay.db');
const M3U_PATH = path.join(DATA_DIR, 'playlist.m3u');
const EPG_PATH = path.join(DATA_DIR, 'epg.xml');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// Ensure the data directory exists.
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- Database Setup ---
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error("Error opening database:", err.message);
    } else {
        console.log("Connected to the SQLite database.");
        // FIX: Use db.serialize to ensure table creation queries run in sequence.
        db.serialize(() => {
            // Create users table if it doesn't exist
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                isAdmin INTEGER DEFAULT 0
            )`);
            // Create user_settings table for persistent user-specific settings
            db.run(`CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER NOT NULL,
                key TEXT NOT NULL,
                value TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, key)
            )`);
        });
    }
});

// --- Middleware ---
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Session Middleware
app.use(
  session({
    store: new SQLiteStore({
        db: 'viniplay.db',
        dir: DATA_DIR,
        table: 'sessions'
    }),
    secret: 'a_very_secret_key_change_me', // TODO: Change this to a secure, random string
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: false // Set to true if you're using HTTPS
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


// --- Authentication API Endpoints ---
app.get('/api/auth/needs-setup', (req, res) => {
    db.get("SELECT COUNT(*) as count FROM users WHERE isAdmin = 1", [], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
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
            const sql = "INSERT INTO users (username, password, isAdmin) VALUES (?, ?, 1)";
            db.run(sql, [username, hash], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                req.session.userId = this.lastID;
                req.session.username = username;
                req.session.isAdmin = true;
                res.json({ success: true, message: 'Admin user created successfully.' });
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
                    message: "Logged in successfully.",
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
        res.json({ success: true, message: 'Logged out successfully.' });
    });
});

app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({
            isLoggedIn: true,
            user: { username: req.session.username, isAdmin: req.session.isAdmin }
        });
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
        const sql = "INSERT INTO users (username, password, isAdmin) VALUES (?, ?, ?)";
        db.run(sql, [username, hash, isAdmin ? 1 : 0], function (err) {
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
                    res.json({ success: true });
                });
            });
        } else {
            db.run("UPDATE users SET username = ?, isAdmin = ? WHERE id = ?", [username, isAdmin ? 1 : 0, id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
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
        let globalSettings = {};

        if (fs.existsSync(SETTINGS_PATH)) {
            try {
                globalSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            } catch (e) {
                console.error("Could not parse settings.json:", e);
                // Continue with empty settings if file is corrupt
            }
        }
        config.settings = globalSettings;

        if (fs.existsSync(M3U_PATH)) config.m3uContent = fs.readFileSync(M3U_PATH, 'utf-8');
        if (fs.existsSync(EPG_PATH)) config.epgContent = fs.readFileSync(EPG_PATH, 'utf-8');
        
        // Initialize default global settings if they don't exist
        let settingsChanged = false;
        if (!config.settings.userAgents || config.settings.userAgents.length === 0) {
            config.settings.userAgents = [{ id: `default-ua-${Date.now()}`, name: 'ViniPlay Default', value: 'VLC/3.0.20 (Linux; x86_64)', isDefault: true }];
            config.settings.activeUserAgentId = config.settings.userAgents[0].id;
            settingsChanged = true;
        }
        if (!config.settings.streamProfiles || config.settings.streamProfiles.length === 0) {
            config.settings.streamProfiles = [
                { id: 'ffmpeg-default', name: 'ffmpeg (Built in)', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c copy -f mpegts pipe:1', isDefault: true },
                { id: 'redirect-default', name: 'Redirect (Built in)', command: 'redirect', isDefault: true }
            ];
            config.settings.activeStreamProfileId = 'ffmpeg-default';
            settingsChanged = true;
        }
        if (typeof config.settings.searchScope === 'undefined') {
            config.settings.searchScope = 'channels_programs';
            settingsChanged = true;
        }
        if (settingsChanged) {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config.settings, null, 2));
        }
        
        // Load user-specific settings from the database and merge them
        db.all(`SELECT key, value FROM user_settings WHERE user_id = ?`, [req.session.userId], (err, rows) => {
            if (err) {
                console.error("Error fetching user settings:", err);
                return res.json(config); // Proceed with just the global settings
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
        destination: (req, file, cb) => cb(null, DATA_DIR),
        filename: (req, file, cb) => {
            if (file.fieldname === 'm3u-file') cb(null, 'playlist.m3u');
            else if (file.fieldname === 'epg-file') cb(null, 'epg.xml');
            else cb(null, file.originalname);
        }
    })
});

app.post('/api/upload', requireAuth, upload.fields([{ name: 'm3u-file', maxCount: 1 }, { name: 'epg-file', maxCount: 1 }]), (req, res) => {
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
             try {
                settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
             } catch (e) { console.error("Could not parse settings.json during upload:", e); }
        }
        if (req.files['m3u-file']) {
            settings.m3uSourceType = 'file';
            delete settings.m3uUrl;
        }
        if (req.files['epg-file']) {
            settings.epgSourceType = 'file';
            delete settings.epgUrl;
        }
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        res.json({ success: true, message: "File(s) uploaded successfully." });
    } catch (error) {
        console.error("Error saving settings after file upload:", error);
        res.status(500).json({ error: "Could not save settings after upload." });
    }
});

// FIX: This endpoint now also returns the updated settings object to the client.
app.post('/api/save/settings', requireAuth, (req, res) => {
    try {
        let currentSettings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            try {
                currentSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            } catch (e) {
                 console.error("Could not parse settings.json, will overwrite.", e);
            }
        }
        const updatedSettings = { ...currentSettings, ...req.body };

        const userSpecificKeys = ['favorites', 'playerDimensions', 'programDetailsDimensions', 'recentChannels'];
        userSpecificKeys.forEach(key => delete updatedSettings[key]);

        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updatedSettings, null, 2));
        res.json({ success: true, message: 'Settings saved.', settings: updatedSettings });
    } catch (error) {
        console.error("Error saving settings:", error);
        res.status(500).json({ error: "Could not save settings." });
    }
});

// Endpoint to save user-specific settings to the database
app.post('/api/user/settings', requireAuth, (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'A setting key is required.' });
    
    const valueJson = JSON.stringify(value);
    
    const sql = `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value;`;
                 
    db.run(sql, [req.session.userId, key, valueJson], (err) => {
        if (err) {
            console.error('Error saving user setting to database:', err);
            return res.status(500).json({ error: 'Could not save user setting.' });
        }
        res.json({ success: true });
    });
});


app.post('/api/save/url', requireAuth, (req, res) => {
    const { type, url } = req.body;
    if (!type || !url) return res.status(400).json({ error: 'Type and URL are required.' });
    
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
             try {
                settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
             } catch(e) { console.error("Could not parse settings.json, will overwrite.", e); }
        }
        const urlListName = `${type}CustomUrls`;
        if (!settings[urlListName]) {
            settings[urlListName] = [];
        }
        if (!settings[urlListName].includes(url)) {
            settings[urlListName].push(url);
        }
        settings[`${type}Url`] = url;

        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        res.json({ success: true, message: 'URL saved.', settings });
    } catch (error) {
        console.error('Error saving custom URL:', error);
        res.status(500).json({ error: 'Failed to save URL.' });
    }
});


app.delete('/api/data', requireAuth, (req, res) => {
    try {
        [M3U_PATH, EPG_PATH, SETTINGS_PATH].forEach(file => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        });
        db.run(`DELETE FROM user_settings WHERE user_id = ?`, [req.session.userId], (err) => {
            if (err) console.error("Error clearing user settings from DB:", err);
        });
        res.json({ success: true, message: 'All data has been cleared.' });
    } catch (error) {
        console.error("Error clearing data:", error);
        res.status(500).json({ error: "Failed to clear data." });
    }
});

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

const createFetchEndpoint = (type, filePath) => async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('Error: URL query parameter is required.');
    
    try {
        const content = await fetchUrlContent(url);
        fs.writeFileSync(filePath, content);
        
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            try {
                settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            } catch(e) { console.error("Could not parse settings.json", e); }
        }
        settings[`${type}SourceType`] = 'url';
        settings[`${type}Url`] = url;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        
        res.json({ success: true, message: `${type.toUpperCase()} fetched and saved.` });
    } catch (error) {
        console.error(`Error fetching ${type.toUpperCase()} URL:`, error);
        res.status(500).send(`Failed to fetch from URL. Error: ${error.message}`);
    }
};

app.get('/fetch-m3u', requireAuth, createFetchEndpoint('m3u', M3U_PATH));
app.get('/fetch-epg', requireAuth, createFetchEndpoint('epg', EPG_PATH));

app.get('/stream', requireAuth, (req, res) => {
    const { url: streamUrl, profileId, userAgentId } = req.query;

    if (!streamUrl) return res.status(400).send('Error: `url` query parameter is required.');

    let settings = {};
    if (fs.existsSync(SETTINGS_PATH)) {
        try {
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        } catch (e) {
            console.error("Error reading settings.json for /stream:", e);
            return res.status(500).send('Error reading server settings.');
        }
    }
    
    const activeProfileId = profileId || settings.activeStreamProfileId;
    const activeUserAgentId = userAgentId || settings.activeUserAgentId;
    
    const profile = (settings.streamProfiles || []).find(p => p.id === activeProfileId);
    if (!profile) return res.status(404).send(`Error: Stream profile with ID "${activeProfileId}" not found.`);

    if (profile.command === 'redirect') {
        console.log(`Redirecting to: ${streamUrl}`);
        return res.redirect(302, streamUrl);
    }
    
    const userAgent = (settings.userAgents || []).find(ua => ua.id === activeUserAgentId);
    if (!userAgent) return res.status(404).send(`Error: User agent with ID "${activeUserAgentId}" not found.`);
    
    console.log(`Proxying stream for: ${streamUrl} | Profile: "${profile.name}" | User Agent: "${userAgent.name}"`);

    const commandTemplate = profile.command
        .replace(/{streamUrl}/g, streamUrl)
        .replace(/{userAgent}|{clientUserAgent}/g, userAgent.value);
        
    const args = (commandTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(arg => arg.replace(/^"|"$/g, ''));

    const ffmpeg = spawn('ffmpeg', args);
    res.setHeader('Content-Type', 'video/mp2t');
    ffmpeg.stdout.pipe(res);
    ffmpeg.stderr.on('data', (data) => {});
    ffmpeg.on('close', (code) => {
        if (code !== 0) console.log(`ffmpeg process for ${streamUrl} exited with code ${code}`);
        res.end();
    });
    req.on('close', () => {
        ffmpeg.kill('SIGKILL');
    });
});

// --- Main Route Handling ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.listen(port, () => {
    console.log(`VINI PLAY server listening at http://localhost:${port}`);
    console.log(`Data will be stored in the host directory mapped to ${DATA_DIR} in the container.`);
});
