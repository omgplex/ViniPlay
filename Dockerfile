# Use an official Node.js runtime as a parent image
FROM node:18

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

# Define the command to run your app
CMD [ "npm", "start" ]

# Install ffmpeg, which is available in the Alpine package repository.
# --no-cache reduces image size.
RUN apt-get update && apt-get install -y ffmpeg
