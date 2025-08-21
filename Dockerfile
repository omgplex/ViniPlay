# Use an official NVIDIA CUDA runtime as a parent image to ensure drivers are present.
FROM nvidia/cuda:11.8.0-base-ubuntu22.04

# Set environment to non-interactive to prevent installation prompts.
ENV DEBIAN_FRONTEND=noninteractive

# Install essential dependencies including build tools for compiling native Node.js modules.
RUN apt-get update && apt-get install -y \
    curl \
    xz-utils \
    build-essential \
    python3 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js v18, which is required to run the application server.
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

# Create and set the working directory in the container.
WORKDIR /usr/src/app

# Copy package files first to leverage Docker's layer caching for faster builds.
COPY package*.json ./

# Install the application's Node.js dependencies.
# This requires the build tools installed above for packages like bcrypt and sqlite3.
RUN npm install

# Copy the rest of the application's source code into the container.
COPY . .

# Expose the application's port to the host machine.
EXPOSE 8998

# Download and install a static build of ffmpeg that includes NVIDIA NVENC support.
# This is crucial for GPU-accelerated transcoding. The default ffmpeg in apt does not have this.
RUN FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" && \
    curl -sSL ${FFMPEG_URL} | tar xJ --strip-components=1 -C /usr/local/bin/

# Create and declare volumes for persistent data (settings, sources, DVR recordings).
RUN mkdir -p /data
RUN mkdir -p /dvr
VOLUME /data
VOLUME /dvr

# Define the command to run the application when the container starts.
CMD [ "npm", "start" ]

