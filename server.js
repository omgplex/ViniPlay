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
// This is where your index.html and other assets will live.
app.use(express.static('public'));

/**
 * NEW: A generic helper function to fetch content from a URL.
 * It handles both HTTP and HTTPS protocols.
 * @param {string} url - The URL to fetch content from.
 * @returns {Promise<string>} - A promise that resolves with the text content of the URL.
 */
function fetchUrlContent(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                // Follow redirects if necessary
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


/**
 * NEW: Endpoint to fetch M3U file content.
 * It takes a URL from a query parameter, fetches it on the server-side
 * (avoiding browser CORS issues), and pipes the content back to the client.
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
 * NEW: Endpoint to fetch EPG file content.
 * Works just like the M3U endpoint but for XMLTV files.
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
 * The main stream proxy endpoint.
 * It takes a channel's stream URL, uses ffmpeg to process it,
 * and pipes the output directly to the client's video player.
 */
app.get('/stream', (req, res) => {
    const streamUrl = req.query.url;
    if (!streamUrl) {
        return res.status(400).send('Error: `url` query parameter is required.');
    }

    console.log(`Starting stream from: ${streamUrl}`);

    // These are common ffmpeg arguments for transcoding live streams to a web-friendly format.
    // -i: input URL
    // -c:v copy: Tries to copy the video codec without re-encoding to save CPU.
    // -c:a aac: Re-encodes audio to AAC, which is universally supported.
    // -f mpegts: The output format is MPEG-TS, which is suitable for streaming.
    // pipe:1: Tells ffmpeg to send the output to stdout.
    const ffmpeg = spawn('ffmpeg', [
        '-i', streamUrl,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'mpegts',
        'pipe:1'
    ]);

    // Set the proper content type for the video stream.
    res.setHeader('Content-Type', 'video/mp2t');

    // Pipe the video data from ffmpeg's output directly to the client's response.
    // This sends the video data as it's being transcoded.
    ffmpeg.stdout.pipe(res);

    // Log any errors from ffmpeg to the console for debugging.
    ffmpeg.stderr.on('data', (data) => {
        console.error(`ffmpeg stderr: ${data}`);
    });

    // Handle the end of the stream.
    ffmpeg.on('close', (code) => {
        if (code !== 0) {
            console.log(`ffmpeg process exited with code ${code}`);
        }
        res.end();
    });

    // If the client closes the connection, stop the ffmpeg process.
    req.on('close', () => {
        console.log('Client closed connection. Stopping ffmpeg.');
        ffmpeg.kill();
    });
});

app.listen(port, () => {
    console.log(`ARDO IPTV Player server listening at http://localhost:${port}`);
});
