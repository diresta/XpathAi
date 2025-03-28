# XPathAi
Расширение для Chrome с серверной частью на FastAPI, упрощающее поиск устойчивых XPath-локаторов с использованием AI-сервисов.

## Структура проекта

- **extension/**
  - `contentScript.js` – код для подсветки и выбора элементов
  - `background.js` – фоновый скрипт для отправки данных на сервер
  - `popup/popup.*` – интерфейс расширения
  - `options.*` – настройки расширения

- **backend/**
  - `main.py` – FastAPI для генерации XPath
  - `requirements.txt` – зависимости Python
  - `prompt_template/2.txt` – промпт для генерации ответа
  - `docker-compose.yml` – конфигурация Docker Compose

## Как работает расширение

1. По клику на «🔍 Выбрать элемент» `popup.js` отправляет сообщение `contentScript.js`.
2. `contentScript.js` обрабатывает наведение мыши и клик на элемент, подсвечивая его.
3. После выбора элемента `contentScript.js` отправляет выбранный элемент и структуры DOM в `background.js`.
4. `background.js` отправляет эти данные POSTом на сервер `main.py` для генерации XPath.
5. `main.py` добавляет к  шаблон промпта `prompt_template/2.txt`, отправляет в AI, и возвращает сгенерированный ответ.
6. `background.js` получает ответ от сервера и отправляет его обратно в `popup.js`.
7. `popup.js` отображает сгенерированный XPath в интерфейсе расширения.

## Окружение

Создайте файл `.env` в папке `backend` и укажите параметры:
```env
API_URL=<URL AI сервиса>
API_KEY=<API ключ>
MODEL_NAME=<Название модели>
```
Пример конфигурации в `.env.example`

Тестировалось и приемлемо работало на:
- THUDM/glm-4-9b-chat
- deepseek-ai/DeepSeek-R1-Distill-Qwen-7B
- Qwen/Qwen2.5-Coder-7B-Instruct

## Запуск бэкенда в Docker

Используйте готовые скрипты:

- Linux/macOS/Git Bash:
   ```bash
   cd backend
   chmod +x start_backend_docker.sh
   ./start_backend_docker.sh
   ```
- Windows: backend/start_backend_docker.cmd

Запуск вручную:

1. Убедитесь, что установлен Docker и docker-compose.  
2. Убедитесь, что в в папке `backend` есть файл `.env`.  
3. Запустите:
   ```bash
   docker compose up -d --build
   ```

## Запуск бэкенда локально (в venv)

Используйте готовые скрипты:

- Linux/macOS/Git Bash:
   ```bash
   cd backend
   chmod +x start_backend_venv.sh
   ./start_backend_venv.sh
   ```
- Windows: backend/start_backend_venv.cmd

Запуск вручную:

1. Убедитесь, что в корне проекта есть файл `.env`.
2. Создайте виртуальное окружение и активируйте его:
   ```bash
   python -m venv .venv
   .\.venv\Scripts\activate
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

## Установка расширения

1. В Google Chrome откройте «Расширения» → «Управление расширениями» и включите «Режим разработчика».
2. Нажмите «Загрузить распакованное расширение» и укажите папку `extension`.

## Использование

1. Откройте веб-страницу, на которой хотите найти XPath.
2. Нажмите кнопку «🔍 Выбрать элемент» в расширении.
3. Наведите курсор на элемент и кликните для выбора.
4. Расширение отправит данные на бэкенд, который сгенерирует ответ и XPath.
5. Скопируйте XPath кликом по полю для дальнейшего использования.

## Лицензия

Проект распространяется «как есть». Внесите любые оптимизации или расширения по своему усмотрению.