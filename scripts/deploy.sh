#!/bin/bash

# Variables
REGISTRY="116715029140.dkr.ecr.ap-south-1.amazonaws.com"
REPO="personal-projects"
BACKEND_IMAGE="$REGISTRY/$REPO:latest"
FRONTEND_IMAGE="$REGISTRY/$REPO:latest" # Assuming both use the same repo with latest tags

# Login to ECR
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin $REGISTRY

# --- Deploy Backend ---
echo "Deploying Backend..."
if [ "$(docker ps -aq -f name=backend_app)" ]; then
    echo "Stopping and removing existing backend container..."
    docker stop backend_app
    docker rm backend_app
fi

docker pull $BACKEND_IMAGE
docker run -d \
  --name backend_app \
  -p 5000:5000 \
  -e DB_HOST=postgres_db \
  -e DB_USER=skilluser \
  -e DB_PASS=skillpass \
  -e DB_NAME=skilldb \
  -e REDIS_HOST=redis_cache \
  --network my_app_network \
  --restart always \
  $BACKEND_IMAGE

# --- Deploy Frontend ---
echo "Deploying Frontend..."
if [ "$(docker ps -aq -f name=frontend_app)" ]; then
    echo "Stopping and removing existing frontend container..."
    docker stop frontend_app
    docker rm frontend_app
fi

docker pull $FRONTEND_IMAGE
docker run -d \
  --name frontend_app \
  -p 3000:3000 \
  -e REACT_APP_API_URL=http://backend_app:5000 \
  --restart always \
  --network my_app_network \
  $FRONTEND_IMAGE

echo "Deployment complete."