
<div align="center">

# ViniPlay

**A powerful, self-hosted IPTV player with a modern web interface.**

Stream your M3U playlists with EPG data, manage users, cast to your TV, and watch multiple channels at once.
<p>
    <img src="https://img.shields.io/badge/docker-ready-blue.svg?style=for-the-badge&logo=docker" alt="Docker Ready">
    <img src="https://img.shields.io/badge/platform-node-green.svg?style=for-the-badge&logo=node.js" alt="Node.js Backend">
</p>

</div>

---

ViniPlay transforms your M3U and EPG files into a polished, high-performance streaming experience. It's a full-featured IPTV solution that runs in a Docker container, providing a robust Node.js backend to handle streams and a sleek, responsive frontend for an exceptional user experience.

The server-side backend resolves common CORS and browser compatibility issues by proxying or transcoding streams with FFMPEG, while the feature-rich frontend provides a user experience comparable to premium IPTV services.

<table width="100%">
  <tr>
    <td colspan="3" align="center">
      <img src="https://i.imgur.com/1esDepO.gif" alt="Main GIF with UI navigation" width="100%">
      <br>
      <em>Main flow within the user interface</em>
    </td>
  </tr>

  <tr>
    <td align="center">
      <img src="https://i.imgur.com/SRJQKvw.png" alt="TV Guide page" width="400">
      <br>
      <em>TV Guide page</em>
    </td>
    <td align="center">
      <img src="https://imgur.com/zAwxzNR.png" alt="Multi-View page" width="400">
      <br>
      <em>Multi-View page</em>
    </td>
    <td align="center">
      <img src="https://imgur.com/ftmxvss.png" alt="Direct player" width="400">
      <br>
      <em>Direct player</em>
    </td>
  </tr>

  <tr>
    <td align="center">
      <img src="https://imgur.com/XVhT1pH.png" alt="DVR" width="250">
      <br>
      <em>DVR</em>
    </td>
    <td align="center">
      <img src="https://imgur.com/8OPCCht.png" alt="Admin activity" width="250">
      <br>
      <em>Admin activity</em>
    </td>
    <td align="center">
      <img src="https://imgur.com/D4hFLoI.png" alt="Notification" width="250">
      <br>
      <em>Notification</em>
    </td>
  </tr>

  <tr>
    <td align="center">
      <img src="https://imgur.com/FxOFq88.png" alt="Settings" width="250">
      <br>
      <em>Settings</em>
    </td>
    <td align="center">
      <img src="https://imgur.com/m8YpSEG.png" alt="Mobile TV Guide view" width="250">
      <br>
      <em>Description for Image 8</em>
    </td>
    <td align="center">
      <img src="https://imgur.com/QH0ueeC.png" alt="Channel description" width="250">
      <br>
      <em>Channel description</em>
    </td>
  </tr>
</table>


---

## ✨ Features

 - 👤 **Multi-User Management**: Secure the application with a dedicated admin account. Create, edit, and manage standard user accounts.
 - 📺 **Modern TV Guide**: A high-performance, virtualized EPG grid that handles thousands of channels and programs smoothly. Features include advanced search, channel favoriting, and a "Recents" category.
 - 🖼️ **Multi-View**: Drag, drop, and resize players on a grid to watch multiple streams simultaneously. Save and load custom layouts.
 - 🛜 **Chromecast Support**: Cast your streams directly to any Google Cast-enabled device on your network. (This will only work if your source signal is strong and correctly passed without package missing, due to Cast framework)
 - 🔔 **Push Notifications**: Set reminders for upcoming programs and receive push notifications in your browser, even when the app is closed.
 - ⚙️ **Powerful Transcoding - even with GPUs**: The backend uses FFMPEG to process streams, ensuring compatibility across all modern browsers and devices. Create custom stream profiles to tailor transcoding settings. GPU transcoding supported.
 - 📂 **Flexible Source Management**: Add M3U and EPG sources from either local files or remote URLs. Set automatic refresh intervals for URL-based sources to keep your guide data fresh.
 - 🚀 **High Performance UI**: The frontend is built with performance in mind, using UI virtualization for the guide and efficient state management to ensure a fast and responsive experience.
 - 🐳 **Dockerized Deployment**: The entire application is packaged in a single Docker container for simple, one-command deployment using Docker or Docker Compose.
 - ▶️ **Picture-in-Picture**: Pop out the player to keep watching while you work on other things.
 - 🎥 **DVR**: Record programs using FFMPEG. Schedule recording via the TV Guide, or set specific channels and time with ease.
 - 📽️ **Single player**: Play .m3u8 and .ts links directly from the browser, with detailed console logs and recorded history
 - 👥 **Admin monitoring page**: Monitor users watch stream in real time, store historical plays, and broadcast messages to all users.

