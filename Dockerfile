# Stage 1: Use an official Node.js runtime as a parent image.
# Alpine Linux is used for its small size.
FROM node:18-alpine

# Install ffmpeg, which is available in the Alpine package repository.
# --no-cache reduces image size.
RUN apk add --no-cache ffmpeg

# Set the working directory in the container.
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker cache.
# This step only re-runs if these files change.
COPY package*.json ./

# Install app dependencies.
RUN npm install

# Bundle app source inside the Docker image.
# This copies all files from your local directory into the container.
COPY . .

# Make port 8998 available to the world outside this container.
EXPOSE 8998

# Define the command to run the app.
CMD [ "node", "server.js" ]
