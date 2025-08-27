# Use a CUDA base image that is compatible with the NVIDIA 535 driver series.
# CUDA 12.2.2 is a stable release for this driver version.
# Using the 'devel' tag ensures all development libraries (like NVML) are included.
FROM nvidia/cuda:12.2.2-devel-ubuntu22.04

# Set environment variables to ensure the container can find and use NVIDIA tools.
ENV PATH /usr/local/nvidia/bin:${PATH}
ENV NVIDIA_DRIVER_CAPABILITIES all

# Set environment variables to prevent interactive prompts during installation.
ENV DEBIAN_FRONTEND=noninteractive

# Install necessary dependencies:
# NOTE: We no longer need to install nvidia-utils-*** as it's included in the devel image.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    curl \
    gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y --no-install-recommends \
    nodejs \
    ffmpeg && \
    # Clean up apt caches to reduce image size.
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create and set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
# This is done first to leverage Docker's layer caching.
COPY package*.json ./

# Install app dependencies inside the container
RUN npm install

# Copy the rest of your application's source code
COPY . .

# Make your app's port available to the host
EXPOSE 8998

# Create and declare volumes for persistent data.
# The server.js file is now configured to use /data as its storage root.
# This instruction ensures the directory is created and tells Docker that this
# path is intended for persistent data storage.
RUN mkdir /data
RUN mkdir /dvr # Create the directory for DVR recordings
VOLUME /data
VOLUME /dvr   # Declare the DVR directory as a volume

# Define the command to run your app
CMD [ "npm", "start" ]

