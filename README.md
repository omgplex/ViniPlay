<div align="center">
<img src="https://i.imgur.com/rwa8SjI.png" alt="ViniPlay Logo" width="120">
<h1>ViniPlay</h1>
<p>
<strong>A powerful, self-hosted IPTV player with a modern web interface.</strong>
</p>
<p>
Stream your M3U playlists with EPG data, manage users, cast to your TV, and watch multiple channels at once.
</p>
<p>
<img src="https://img.shields.io/badge/docker-ready-blue.svg?style=for-the-badge&logo=docker" alt="Docker Ready">
<img src="https://www.google.com/search?q=https://img.shields.io/badge/platform-node.js-green.svg%3Fstyle%3Dfor-the-badge%26logo%3Dnodedotjs" alt="Node.js Backend">
<img src="https://www.google.com/search?q=https://img.shields.io/badge/license-MIT-lightgrey.svg%3Fstyle%3Dfor-the-badge" alt="License">
</p>
</div>

ViniPlay transforms your M3U and EPG files into a polished, high-performance streaming experience. It's a full-featured IPTV solution that runs in a Docker container, providing a robust Node.js backend to handle streams and a sleek, responsive frontend for an exceptional user experience.

The server-side backend resolves common CORS and browser compatibility issues by proxying or transcoding streams with FFMPEG, while the feature-rich frontend provides a user experience comparable to premium IPTV services.

<!-- It's highly recommended to add a screenshot or a GIF of your app in action -->

<!--
<div align="center">
<img src="URL_TO_YOUR_SCREENSHOT.png" alt="ViniPlay Screenshot" width="800">
</div>
-->

✨ Key Features
Multi-User Management: Secure the application with a dedicated admin account. Create, edit, and manage standard user accounts.

Modern TV Guide: A high-performance, virtualized EPG grid that handles thousands of channels and programs smoothly. Features include advanced search, channel favoriting, and a "Recents" category.

Multi-View: Drag, drop, and resize players on a grid to watch multiple streams simultaneously. Save and load custom layouts.

Chromecast Support: Cast your streams directly to any Google Cast-enabled device on your network.

Push Notifications: Set reminders for upcoming programs and receive push notifications in your browser, even when the app is closed.

Powerful Transcoding: The backend uses FFMPEG to process streams, ensuring compatibility across all modern browsers and devices. Create custom stream profiles to tailor transcoding settings.

Flexible Source Management: Add M3U and EPG sources from either local files or remote URLs. Set automatic refresh intervals for URL-based sources to keep your guide data fresh.

High Performance UI: The frontend is built with performance in mind, using UI virtualization for the guide and efficient state management to ensure a fast and responsive experience.

Dockerized Deployment: The entire application is packaged in a single Docker container for simple, one-command deployment using Docker or Docker Compose.

Picture-in-Picture: Pop out the player to keep watching while you work on other things.

🚀 Getting Started
ViniPlay is designed for easy deployment using Docker.

Prerequisites
Docker

Docker Compose (Recommended)

Method 1: Using docker-compose (Recommended)
This is the easiest way to get started.

Create Project Files:
Create a directory for your ViniPlay setup and add the following two files:

docker-compose.yml:

version: "3.8"
services:
  viniplay:
    image: ghcr.io/your-username/viniplay:latest # Replace with your actual image path
    container_name: viniplay
    ports:
      - "8998:8998"
    restart: unless-stopped
    volumes:
      - ./viniplay-data:/data
    env_file:
      - ./.env

.env:

# Replace this with a long, random, and secret string
SESSION_SECRET=your_super_secret_session_key_here

Security Note: Your SESSION_SECRET should be a long, random string to properly secure user sessions.

Run the Container:
From your project directory, run the following command:

docker-compose up -d

Method 2: Using docker
If you prefer not to use Docker Compose, you can run the container manually.

Pull the Image:

docker pull ghcr.io/your-username/viniplay:latest # Replace with your actual image path

Run the Container:
Create a volume directory (mkdir viniplay-data) and a .env file first. Then run the container:

docker run -d \
  -p 8998:8998 \
  --name viniplay \
  --env-file ./.env \
  -v "$(pwd)/viniplay-data":/data \
  ghcr.io/your-username/viniplay:latest

First-Time Setup
Once the container is running, open your browser and navigate to http://localhost:8998.

You will be prompted to create your initial admin account. This is a one-time setup that secures your instance. After creating the admin account, you can log in and start configuring your sources in the Settings tab.

🔧 Configuration
All configuration is done via the web interface in the Settings tab.

Data Sources: Add your M3U and EPG sources. You can use remote URLs or upload files directly. Activate the sources you want to use and set refresh intervals for URLs to keep data current.

Processing: After adding sources, click the Process Sources & View Guide button. This will download, parse, and merge all your data.

Player Settings:

User Agents: Manage the User-Agent strings sent with stream requests. This can help bypass provider blocks.

Stream Profiles: Define how ffmpeg processes streams. You can use the built-in profiles or create your own custom commands.

User Management (Admin): Admins can create, edit, and delete user accounts from the settings page.

🏗️ Project Structure
The project is organized into a Node.js backend and a modular vanilla JavaScript frontend.

/
├── public/                  # Frontend static files
│   ├── js/
│   │   ├── main.js          # Main application entry point
│   │   └── modules/         # Modular JS components for each feature
│   │       ├── api.js       # Backend API communication
│   │       ├── auth.js      # Authentication flow
│   │       ├── cast.js      # Google Cast logic
│   │       ├── guide.js     # TV Guide logic & rendering
│   │       ├── multiview.js # Multi-View grid and players
│   │       ├── notification.js # Push notification management
│   │       ├── player.js    # Video player (mpegts.js)
│   │       ├── settings.js  # Settings page logic
│   │       ├── state.js     # Shared application state
│   │       ├── ui.js        # Global UI functions (modals, etc.)
│   │       └── utils.js     # Utility functions (parsers)
│   ├── sw.js                # Service Worker for push notifications
│   └── index.html           # Main HTML file
│
├── server.js                # Node.js backend (Express.js)
├── Dockerfile               # Docker build instructions
├── docker-compose.yml       # Docker Compose configuration
├── package.json             # Node.js dependencies
└── .env                     # Environment variables (e.g., SESSION_SECRET)

📄 License
This project is licensed under the MIT License.
