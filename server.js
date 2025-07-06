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
 * It handles both HTTP and HTTPS protocols and redirects.
 * @param {string} url - The URL to fetch content from.
 * @returns {Promise<string>} - A promise that resolves with the text content of the URL.
 */
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


/**
 * Endpoint to fetch M3U file content from a URL.
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
        res.status(500).send(`Failed to fetch M3U from URL. Error: ${error.message}`);
    }
});

/**
 * Endpoint to fetch EPG file content from a URL.
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
        res.status(500).send(`Failed to fetch EPG from URL. Error: ${error.message}`);
    }
});


/**
 * UPDATED: The main stream endpoint.
 * It now handles built-in profiles ('proxy', 'ffmpeg') and dynamic custom commands.
 */
app.get('/stream', (req, res) => {
    // Destructure query parameters with default values.
    const { 
        url: streamUrl, 
        profile = 'proxy', 
        userAgent = 'ARDO IPTV Player/1.0', 
        command: commandTemplate 
    } = req.query;

    if (!streamUrl) {
        return res.status(400).send('Error: `url` query parameter is required.');
    }

    console.log(`Stream request for: ${streamUrl} with profile: "${profile}"`);
    
    let ffmpegArgs = [];

    // If a custom command template is provided, use it.
    if (commandTemplate) {
        console.log(`Using custom command template: ${commandTemplate}`);
        // Replace placeholders for the stream URL and user agent.
        const processedCommand = commandTemplate
            .replace(/{streamUrl}/g, streamUrl)
            .replace(/{userAgent}/g, userAgent);
        
        // Split the command string into an array of arguments.
        // This regex handles arguments in quotes to prevent splitting them.
        ffmpegArgs = processedCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g).map(arg => arg.replace(/['"]/g, ''));
        console.log('Processed ffmpeg args:', ffmpegArgs);
    } else {
        // Otherwise, use the built-in, hardcoded profiles.
        switch (profile) {
            case 'ffmpeg':
                console.log(`Using built-in 'ffmpeg' profile with User Agent: ${userAgent}`);
                ffmpegArgs = [
                    '-user_agent', userAgent,
                    '-i', streamUrl,
                    '-c', 'copy',
                    '-f', 'mpegts',
                    'pipe:1'
                ];
                break;

            case 'proxy':
            default:
                console.log(`Using built-in 'proxy' profile with User Agent: ${userAgent}`);
                ffmpegArgs = [
                    '-user_agent', userAgent,
                    '-i', streamUrl,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-f', 'mpegts',
                    'pipe:1'
                ];
                break;
        }
    }

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    res.setHeader('Content-Type', 'video/mp2t');
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (data) => {
        console.error(`[ffmpeg stderr - profile: ${profile}]: ${data}`);
    });

    ffmpeg.on('close', (code) => {
        if (code !== 0) {
            console.log(`ffmpeg process exited with code ${code} for profile ${profile}`);
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
