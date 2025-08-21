#
# STAGE 1: Build a custom FFmpeg with NVIDIA NVENC support
#
# We use the -devel image because it contains the necessary headers and libraries
# for compiling software against the CUDA toolkit.
FROM nvidia/cuda:11.8.0-devel-ubuntu22.04 as builder

# Set environment to non-interactive to prevent installation prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install build-essential tools and dependencies required to compile FFmpeg
RUN apt-get update && apt-get install -y \
    build-essential \
    yasm \
    cmake \
    libtool \
    curl \
    ca-certificates \
    git \
    libx264-dev \
    libx265-dev \
    libnuma-dev \
    libvpx-dev \
    libfdk-aac-dev \
    libmp3lame-dev \
    libopus-dev \
    nasm \
    --no-install-recommends

# FFmpeg requires NVIDIA's video codec headers
RUN git clone https://git.videolan.org/git/ffmpeg/nv-codec-headers.git /usr/src/nv-codec-headers && \
    cd /usr/src/nv-codec-headers && \
    make install

# Download and compile a stable version of FFmpeg from source
RUN curl -sSL https://ffmpeg.org/releases/ffmpeg-6.0.tar.bz2 | tar -xj -C /usr/src && \
    cd /usr/src/ffmpeg-6.0 && \
    ./configure \
      --enable-gpl \
      --enable-nonfree \
      --enable-cuda-nvcc \
      --enable-libnpp \
      --extra-cflags="-I/usr/local/cuda/include" \
      --extra-ldflags="-L/usr/local/cuda/lib64" \
      --disable-static \
      --enable-shared \
      --enable-nvenc \
      --enable-libx264 \
      --enable-libx265 \
      --enable-libvpx \
      --enable-libfdk-aac \
      --enable-libmp3lame \
      --enable-libopus && \
    make -j$(nproc) && \
    make install

#
# STAGE 2: Create the final, smaller application image
#
# We switch back to a -base image which is smaller because it doesn't contain
# all the build tools and development libraries from the -devel image.
FROM nvidia/cuda:11.8.0-base-ubuntu22.04

# Set environment to non-interactive
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js v18 and runtime dependencies
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy the compiled FFmpeg and its libraries from the builder stage
COPY --from=builder /usr/local/bin/ffmpeg /usr/local/bin/
COPY --from=builder /usr/local/lib/ /usr/local/lib/
# Update the library cache so the system can find the new FFmpeg libraries
RUN ldconfig

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
RUN mkdir -p /data
RUN mkdir -p /dvr
VOLUME /data
VOLUME /dvr

# Define the command to run the application
CMD [ "npm", "start" ]
