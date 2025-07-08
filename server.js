// A Node.js server for the VINI PLAY IPTV Player.
// It serves static files and provides a backend for stream proxying,
// file uploads, and settings persistence, now with User Agent and Stream Profile management.

const express = require('express');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const multer = require('multer'); // For handling file uploads
const bodyParser = require('body-parser'); // To parse JSON request bodies

const app = express();
const port = 8998;

// --- Configuration ---
// MODIFIED: Point to the /data directory, which will be a mounted volume.
// This is the single most important change for data persistence.
const DATA_DIR = '/data';
const M3U_PATH = path.join(DATA_DIR, 'playlist.m3u');
const EPG_PATH = path.join(DATA_DIR, 'epg.xml');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// Ensure the data directory exists.
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- Middleware ---
// Serve the 'public' directory which contains index.html.
// NOTE: Your original code served from the root. It's better practice to
// keep frontend files in a dedicated directory like 'public'. I've created
// this for you in the project structure.
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// --- File Upload Setup (using multer) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, DATA_DIR);
    },
    filename: (req, file, cb) => {
        if (file.fieldname === 'm3u-file') cb(null, 'playlist.m3u');
        else if (file.fieldname === 'epg-file') cb(null, 'epg.xml');
        else cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });


// --- API Endpoints for Data Persistence ---

app.get('/api/config', (req, res) => {
    const config = {
        m3uContent: null,
        epgContent: null,
        settings: {}
    };
    try {
        if (fs.existsSync(M3U_PATH)) {
            config.m3uContent = fs.readFileSync(M3U_PATH, 'utf-8');
        }
        if (fs.existsSync(EPG_PATH)) {
            config.epgContent = fs.readFileSync(EPG_PATH, 'utf-8');
        }
        if (fs.existsSync(SETTINGS_PATH)) {
            config.settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        }

        // --- Initialize Player Settings if they don't exist ---
        let settingsChanged = false;
        if (!config.settings.userAgents || config.settings.userAgents.length === 0) {
            config.settings.userAgents = [
                { id: `default-ua-${Date.now()}`, name: 'ViniPlay Default', value: 'VLC/3.0.20 (Linux; x86_64)' }
            ];
            config.settings.activeUserAgentId = config.settings.userAgents[0].id;
            settingsChanged = true;
        }
        // MODIFIED: Rename default stream profiles
        if (!config.settings.streamProfiles || config.settings.streamProfiles.length === 0) {
            // UPDATED: Added flags to the default ffmpeg command for better stream stability.
            config.settings.streamProfiles = [
                { id: 'ffmpeg-default', name: 'ffmpeg (Built in - Robust)', command: '-user_agent "{userAgent}" -re -i "{streamUrl}" -c copy -fflags +genpts -f mpegts pipe:1', isDefault: true },
                { id: 'redirect-default', name: 'Redirect (Built in)', command: 'redirect', isDefault: true }
            ];
            config.settings.activeStreamProfileId = 'ffmpeg-default';
            settingsChanged = true;
        }
        // NEW: Initialize search scope setting
        if (typeof config.settings.searchScope === 'undefined') {
            config.settings.searchScope = 'channels_programs'; // Default value
            settingsChanged = true;
        }


        // Save settings back if we initialized them
        if (settingsChanged) {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config.settings, null, 2));
        }

        res.json(config);
    } catch (error) {
        console.error("Error reading config:", error);
        res.status(500).json({ error: "Could not load configuration from server." });
    }
});

app.post('/api/upload', upload.fields([{ name: 'm3u-file', maxCount: 1 }, { name: 'epg-file', maxCount: 1 }]), (req, res) => {
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
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

app.post('/api/save/settings', (req, res) => {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(req.body, null, 2));
        res.json({ success: true, message: 'Settings saved.' });
    } catch (error) {
        console.error("Error saving settings:", error);
        res.status(500).json({ error: "Could not save settings." });
    }
});


app.post('/api/save/url', (req, res) => {
    const { type, url } = req.body; // type will be 'm3u' or 'epg'
    if (!type || !url) {
        return res.status(400).json({ error: 'Type and URL are required.' });
    }
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        }
        const urlListName = `${type}CustomUrls`; // e.g., 'm3uCustomUrls'
        if (!settings[urlListName]) {
            settings[urlListName] = [];
        }
        if (!settings[urlListName].includes(url)) {
            settings[urlListName].push(url);
        }
        // Also set this as the active URL
        settings[`${type}Url`] = url;

        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        res.json({ success: true, message: 'URL saved.', settings });
    } catch (error) {
        console.error('Error saving custom URL:', error);
        res.status(500).json({ error: 'Failed to save URL.' });
    }
});


