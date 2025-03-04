@echo off
:: filepath: XPathAi/backend/start_backend_docker.cmd

title XPathAi Backend Docker Starter

echo === XPathAi Backend Starter (Docker) ===

:: Check if Docker is installed
where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Docker is not installed. Please install Docker first.
    pause
    exit /b 1
)

:: Check if docker compose is installed
docker compose version >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Docker Compose is not installed or not in PATH.
    pause
    exit /b 1
)

:: Check if .env file exists in current directory
if not exist ".\.env" (
    echo Warning: .env file not found in backend directory!
    echo Please create a .env file with your AI service configuration:
    echo   API_URL=^<^>
    echo   API_KEY=^<^>
    echo   MODEL_NAME=^<^>
    
    set /p CONTINUE="Continue anyway? (y/n): "
    echo.
    if /I not "%CONTINUE%"=="y" (
        echo Exiting...
        pause
        exit /b 1
    )
)

:: Check for running containers and stop them if needed
docker compose ps -q >nul 2>nul
set RUNNING=0
for /f %%i in ('docker compose ps -q') do set RUNNING=1
if %RUNNING%==1 (
    echo Found running containers. Stopping them...
    docker compose down
    if %ERRORLEVEL% neq 0 (
        echo Failed to stop existing containers.
        pause
        exit /b 1
    )
)

:: Build and start the containers
echo Building and starting Docker containers...
docker compose up --build -d

if %ERRORLEVEL% neq 0 (
    echo Failed to start Docker containers.
    pause
    exit /b 1
)

:: Show container status
echo Container status:
docker compose ps

:: Show logs
echo Container logs (press Ctrl+C to exit logs but keep containers running):
echo Server will be available at http://localhost:8000
docker compose logs -f

echo.
echo ress any key to exit this window...
pause >nul