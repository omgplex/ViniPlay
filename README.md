ARDO IPTV Player
A simple, self-hosted IPTV player with a clean web interface and powerful backend transcoding using FFMPEG. This project allows you to load M3U playlists and EPG XML files to create a personalized TV guide and stream channels directly in your browser.

The backend server handles stream fetching and on-the-fly transcoding, resolving common browser compatibility and CORS issues.

✨ Features
TV Guide Interface: A clean, responsive EPG (Electronic Program Guide) view.

M3U & EPG Support: Load channels and guide data from local files or remote URLs.

FFMPEG Transcoding: The Node.js backend uses ffmpeg to transcode streams, ensuring broad browser compatibility.

Dockerized: The entire application is bundled into a single, easy-to-deploy Docker image.

Favorites & Recents: Mark your favorite channels and quickly access recently watched ones.

Search: Instantly search through both channels and program listings.

Picture-in-Picture: Continue watching your stream while you browse other tabs.

🚀 How to Run
This application is distributed as a Docker image. To run it, you will need Docker installed on your system.

Log in to GitHub Container Registry:
You first need to authenticate your Docker client with GHCR. You only need to do this once.

docker login ghcr.io -u YOUR_GITHUB_USERNAME

You will be prompted for a password. You must use a GitHub Personal Access Token (PAT) with the read:packages scope. You can generate one here.

Pull the Docker Image:
Pull the latest version of the player from the GitHub Container Registry.

docker pull ghcr.io/YOUR_GITHUB_USERNAME/ardo-iptv-player:latest

Run the Container:
Start the container, mapping port 8998 to your host machine.

docker run -d -p 8998:8998 --name ardovini_tvplayer ghcr.io/YOUR_GITHUB_USERNAME/ardo-iptv-player:latest

(Replace YOUR_GITHUB_USERNAME in the commands above with your actual GitHub username.)

Open the Player:
You can now access your IPTV player by navigating to http://localhost:8998 in your web browser.