---


## 🚀 Getting Started

ViniPlay is designed for easy deployment using Docker.

### Prerequisites

-   [Docker](https://docs.docker.com/get-docker/ "null")
    
-   [Docker Compose](https://docs.docker.com/compose/install/ "null") (Recommended)
    

### Method 1: Using `docker-compose` (Recommended)

This is the easiest way to get started.

1.  **Create Project Files:** Create a directory for your ViniPlay setup and add the following two files:
    
    -   `docker-compose.yml`:
        
        ```
        version: "3.8"
        services:
          viniplay:
            image: ardovini/viniplay:latest
            container_name: viniplay
            ports:
              - "8998:8998"
            restart: unless-stopped
            volumes:
              - ./viniplay-data:/data
            env_file:
              - ./.env
        
        ```
        
    -   `.env`:
        
        ```
        # Replace this with a long, random, and secret string
        SESSION_SECRET=your_super_secret_session_key_here
        
        ```
        
        > **Security Note:** Your `SESSION_SECRET` should be a long, random string to properly secure user sessions.
    
2.  **Build and Run the Container:** From your project directory, run the following command:
    
    ```
    docker-compose up --build -d
    
    ```

### Method 2: Using `docker`

If you prefer not to use Docker Compose, you can build and run the container manually.

1.  **Build the Image:** From the root of the project directory, run:
    
    ```
    docker build -t viniplay .
    
    ```
    
2.  **Run the Container:** Create a volume directory (`mkdir viniplay-data`) and a `.env` file first. Then run the container:
    
    ```
    docker run -d \
      -p 8998:8998 \
      --name viniplay \
      --env-file ./.env \
      -v "$(pwd)/viniplay-data":/data \
      viniplay
    
    ```
    

### First-Time Setup

Once the container is running, open your browser and navigate to `http://localhost:8998`.

You will be prompted to create your initial **admin account**. This is a one-time setup that secures your instance. After creating the admin account, you can log in and start configuring your sources in the **Settings** tab.

## 🔧 Configuration

All configuration is done via the web interface in the **Settings** tab.

-   **Data Sources:** Add your M3U and EPG sources. You can use remote URLs or upload files directly. Activate the sources you want to use and set refresh intervals for URLs to keep data current.
    
-   **Processing:** After adding sources, click the **Process Sources & View Guide** button. This will download, parse, and merge all your data.
    
-   **Player Settings:**
    
    -   **User Agents:** Manage the User-Agent strings sent with stream requests. This can help bypass provider blocks.
        
    -   **Stream Profiles:** Define how `ffmpeg` processes streams. You can use the built-in profiles or create your own custom commands.
        
-   **User Management (Admin):** Admins can create, edit, and delete user accounts from the settings page.
    

## 🏗️ Project Structure

The project is organized into a Node.js backend and a modular vanilla JavaScript frontend.

```
/
├── public/                          # Frontend static files
│   ├── js/
│   │   ├── main.js                  # Main application entry point
│   │   └── modules/                 # Modular JS components for each feature
│   │       ├── api.js               # Backend API communication
│   │       ├── auth.js              # Authentication flow
│   │       ├── cast.js              # Google Cast logic
│   │       ├── dvr.js               # DVR logic
│   │       ├── guide.js             # TV Guide logic & rendering
│   │       ├── multiview.js         # Multi-View grid and players
│   │       ├── notification.js      # Push notification management
│   │       ├── player.js            # Video player (mpegts.js)
│   │       ├── settings.js          # Settings page logic
│   │       ├── state.js             # Shared application state
│   │       ├── ui.js                # Global UI functions (modals, etc.)
│   │       └── utils.js             # Utility functions (parsers)
│   ├── sw.js                        # Service Worker for push notifications
│   └── index.html                   # Main HTML file
│
├── server.js                        # Node.js backend (Express.js)
├── Dockerfile                       # Docker build instructions
├── docker-compose.yml               # Docker Compose configuration
├── package.json                     # Node.js dependencies
└── .env                             # Environment variables (e.g., SESSION_SECRET)

```

## 🏗️ Roadmap

There are some elements I'd like to fix and introduce in the upcoming releases:

- Xtream Code (XC) and Stalker portal (STB) support
- DVR .ts files are not seekable when watching during recording
- Store logos to fast load time
- Introduce a full horizontal scroll instead of pagination in the TV Guide page
- Users force logout when account removed or locked


## 📄 License

This project is licensed under the MIT License. See the `LICENSE` file for details.
