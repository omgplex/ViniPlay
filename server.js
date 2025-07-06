// A simple Node.js server for the ARDO IPTV Player.
// It serves the static front-end files and provides a backend endpoint
// to proxy and transcode IPTV streams using ffmpeg.

const express = require('express');
const { spawn } = require('child_process');
const http = require('http'); // Required to fetch URLs
const https = require('https'); // Required to fetch HTTPS URLs

const app = express();
const port = 8998;

// Serve the static files (HTML, CSS, JS) from the 'public' directory.
app.use(express.static('public'));

/**
 * A generic helper function to fetch content from a URL.
 * It handles both HTTP and HTTPS protocols and follows redirects.
 * @param {string} url - The URL to fetch content from.
 * @returns {Promise<string>} - A promise that resolves with the text content of the URL.
 */
function fetchUrlContent(url) {
    return new Promise((resolve, reject) => {
        // Handle potential invalid URLs
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (error) {
            return reject(new Error(`Invalid URL: ${url}`));
        }

        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        protocol.get(url, { headers: { 'User-Agent': 'ViniPlay/1.0' } }, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrlContent(new URL(res.headers.location, url).href).then(resolve, reject);
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


/**
 * Endpoint to fetch M3U file content.
 */
app.get('/fetch-m3u', async (req, res) => {
    const m3uUrl = req.query.url;
    if (!m3uUrl) {
        return res.status(400).send('Error: URL query parameter is required.');
    }
    console.log(`Fetching M3U from: ${m3uUrl}`);
    try {
        const content = await fetchUrlContent(m3uUrl);
        res.header('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(content);
    } catch (error) {
        console.error(`Failed to fetch M3U URL: ${m3uUrl}`, error.message);
        res.status(500).send(`Failed to fetch M3U from URL. Check if the URL is correct. Error: ${error.message}`);
    }
});

/**
 * Endpoint to fetch EPG file content.
 */
app.get('/fetch-epg', async (req, res) => {
    const epgUrl = req.query.url;
    if (!epgUrl) {
        return res.status(400).send('Error: URL query parameter is required.');
    }
    console.log(`Fetching EPG from: ${epgUrl}`);
    try {
        const content = await fetchUrlContent(epgUrl);
        res.header('Content-Type', 'application/xml');
        res.send(content);
    } catch (error) {
        console.error(`Failed to fetch EPG URL: ${epgUrl}`, error.message);
        res.status(500).send(`Failed to fetch EPG from URL. Check if the URL is correct. Error: ${error.message}`);
    }
});

/**
 * Helper function to sanitize custom FFmpeg arguments for security.
 * It ensures that arguments are simple flags or key-value pairs.
 * @param {string} customArgs - The string of custom arguments from the user.
 * @returns {string[]} An array of sanitized arguments.
 */
function sanitizeCustomArgs(customArgs) {
    if (!customArgs || typeof customArgs !== 'string') {
        return [];
    }
    // A simple whitelist of allowed characters for flags and values.
    // This allows for: -flags, values (alphanumeric, :, /), but prevents shell operators like ;, |, &, etc.
    const allowedPattern = /^[a-zA-Z0-9-/:_.,]+$/;
    
    // Split by space, but handle quoted arguments (though we recommend not using them for simplicity)
    const parts = customArgs.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

    const sanitized = [];
    for (const part of parts) {
        const cleanedPart = part.replace(/"/g, ''); // remove quotes
        if (allowedPattern.test(cleanedPart)) {
            sanitized.push(cleanedPart);
        } else {
            // Log the unsafe argument for review, but don't add it to the command
            console.warn(`[SECURITY] Sanitizer blocked unsafe FFmpeg argument: ${cleanedPart}`);
        }
    }
    return sanitized;
}

/**
 * The main stream proxy endpoint, now with profiles.
 */
app.get('/stream', (req, res) => {
    const streamUrl = req.query.url;
    const profile = req.query.profile || 'transcode'; // Default to transcode
    const customArgs = req.query.args || '';

    if (!streamUrl) {
        return res.status(400).send('Error: `url` query parameter is required.');
    }

    console.log(`Starting stream from: ${streamUrl} with profile: ${profile}`);

    let ffmpegArgs = ['-i', streamUrl];

    switch (profile) {
        case 'proxy':
            // Proxy profile: Copy both video and audio without re-encoding. Most efficient.
            ffmpegArgs.push('-c', 'copy', '-f', 'mpegts');
            break;
        
        case 'custom':
            // Custom profile: Use user-provided arguments after sanitizing them.
            console.log(`Using custom FFmpeg args: ${customArgs}`);
            const sanitized = sanitizeCustomArgs(customArgs);
            ffmpegArgs.push(...sanitized);
            // Always ensure the output format is set for piping
            if (!sanitized.includes('-f')) {
                 ffmpegArgs.push('-f', 'mpegts');
            }
            break;
        
        case 'transcode':
        default:
            // Transcode profile (default): Copy video, transcode audio to AAC for compatibility.
            ffmpegArgs.push('-c:v', 'copy', '-c:a', 'aac', '-f', 'mpegts');
            break;
    }

    // The final argument is always 'pipe:1' to direct output to stdout.
    ffmpegArgs.push('pipe:1');
    
    console.log(`Executing ffmpeg with args: ${ffmpegArgs.join(' ')}`);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

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
    console.log(`ViniPlay server listening at http://localhost:${port}`);
});
