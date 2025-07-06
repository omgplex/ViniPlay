// A Node.js server for the ARDO IPTV Player.
// It serves static files and provides a backend for stream proxying,
// file uploads, and settings persistence.

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
// Directory to store all user data, including M3U/EPG files and settings.
// It's inside the 'public' folder so the client can potentially access logos if needed,
// but mainly to keep all user-modifiable data in one place.
const DATA_DIR = path.join(__dirname, 'public', 'data');
const M3U_PATH = path.join(DATA_DIR, 'playlist.m3u');
const EPG_PATH = path.join(DATA_DIR, 'epg.xml');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

// Ensure the data directory exists.
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- Middleware ---
// Serve the static files (HTML, CSS, JS) from the 'public' directory.
app.use(express.static('public'));
// Use body-parser to handle JSON data in POST requests.
app.use(bodyParser.json());

// --- File Upload Setup (using multer) ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, DATA_DIR); // Save files to the data directory
    },
    filename: function (req, file, cb) {
        // Use fixed names for the files for easy retrieval.
        if (file.fieldname === 'm3u-file') {
            cb(null, 'playlist.m3u');
        } else if (file.fieldname === 'epg-file') {
            cb(null, 'epg.xml');
        } else {
            cb(null, file.originalname);
        }
    }
});
const upload = multer({ storage: storage });


// --- API Endpoints for Data Persistence ---

/**
 * GET /api/config
 * Reads all data (M3U, EPG, settings) from the file system
 * and sends it to the client upon initial load.
 */
app.get('/api/config', (req, res) => {
    const config = {};
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
        res.json(config);
    } catch (error) {
        console.error("Error reading config:", error);
        res.status(500).json({ error: "Could not load configuration from server." });
    }
});

/**
 * POST /api/upload
 * Handles file uploads for M3U and EPG files using multer.
 */
app.post('/api/upload', upload.fields([{ name: 'm3u-file', maxCount: 1 }, { name: 'epg-file', maxCount: 1 }]), (req, res) => {
    // The files are now saved by multer. We can save a setting to indicate
    // that the data source is a file.
    try {
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        }

        if (req.files['m3u-file']) {
            settings.m3uSourceType = 'file';
            delete settings.m3uUrl; // Remove URL if file is uploaded
        }
        if (req.files['epg-file']) {
            settings.epgSourceType = 'file';
            delete settings.epgUrl;
        }

        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        res.json({ success: true, message: "File(s) uploaded and saved." });

    } catch (error) {
        console.error("Error saving settings after file upload:", error);
        res.status(500).json({ error: "Could not save settings after upload." });
    }
});


/**
 * POST /api/save/settings
 * Saves general application settings (like URLs, favorites, etc.) to settings.json.
 */
app.post('/api/save/settings', (req, res) => {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(req.body, null, 2));
        res.json({ success: true, message: 'Settings saved.' });
    } catch (error) {
        console.error("Error saving settings:", error);
        res.status(500).json({ error: "Could not save settings." });
    }
});

/**
 * DELETE /api/data
 * Deletes all files in the data directory to reset the application state.
 */
app.delete('/api/data', (req, res) => {
    try {
        const files = [M3U_PATH, EPG_PATH, SETTINGS_PATH];
        files.forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
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
            if (res.statusCode < 200 || res.statusCode >= 300) {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return fetchUrlContent(res.headers.location).then(resolve, reject);
                }
                return reject(new Error(`Failed to fetch: Status Code ${res.statusCode}`));
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', (err) => reject(err));
    });
}

app.get('/fetch-m3u', async (req, res) => {
    const m3uUrl = req.query.url;
    if (!m3uUrl) {
        return res.status(400).send('Error: URL query parameter is required.');
    }
    console.log(`Fetching M3U from: ${m3uUrl}`);
    try {
        const content = await fetchUrlContent(m3uUrl);
        // Save the content to the server file system
        fs.writeFileSync(M3U_PATH, content);
        // Also save the URL and source type to settings
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        }
        settings.m3uSourceType = 'url';
        settings.m3uUrl = m3uUrl;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));

        res.header('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(content);
    } catch (error) {
        console.error(`Failed to fetch M3U URL: ${m3uUrl}`, error.message);
        res.status(500).send(`Failed to fetch M3U from URL. Check if the URL is correct. Error: ${error.message}`);
    }
});

app.get('/fetch-epg', async (req, res) => {
    const epgUrl = req.query.url;
    if (!epgUrl) {
        return res.status(400).send('Error: URL query parameter is required.');
    }
    console.log(`Fetching EPG from: ${epgUrl}`);
    try {
        const content = await fetchUrlContent(epgUrl);
        // Save the content to the server file system
        fs.writeFileSync(EPG_PATH, content);
        // Also save the URL and source type to settings
        let settings = {};
        if (fs.existsSync(SETTINGS_PATH)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        }
        settings.epgSourceType = 'url';
        settings.epgUrl = epgUrl;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));

        res.header('Content-Type', 'application/xml');
        res.send(content);
    } catch (error) {
        console.error(`Failed to fetch EPG URL: ${epgUrl}`, error.message);
        res.status(500).send(`Failed to fetch EPG from URL. Check if the URL is correct. Error: ${error.message}`);
    }
});

app.get('/stream', (req, res) => {
    const streamUrl = req.query.url;
    if (!streamUrl) {
        return res.status(400).send('Error: `url` query parameter is required.');
    }

    console.log(`Starting stream from: ${streamUrl}`);

    const ffmpeg = spawn('ffmpeg', [
        '-i', streamUrl,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'mpegts',
        'pipe:1'
    ]);

    res.setHeader('Content-Type', 'video/mp2t');
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (data) => {
        console.error(`ffmpeg stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
        if (code !== 0) {
            console.log(`ffmpeg process exited with code ${code}`);
        }
        res.end();
    });

    req.on('close', () => {
        console.log('Client closed connection. Stopping ffmpeg.');
        ffmpeg.kill();
    });
});

app.listen(port, () => {
    console.log(`ARDO IPTV Player server listening at http://localhost:${port}`);
});
