// Import necessary modules
const express = require('express');
const { spawn } = require('child_process');
const path = require('path');

// Initialize the Express app
const app = express();
const PORT = 8998;

// --- Serve the Frontend Player ---
// This serves your index.html and any other static files (like css, images)
// from a 'public' directory.
app.use(express.static(path.join(__dirname, 'public')));

// --- Create the FFMPEG Streaming Endpoint ---
app.get('/stream', (req, res) => {
    // Get the original stream URL from the query parameters.
    const streamUrl = req.query.url;

    if (!streamUrl) {
        return res.status(400).send('Stream URL is required');
    }

    console.log(`[FFMPEG] Starting stream for: ${streamUrl}`);

    // Set headers for a continuous video stream.
    res.setHeader('Content-Type', 'video/mp2t'); // MPEG-TS content type
    res.setHeader('Connection', 'keep-alive');

    // --- FFMPEG Command Explained ---
    // -i "${streamUrl}" : The input stream URL.
    // -c:v copy         : Copies the video codec without re-encoding. This is fast and saves CPU.
    // -c:a aac          : Transcodes the audio to AAC, which is universally supported in browsers.
    // -f mpegts         : Specifies the output format as MPEG Transport Stream, which mpegts.js handles.
    // -preset veryfast  : A good balance for speed and quality if re-encoding is needed.
    // -tune zerolatency : Optimizes for live streaming with minimal delay.
    // pipe:1            : Pipes the output to stdout so we can capture it in Node.js.
    const ffmpeg = spawn('ffmpeg', [
        '-i', streamUrl,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'mpegts',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        'pipe:1'
    ]);

    // Pipe the video data from ffmpeg's stdout directly to the client's response.
    ffmpeg.stdout.pipe(res);

    // --- Error and Process Handling ---
    ffmpeg.stderr.on('data', (data) => {
        // Log ffmpeg's progress and errors for debugging.
        console.error(`[FFMPEG STDERR]: ${data.toString()}`);
    });

    ffmpeg.on('error', (err) => {
        console.error(`[FFMPEG ERROR]: Failed to start process for ${streamUrl}`, err);
    });

    ffmpeg.on('close', (code) => {
        if (code !== 0) {
            console.log(`[FFMPEG] Process for ${streamUrl} exited with code ${code}`);
        } else {
            console.log(`[FFMPEG] Stream for ${streamUrl} finished.`);
        }
        res.end(); // End the response when ffmpeg closes.
    });

    // When the client closes the connection, kill the ffmpeg process.
    req.on('close', () => {
        console.log(`[CLIENT] Connection closed for ${streamUrl}. Killing FFMPEG process.`);
        ffmpeg.kill();
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`ARDO IPTV Player server running on http://localhost:${PORT}`);
});
