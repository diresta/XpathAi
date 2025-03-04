#!/bin/bash
# filepath: XPathAi/backend/start_backend.sh


GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== XPathAi Backend Starter ===${NC}"

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

# Create virtual environment if it doesn't exist (in parent directory)
if [ ! -d "../.venv" ]; then
    echo -e "${GREEN}Creating virtual environment...${NC}"
    cd ..
    python -m venv .venv
    cd backend
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to create virtual environment. Is Python installed?${NC}"
        exit 1
    fi
fi

# Activate virtual environment
echo -e "${GREEN}Activating virtual environment...${NC}"
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows using Git Bash or similar
    source ../.venv/Scripts/activate
else
    # Unix-like OS
    source ../.venv/bin/activate
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to activate virtual environment.${NC}"
    exit 1
fi

# Install dependencies
echo -e "${GREEN}Installing dependencies...${NC}"
pip install -r requirements.txt
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install dependencies.${NC}"
    exit 1
fi

# Run the server
echo -e "${GREEN}Starting backend server...${NC}"
echo -e "${YELLOW}Server will be available at http://localhost:8000${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop the server${NC}"
uvicorn main:app --reload --port 8000