<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- This head section is for local preview and not required for GitHub README -->
    <style>
        /* Basic styling for local preview */
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
            line-height: 1.6;
            color: #24292e;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        .container {
            border: 1px solid #e1e4e8;
            border-radius: 6px;
            padding: 24px;
        }
        h1, h2 {
            border-bottom: 1px solid #eaecef;
            padding-bottom: .3em;
        }
        code {
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
            background-color: rgba(27,31,35,.05);
            padding: .2em .4em;
            margin: 0;
            font-size: 85%;
            border-radius: 3px;
        }
        pre {
            background-color: #f6f8fa;
            border-radius: 3px;
            font-size: 85%;
            line-height: 1.45;
            overflow: auto;
            padding: 16px;
        }
        pre code {
            background-color: transparent;
            border: 0;
            padding: 0;
            margin: 0;
        }
        .highlight {
            color: #cb2431;
            font-weight: bold;
        }
        .note {
            background-color: #fffbdd;
            padding: 15px;
            border-left: 4px solid #ffea7f;
            border-radius: 4px;
            margin: 1em 0;
        }
    </style>
</head>
<body>
    <!-- Start of README Content -->
    <div align="center">
        <!-- Main Title -->
        <h1>ARDO IPTV Player</h1>
        
        <!-- Project Description -->
        <p>
            A simple, self-hosted IPTV player with a clean web interface and powerful backend transcoding using FFMPEG.
        </p>
        
        <!-- Optional: Badges/Shields -->
        <!-- Replace '#' with your actual links -->
        <p>
            <img src="https://img.shields.io/badge/docker-ready-blue.svg?style=for-the-badge&logo=docker" alt="Docker Ready">
            <img src="https://img.shields.io/badge/platform-node-green.svg?style=for-the-badge&logo=node.js" alt="Node.js Backend">
            <img src="https://img.shields.io/github/license/YOUR_GITHUB_USERNAME/ardo-iptv-player?style=for-the-badge" alt="License">
        </p>
    </div>

    <br>

    <!-- Project Introduction -->
    <p>
        This project allows you to load M3U playlists and EPG XML files to create a personalized TV guide and stream channels directly in your browser. The backend server handles stream fetching and on-the-fly transcoding, resolving common browser compatibility and CORS issues.
    </p>

    <!-- Optional: Screenshot/Demo GIF -->
    <!-- It's highly recommended to add a screenshot or a GIF of your app in action -->
    <!-- <div align="center">
        <img src="URL_TO_YOUR_SCREENSHOT.png" alt="ARDO IPTV Player Screenshot" width="700">
    </div> -->

    <hr>

    <h2>✨ Features</h2>
    <ul>
        <li><strong>TV Guide Interface:</strong> A clean, responsive EPG (Electronic Program Guide) view.</li>
        <li><strong>M3U & EPG Support:</strong> Load channels and guide data from local files or remote URLs.</li>
        <li><strong>FFMPEG Transcoding:</strong> The Node.js backend uses <code>ffmpeg</code> to transcode streams, ensuring broad browser compatibility.</li>
        <li><strong>Dockerized:</strong> The entire application is bundled into a single, easy-to-deploy Docker image.</li>
        <li><strong>Favorites & Recents:</strong> Mark your favorite channels and quickly access recently watched ones.</li>
        <li><strong>Search:</strong> Instantly search through both channels and program listings.</li>
        <li><strong>Picture-in-Picture:</strong> Continue watching your stream while you browse other tabs.</li>
    </ul>

    <hr>

    <h2>🚀 How to Run</h2>
    <p>This application is distributed as a Docker image. To run it, you will need <a href="https://docs.docker.com/get-docker/" target="_blank" rel="noopener noreferrer">Docker</a> installed on your system.</p>

    <ol>
        <li>
            <p><strong>Log in to GitHub Container Registry</strong></p>
            <p>You first need to authenticate your Docker client with GHCR. You only need to do this once.</p>
            <pre><code>docker login ghcr.io -u <span class="highlight">YOUR_GITHUB_USERNAME</span></code></pre>
            <p class="note">
                You will be prompted for a password. You must use a GitHub Personal Access Token (PAT) with the <code>read:packages</code> scope. You can generate one <a href="https://github.com/settings/tokens/new?scopes=read:packages" target="_blank" rel="noopener noreferrer">here</a>.
            </p>
        </li>
        <li>
            <p><strong>Pull the Docker Image</strong></p>
            <p>Pull the latest version of the player from the GitHub Container Registry.</p>
            <pre><code>docker pull ghcr.io/<span class="highlight">YOUR_GITHUB_USERNAME</span>/ardo-iptv-player:latest</code></pre>
        </li>
        <li>
            <p><strong>Run the Container</strong></p>
            <p>Start the container, mapping port <code>8998</code> to your host machine.</p>
            <pre><code>docker run -d -p 8998:8998 --name ardovini_tvplayer ghcr.io/<span class="highlight">YOUR_GITHUB_USERNAME</span>/ardo-iptv-player:latest</code></pre>
        </li>
    </ol>

    <p>
        Remember to replace <code class="highlight">YOUR_GITHUB_USERNAME</code> in the commands above with your actual GitHub username.
    </p>
    <p>
        Once the container is running, you can access your IPTV player by navigating to <strong><a href="http://localhost:8998" target="_blank" rel="noopener noreferrer">http://localhost:8998</a></strong> in your web browser.
    </p>
    
    <!-- End of README Content -->
</body>
</html>
