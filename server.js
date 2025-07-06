// A simple Node.js server for the ViniPlay IPTV Player.
// It serves the static front-end files and provides a backend endpoint
// to proxy and transcode IPTV streams using ffmpeg.

const express = require('express');
const { spawn } = require('child_process');
const http = require('http'); // Required to fetch URLs
const https = require('https'); // Required to fetch HTTPS URLs
const { URL } = require('url'); // To handle URL parsing and redirects robustly

const app = express();
const port = 8998;

// Serve the static files (HTML, CSS, JS) from the 'public' directory.
app.use(express.static('public'));

/**
 * A generic helper function to fetch content from a URL.
 * It handles both HTTP and HTTPS protocols and follows redirects.
 * @param {string} urlString - The URL to fetch content from.
 * @param {string} userAgent - The User-Agent string to use for the request.
 * @returns {Promise<string>} - A promise that resolves with the text content of the URL.
 */
function fetchUrlContent(urlString, userAgent = 'ViniPlay/1.0') {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(urlString);
        } catch (error) {
            return reject(new Error(`Invalid URL: ${urlString}`));
        }

        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const options = {
            headers: { 'User-Agent': userAgent }
        };

        protocol.get(urlString, options, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                // The location header can be a relative path, so we resolve it against the original URL.
                const redirectUrl = new URL(res.headers.location, urlString).href;
                console.log(`Redirecting to: ${redirectUrl}`);
                return fetchUrlContent(redirectUrl, userAgent).then(resolve, reject);
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
 * Endpoint to fetch M3U file content using a specific User-Agent.
 */
app.get('/fetch-m3u', async (req, res) => {
    const { url, userAgent } = req.query;
    if (!url) {
        return res.status(400).send('Error: URL query parameter is required.');
    }
    console.log(`Fetching M3U from: ${url} with User-Agent: ${userAgent || 'Default'}`);
    try {
        const content = await fetchUrlContent(url, userAgent);
        res.header('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(content);
    } catch (error) {
        console.error(`Failed to fetch M3U URL: ${url}`, error.message);
        res.status(500).send(`Failed to fetch M3U from URL. Error: ${error.message}`);
    }
});

/**
 * Endpoint to fetch EPG file content using a specific User-Agent.
 */
app.get('/fetch-epg', async (req, res) => {
    const { url, userAgent } = req.query;
    if (!url) {
        return res.status(400).send('Error: URL query parameter is required.');
    }
    console.log(`Fetching EPG from: ${url} with User-Agent: ${userAgent || 'Default'}`);
    try {
        const content = await fetchUrlContent(url, userAgent);
        res.header('Content-Type', 'application/xml');
        res.send(content);
    } catch (error) {
        console.error(`Failed to fetch EPG URL: ${url}`, error.message);
        res.status(500).send(`Failed to fetch EPG from URL. Error: ${error.message}`);
    }
});

/**
 * Helper function to sanitize custom FFmpeg arguments for security.
 */
function sanitizeCustomArgs(customArgs) {
    if (!customArgs || typeof customArgs !== 'string') return [];
    const allowedPattern = /^[a-zA-Z0-9-/:_.,]+$/;
    const parts = customArgs.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const sanitized = [];
    for (const part of parts) {
        const cleanedPart = part.replace(/"/g, '');
        if (allowedPattern.test(cleanedPart)) {
            sanitized.push(cleanedPart);
        } else {
            console.warn(`[SECURITY] Sanitizer blocked unsafe FFmpeg argument: ${cleanedPart}`);
        }
    }
    return sanitized;
}

/**
 * The main stream proxy endpoint, now with profiles and User-Agent support.
 */
app.get('/stream', (req, res) => {
    const { url: streamUrl, profile = 'transcode', args: customArgs = '', userAgent } = req.query;

    if (!streamUrl) {
        return res.status(400).send('Error: `url` query parameter is required.');
    }

    console.log(`Starting stream: ${streamUrl} | Profile: ${profile} | User-Agent: ${userAgent || 'Default'}`);

    let ffmpegArgs = [];
    
    // Add User-Agent if provided
    if (userAgent) {
        ffmpegArgs.push('-user_agent', userAgent);
    }

    // Add input URL
    ffmpegArgs.push('-i', streamUrl);

    switch (profile) {
        case 'proxy':
            ffmpegArgs.push('-c', 'copy', '-f', 'mpegts');
            break;
        case 'custom':
            console.log(`Using custom FFmpeg args: ${customArgs}`);
            const sanitized = sanitizeCustomArgs(customArgs);
            ffmpegArgs.push(...sanitized);
            if (!sanitized.includes('-f')) {
                 ffmpegArgs.push('-f', 'mpegts');
            }
            break;
        case 'transcode':
        default:
            ffmpegArgs.push('-c:v', 'copy', '-c:a', 'aac', '-f', 'mpegts');
            break;
    }

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
