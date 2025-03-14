#!/bin/bash
# filepath: XPathAi/backend/start_backend_docker.sh

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== XPathAi Backend Starter (Docker) ===${NC}"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Check if docker compose is installed
if ! docker compose version &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed or not in PATH.${NC}"
    exit 1
fi

# Check if .env file exists in current directory
if [ ! -f "./.env" ]; then
    echo -e "${YELLOW}Warning: .env file not found in backend directory!${NC}"
    echo -e "Please create a .env file with your AI service configuration:"
    echo -e "  API_URL=<>"
    echo -e "  API_KEY=<>"
    echo -e "  MODEL_NAME=<>"
    
    read -p "Continue anyway? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Exiting...${NC}"
        exit 1
    fi
fi

# Check for running containers and stop them if needed
if docker compose ps -q &> /dev/null && [ ! -z "$(docker compose ps -q)" ]; then
    echo -e "${YELLOW}Found running containers. Stopping them...${NC}"
    docker compose down
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to stop existing containers.${NC}"
        exit 1
    fi
fi

# Build and start the containers
echo -e "${GREEN}Building and starting Docker containers...${NC}"
sudo docker compose up --build -d

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to start Docker containers.${NC}"
    exit 1
fi

# Show container status
echo -e "${GREEN}Container status:${NC}"
sudo docker compose ps

# Show logs 
echo -e "${GREEN}Container logs (press Ctrl+C to exit logs but keep containers running):${NC}"
echo -e "${YELLOW}Server will be available at http://localhost:8000${NC}"
sudo docker compose logs -f