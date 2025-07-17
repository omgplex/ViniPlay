# Use an official Node.js runtime as a parent image
FROM node:18

# Create and set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
# Using npm ci, these files MUST be present.
COPY package.json package-lock.json ./

# Install app dependencies inside the container using npm ci for reproducible builds
RUN npm ci

# Run the build script to transpile JSX files
# Ensure this script is defined in package.json
RUN npm run build

# Copy the rest of your application's source code
COPY . .

# Make your app's port available to the host
EXPOSE 8998

# Install ffmpeg, which is required for stream proxying.
# Using --no-install-recommends to keep the image size down
RUN apt-get update && apt-get install -y ffmpeg --no-install-recommends && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create and declare a volume for persistent data.
# The server.js file is now configured to use /data as its storage root.
# This instruction ensures the directory is created and tells Docker that this
# path is intended for persistent data storage.
RUN mkdir /data 
VOLUME /data

# Define the command to run your app
CMD [ "npm", "start" ]
