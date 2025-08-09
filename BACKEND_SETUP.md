# Backend Setup для XPathAi

Инструкция по настройке и запуску backend-сервера для расширения XPathAi.

## Структура backend

- **backend/**
  - `main.py` – FastAPI сервер для работы с llama.cpp
  - `main_ollama.py` – FastAPI сервер для работы с локальной Ollama
  - `requirements.txt` – зависимости Python
  - `default_template.txt` – базовый промпт для генерации ответа
  - **Docker конфигурации:**
    - `docker-compose.yml` – основной backend с llama.cpp 
    - `docker-compose.ollama.yml` – backend для локальной Ollama
    - `docker-compose.gpu.yml` – дополнительный GPU backend
    - `Dockerfile` – llama.cpp + cuda
    - `Dockerfile.ollama` – легкий образ для Ollama
  - `nginx.conf` – конфигурация Nginx
  - **Скрипты запуска:**
    - `start_backend_docker.cmd` / `start_backend_docker.sh`
    - `start_backend_venv.cmd` / `start_backend_venv.sh`

## Настройка окружения

Создайте файл `.env` в папке `backend` и укажите параметры AI-сервиса:

```env
API_URL=<URL AI сервиса>
API_KEY=<API ключ>
MODEL_NAME=<Название модели>
```

### Пример конфигурации

```env
API_URL=https://api.deepseek.com/v1/chat/completions
API_KEY=your_api_key_here
MODEL_NAME=deepseek-ai/DeepSeek-R1-Distill-Qwen-7B
```

### Поддерживаемые модели

Тестировалось и работает с:
- THUDM/glm-4-9b-chat
- deepseek-ai/DeepSeek-R1-Distill-Qwen-7B
- Qwen/Qwen2.5-Coder-7B-Instruct

## Запуск backend в Docker

### Выбор типа backend

В проекте доступно несколько вариантов backend:

1. **docker-compose.yml** - Основной backend с llama.cpp и GPU поддержкой
2. **docker-compose.ollama.yml** - Backend для работы с локальной Ollama
3. **docker-compose.gpu.yml** - Оптимизированный GPU backend

### Backend с локальной Ollama (рекомендуется для Windows)

**Установка Ollama:**
1. Скачайте с https://ollama.ai/
2. Установите модель: `ollama pull qwen2.5:3b`

**Запуск с Docker:**
```cmd
cd backend
docker-compose -f docker-compose.ollama.yml up -d --build
```

**Проверка работы:**
```cmd
# Проверить доступность Ollama
curl http://localhost:11434/api/tags

# Проверить backend
curl http://localhost:8000/health
```

### Запуск с llama.cpp (GPU сборка)

### Использование готовых скриптов

**Windows:**
```cmd
cd backend
start_backend_docker.cmd
```

**Linux/macOS/Git Bash:**
```bash
cd backend
chmod +x start_backend_docker.sh
./start_backend_docker.sh
```

### Запуск вручную

1. Убедитесь, что установлен Docker и docker-compose
2. Убедитесь, что в папке `backend` есть файл `.env`
3. Запустите:
   ```bash
   cd backend
   docker compose up -d --build
   ```

Backend будет доступен по адресу: `http://localhost:8000`

## Запуск backend локально (в venv)

### Использование готовых скриптов

**Windows:**
```cmd
cd backend
start_backend_venv.cmd
```

**Linux/macOS/Git Bash:**
```bash
cd backend
chmod +x start_backend_venv.sh
./start_backend_venv.sh
```

### Запуск вручную

1. Убедитесь, что в папке `backend` есть файл `.env`
2. Создайте виртуальное окружение и активируйте его:
   ```bash
   python -m venv .venv
   # Windows
   .\.venv\Scripts\activate
   # Linux/macOS
   source .venv/bin/activate
   ```
3. Установите зависимости:
   ```bash
   pip install -r backend/requirements.txt
   ```
4. Запустите сервер:
   ```bash
   cd backend
   uvicorn main:app --reload --port 8000
   ```

Backend будет доступен по адресу: `http://localhost:8000`

## API Endpoints

### POST /generate-xpath
Генерирует XPath для переданного элемента с использованием AI.

**Параметры запроса:**
```json
{
  "element_html": "<button class='submit-btn'>Submit</button>",
  "dom_structure": "html > body > form > button.submit-btn",
  "context": "additional context if needed"
}
```

**Ответ:**
```json
{
  "primary_xpath": "//button[@class='submit-btn']",
  "alternative_xpath": "//form/button[contains(text(), 'Submit')]",
  "explanation": "Generated XPath explanation..."
}
```

## Интеграция с расширением

1. Запустите backend сервер (Docker или venv)
2. В настройках расширения укажите:
   - **API URL**: `http://localhost:8000/generate-xpath`
   - **API Key**: (если требуется аутентификация)
   - **Model Name**: (название используемой модели)
3. Включите режим AI в расширении

## Устранение неполадок

### Проблемы с Docker
- Убедитесь, что Docker Desktop запущен
- Проверьте, что порт 8000 не занят другими приложениями
- Проверьте логи: `docker compose logs`

### Проблемы с venv
- Убедитесь, что используется правильная версия Python (3.8+)
- Проверьте активацию виртуального окружения
- Убедитесь, что все зависимости установлены

### Проблемы с AI API
- Проверьте правильность API ключа в `.env`
- Убедитесь, что API URL доступен
- Проверьте лимиты и квоты API сервиса

## Разработка

Для разработки рекомендуется использовать режим reload:
```bash
uvicorn main:app --reload --port 8000
```

Документация API доступна по адресу: `http://localhost:8000/docs`
