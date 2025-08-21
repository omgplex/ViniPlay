# Use a pre-built FFmpeg image with NVIDIA support as the base.
# This is much more reliable than compiling from source and includes ffmpeg, drivers, and nvidia-smi.
FROM jrottenberg/ffmpeg:6.0-nvidia

# Set environment to non-interactive to prevent installation prompts
ENV DEBIAN_FRONTEND=noninteractive

# The base image is Debian-based. We'll install Node.js v18,
# curl for fetching the Node.js setup script,
# and build-essential & python3 for compiling native npm packages (like bcrypt and sqlite3).
RUN apt-get update && \
    apt-get install -y curl ca-certificates build-essential python3 && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create and set the working directory in the container
WORKDIR /usr/src/app

# Copy package files and install application dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application's source code
COPY . .

# Expose the application's port
EXPOSE 8998

# Create and declare volumes for persistent data
# The server.js file is configured to use these directories.
RUN mkdir -p /data
RUN mkdir -p /dvr
VOLUME /data
VOLUME /dvr

# Define the command to run the application
CMD [ "npm", "start" ]