app.delete('/api/data', (req, res) => {
    try {
        [M3U_PATH, EPG_PATH, SETTINGS_PATH].forEach(file => {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        });
        res.json({ success: true, message: 'All data has been cleared.' });
    } catch (error) {
        console.error("Error clearing data:", error);
        res.status(500).json({ error: "Failed to clear data." });
    }
});


// --- Passthrough/Proxy Endpoints ---

function fetchUrlContent(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // Handle redirects
                const redirectUrl = new URL(res.headers.location, url).href;
                return fetchUrlContent(redirectUrl).then(resolve, reject);
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
            }
            let data = '';
            // Set encoding to handle all character sets
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', (err) => reject(err));
    });
}

const createFetchEndpoint = (type, filePath) => async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).send('Error: URL query parameter is required.');
    }

    try {
        const content = await fetchUrlContent(url);
        fs.writeFileSync(filePath, content);

        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        }
        settings[`${type}SourceType`] = 'url';
        settings[`${type}Url`] = url;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));

        // This endpoint is just for fetching and saving, client will get it via /api/config
        res.json({ success: true, message: `${type.toUpperCase()} fetched and saved.` });
    } catch (error) {
        console.error(`Error fetching ${type.toUpperCase()} URL:`, error);
        res.status(500).send(`Failed to fetch from URL. Error: ${error.message}`);
    }
};

app.get('/fetch-m3u', createFetchEndpoint('m3u', M3U_PATH));
app.get('/fetch-epg', createFetchEndpoint('epg', EPG_PATH));


app.get('/stream', (req, res) => {
    const { url: streamUrl, profileId, userAgentId } = req.query;

    if (!streamUrl) {
        return res.status(400).send('Error: `url` query parameter is required.');
    }

    let settings = {};
    if (fs.existsSync(SETTINGS_PATH)) {
        try {
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        } catch (e) {
            console.error("Error reading settings.json for /stream:", e);
            return res.status(500).send('Error reading server settings.');
        }
    }

    const activeProfileId = profileId || settings.activeStreamProfileId || 'ffmpeg-default';
    const activeUserAgentId = userAgentId || settings.activeUserAgentId;

    const profile = (settings.streamProfiles || []).find(p => p.id === activeProfileId);
    const userAgent = (settings.userAgents || []).find(ua => ua.id === activeUserAgentId);

    if (!profile) {
        console.error(`Stream profile with ID "${activeProfileId}" not found.`);
        return res.status(404).send('Error: Stream profile not found.');
    }

    // The "Redirect" profile directly sends the client to the stream URL.
    if (profile.command === 'redirect') {
        console.log(`Redirecting to: ${streamUrl}`);
        return res.redirect(302, streamUrl);
    }

    if (!userAgent) {
        console.error(`User agent with ID "${activeUserAgentId}" not found.`);
        return res.status(404).send('Error: User agent not found.');
    }

    console.log(`Proxying stream for: ${streamUrl}`);
    console.log(`> Profile: "${profile.name}"`);
    console.log(`> User Agent: "${userAgent.name}"`);

    // Replace placeholders in the command template.
    const commandTemplate = profile.command
        .replace(/{streamUrl}/g, streamUrl)
        .replace(/{userAgent}|{clientUserAgent}/g, userAgent.value);

    // Parse the command string into an array of arguments for spawn.
    // This regex handles quoted strings to allow for spaces in values.
    const args = (commandTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || [])
        .map(arg => arg.replace(/^"|"$/g, '')); // Remove quotes

    console.log(`Spawning ffmpeg with args: [${args.join(', ')}]`);

    const ffmpeg = spawn('ffmpeg', args, {
        // UPDATED: Added detached option and stdio config for better process handling
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'] // stdin, stdout, stderr
    });
    
    res.setHeader('Content-Type', 'video/mp2t');
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (data) => {
        // Log ffmpeg's progress/errors. It's often very verbose.
        // You can enable this for deep debugging if needed.
        // console.error(`ffmpeg stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
        if (code !== 0) {
            console.log(`ffmpeg process for ${streamUrl} exited with code ${code}`);
        }
        res.end();
    });
    
    // Ensure the ffmpeg process is killed when the client disconnects.
    req.on('close', () => {
        console.log('Client closed connection. Killing ffmpeg process.');
        // Use a negative PID to kill the entire process group
        process.kill(-ffmpeg.pid, 'SIGKILL');
    });
});

// Route Handling: Serve index.html for client-side routing.
app.get(['/', '/tvguide', '/settings'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.listen(port, () => {
    console.log(`VINI PLAY server listening at http://localhost:${port}`);
    console.log(`Data will be stored in the host directory mapped to ${DATA_DIR} in the container.`);
});
