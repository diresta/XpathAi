@echo off
:: filepath: XPathAi/backend/start_backend_venv.cmd

title XPathAi Backend venv Starter

echo === XPathAi Backend Starter ===

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

:: Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Python is not installed or not in PATH.
    pause
    exit /b 1
)

:: Create virtual environment if it doesn't exist (in parent directory)
if not exist "..\.venv" (
    echo reating virtual environment...
    cd ..
    python -m venv .venv
    if %ERRORLEVEL% neq 0 (
        echo Failed to create virtual environment. Is Python installed correctly?
        cd backend
        pause
        exit /b 1
    )
    cd backend
) 

:: Activate virtual environment
echo Activating virtual environment...
call ..\.venv\Scripts\activate.bat
if %ERRORLEVEL% neq 0 (
    echo Failed to activate virtual environment.
    pause
    exit /b 1
)

:: Install dependencies
echo Installing dependencies...
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo Failed to install dependencies.
    pause
    exit /b 1
)

:: Run the server
echo Starting backend server...
echo Server will be available at http://localhost:8000
echo Press Ctrl+C to stop the server
uvicorn main:app --reload --port 8000

:: This part will run when server is stopped
deactivate
echo Server stopped. Press any key to exit...
pause >nul