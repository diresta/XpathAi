FROM python:3.12.3-slim-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y \
    wget \
    curl \
    libopenblas-dev \
    libgomp1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY main.py /app/main.py
COPY .env /app/.env
COPY requirements.txt /app/requirements.txt

RUN pip install -r requirements.txt

RUN mkdir -p /app/llm/models

COPY llm/bin /app/llm/bin
RUN chmod +x /app/llm/bin/llama-server

ENV LD_LIBRARY_PATH=/app/llm/bin


EXPOSE 8000 8080


CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]