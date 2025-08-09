# Stage 1: llama-server
ARG CUDA_VERSION=12.3.0
FROM nvidia/cuda:${CUDA_VERSION}-devel-ubuntu22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    cmake \
    libcurl4-openssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y \
    cuda-cudart-12-0 \
    libcudnn8 \
    && rm -rf /var/lib/apt/lists/*

ENV LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
ENV PATH=/usr/local/cuda/bin:$PATH
ENV CUDA_ROOT=/usr/local/cuda
ENV CUDA_HOME=/usr/local/cuda

RUN git clone --depth 1 https://github.com/ggerganov/llama.cpp.git /tmp/llama.cpp && \
    cd /tmp/llama.cpp && \
    mkdir build && cd build && \
    cmake .. -DGGML_CUDA=ON -DLLAMA_CURL=ON -DCMAKE_BUILD_TYPE=Release \
           -DCUDA_TOOLKIT_ROOT_DIR=/usr/local/cuda \
           -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc && \
    cmake --build . --config Release --target llama-server && \
    cp bin/llama-server /llama-server && \
    chmod +x /llama-server

# Stage 2: Runtime
ARG CUDA_VERSION=12.3.0
FROM nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN apt-get update && apt-get install -y \
    software-properties-common \
    wget \
    curl \
    libcurl4-openssl-dev \
    libopenblas-dev \
    libgomp1 \
    cuda-cudart-12-0 \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update && \
    apt-get install -y python3.12 python3.12-dev python3.12-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN python3.12 -m ensurepip --upgrade || \
    curl https://bootstrap.pypa.io/get-pip.py | python3.12

RUN ln -sf /usr/bin/python3.12 /usr/bin/python3 && \
    ln -sf /usr/bin/python3.12 /usr/bin/python

WORKDIR /app

COPY --from=builder /llama-server /app/llm/bin/llama-server

COPY main.py /app/main.py
COPY requirements.txt /app/requirements.txt

RUN python3.12 -m pip install --upgrade pip --root-user-action=ignore && \
    python3.12 -m pip install --timeout=300 --retries=3 --no-cache-dir -r requirements.txt --root-user-action=ignore

RUN mkdir -p /app/llm/models

ENV LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
ENV PATH=/usr/local/cuda/bin:$PATH
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

EXPOSE 8000 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=5 CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["python3.12", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]