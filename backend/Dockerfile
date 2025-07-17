FROM python:3.9-slim-bookworm

WORKDIR /app
COPY . /app

RUN apt-get update && apt-get upgrade -y && apt-get clean && rm -rf /var/lib/apt/lists/* && \
	pip install --no-cache-dir -r requirements.txt

COPY llamafile.exe /app/llamafile.exe
COPY model.gguf /app/model.gguf

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]