ViniPlay 📺
A powerful, self-hosted web-based media player for M3U and EPG files, with advanced features for a modern viewing experience.

🔗 Repository

ViniPlay transforms your M3U playlists and EPG XML files into a comprehensive, personalized TV guide and streaming platform, accessible directly in your browser. Its robust Node.js backend handles on-the-fly transcoding with FFMPEG, ensuring seamless playback and resolving common browser compatibility and CORS issues.

What sets ViniPlay apart is its commitment to a modern user experience, incorporating features typically found in commercial streaming services into a self-hosted solution. Enjoy managing users, receiving notifications, and even sharing your viewing experience.

<!-- It's highly recommended to add a screenshot or a GIF of your app in action -->

<p align="center">
<img src="https://www.google.com/search?q=https://placehold.co/700x400/e0e7ff/4f46e5%3Ftext%3DViniPlay%2BScreenshot%2BComing%2BSoon" alt="ViniPlay Screenshot">
<br>
<em>A sneak peek of ViniPlay in action!</em>
</p>

⚙️ What Can ViniPlay Do?
User Management: Create and manage multiple user accounts, allowing different profiles and personalized settings.

Notifications: Receive real-time alerts for program changes, system updates, or shared content.

Multiplayer & Sharing: Share your viewing session with friends or family, enabling a collaborative experience.

Cast Functionality: Cast your content to compatible devices for a larger screen experience.

DOM Virtualization: Enjoy a smooth and performant user interface, even with large EPG datasets.

M3U & EPG Support: Easily upload your M3U playlists and EPG XML files, from local storage or remote URLs.

FFMPEG Transcoding: The backend uses ffmpeg to transcode streams on-the-fly, ensuring broad browser compatibility and resolving CORS issues.

Dockerized Deployment: The entire application is packaged into a single, easy-to-deploy Docker image.

Favorites & Recents: Mark your favorite channels for quick access and easily resume recently watched ones.

Instant Search: Quickly find channels and programs within your extensive listings.

Picture-in-Picture: Continue watching your stream in a floating window while you browse other tabs or applications.

Real-time Updates: Leverage onSnapshot listeners with Firestore for real-time updates across users and features.

🚀 How to Install and Run ViniPlay
ViniPlay is distributed as a Docker image, making deployment straightforward. You'll need Docker installed on your system to get started.

1. Install Docker
If you don't have Docker installed, follow the official documentation for your operating system:

➡️ Get Docker Here

2. Authenticate with GitHub Container Registry (GHCR)
You'll need to authenticate your Docker client with GHCR. This is a one-time setup.

docker login ghcr.io -u YOUR_GITHUB_USERNAME

Note: When prompted for a password, you must use a GitHub Personal Access Token (PAT) with the read:packages scope. You can generate one here.

3. Pull the Docker Image
Fetch the latest version of the ViniPlay Docker image from GHCR:

docker pull ghcr.io/YOUR_GITHUB_USERNAME/viniplay:latest

4. Run the Container
Start the ViniPlay container, mapping port 8998 on your host machine to the container's internal port:

docker run -d -p 8998:8998 --name viniplay ghcr.io/YOUR_GITHUB_USERNAME/viniplay:latest

Remember to replace YOUR_GITHUB_USERNAME with your actual GitHub username in the commands above.

🌐 Access ViniPlay
Once the container is running successfully, you can access your ViniPlay media player by navigating to the following address in your web browser:

http://localhost:8998

👋 Contributing
ViniPlay is an open-source project, and contributions are welcome! Feel free to open issues for bug reports or feature requests, and pull requests for any improvements.

For more details, check out the CONTRIBUTING.md guide (if available in your repository).

📄 License
This project is licensed under the MIT License - see the LICENSE file for details.

© 2025 YOUR_GITHUB_USERNAME. All rights reserved.
