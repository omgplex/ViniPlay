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
const DATA_DIR = path.join(__dirname, 'public', 'data');
const M3U_PATH = path.join(DATA_DIR, 'playlist.m3u');
const EPG_PATH = path.join(DATA_DIR, 'epg.xml');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// Ensure the data directory exists.
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- Middleware ---
app.use(express.static('public'));
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

        // --- NEW: Initialize Player Settings if they don't exist ---
        if (!config.settings.userAgents || config.settings.userAgents.length === 0) {
            config.settings.userAgents = [
                { id: `default-${Date.now()}`, name: 'ViniPlay Default', value: 'VLC/3.0.20 (Linux; x86_64)' }
            ];
            config.settings.activeUserAgentId = config.settings.userAgents[0].id;
        }
        if (!config.settings.streamProfiles || config.settings.streamProfiles.length === 0) {
            config.settings.streamProfiles = [
                { id: 'ffmpeg-default', name: 'ffmpeg', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c copy -f mpegts pipe:1', isDefault: true },
                { id: 'redirect-default', name: 'Redirect', command: 'redirect', isDefault: true }
            ];
            config.settings.activeStreamProfileId = 'ffmpeg-default';
        }

        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(config.settings, null, 2));
        
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
                return fetchUrlContent(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
            }
            let data = '';
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
        
        res.header('Content-Type', type === 'm3u' ? 'application/vnd.apple.mpegurl' : 'application/xml');
        res.send(content);
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
    // MODIFIED: Now replaces both {userAgent} and {clientUserAgent} placeholders.
    const commandTemplate = profile.command
        .replace(/{streamUrl}/g, streamUrl)
        .replace(/{userAgent}|{clientUserAgent}/g, userAgent.value);

    // Parse the command string into an array of arguments for spawn.
    // This regex handles quoted strings to allow for spaces in values.
    const args = (commandTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || [])
        .map(arg => arg.replace(/^"|"$/g, '')); // Remove quotes

    console.log(`Spawning ffmpeg with args: [${args.join(', ')}]`);

    const ffmpeg = spawn('ffmpeg', args);

    res.setHeader('Content-Type', 'video/mp2t');
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (data) => {
        console.error(`ffmpeg stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
        if (code !== 0) {
            console.log(`ffmpeg process for ${streamUrl} exited with code ${code}`);
        }
        res.end();
    });

    req.on('close', () => {
        console.log('Client closed connection. Stopping ffmpeg.');
        ffmpeg.kill('SIGKILL');
    });
});

app.listen(port, () => {
    console.log(`VINI PLAY server listening at http://localhost:${port}`);
});
