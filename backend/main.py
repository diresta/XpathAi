import asyncio
import json
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator
from pydantic_settings import BaseSettings
import logging
from time import time
from typing import Optional, List
import httpx


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s:%(name)s:%(message)s'
)

# Suppress DEBUG messages from HTTP libraries
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

# Keep app logs at DEBUG level
logging.getLogger("__main__").setLevel(logging.DEBUG)
logging.getLogger("uvicorn").setLevel(logging.INFO)

class LlamaCppServer:
    """Manages llama.cpp server instance via HTTP API."""
    def __init__(self, binary_path: str, models_dir: str, port: int = 8080):
        self.binary_path = binary_path
        self.models_dir = models_dir
        self.port = port
        self.process = None
        self.current_model = None
        self.lock = asyncio.Lock()
        self.base_url = f"http://localhost:{port}"
        
    async def start_server(self, model_name: str, extra_args: Optional[List[str]] = None):
        """Start llama.cpp server with specified model."""
        logging.debug(f"start_server called with model: {model_name}")
        async with self.lock:
            if self.process and self.current_model == model_name:
                logging.debug(f"Server already running with {model_name}, skipping")
                return  # Already running with this model
                
            await self._stop_server_internal()
            
            model_path = os.path.join(self.models_dir, model_name)
            if not os.path.exists(model_path):
                raise ValueError(f"Model not found: {model_path}")
            
            cmd = [
                self.binary_path,
                "-m", model_path,
                "--port", str(self.port),
                "--host", "0.0.0.0",
                "-c", str(settings.max_context_tokens),
                "--parallel", "4",
                "--threads", "8",
                "--mlock"
            ]
            
            # Try to add GPU support if available
            try:
                import subprocess
                
                # Simple GPU detection
                gpu_available = False
                gpu_layers = "0"  # Default CPU
                
                # Check if NVIDIA GPU is available
                try:
                    result = subprocess.run(["nvidia-smi"], capture_output=True, timeout=3, text=True)
                    if result.returncode == 0:
                        gpu_available = True
                        # Try to determine GPU layers dynamically based on GPU memory
                        try:
                            import re
                            mem_match = re.search(r"(\d+)\s*MiB", result.stdout)
                            if mem_match:
                                gpu_mem = int(mem_match.group(1))
                                # Estimate layers: more memory allows more layers
                                if gpu_mem >= 24000:
                                    gpu_layers = str(min(settings.gpu_layers, 60))
                                elif gpu_mem >= 12000:
                                    gpu_layers = str(min(settings.gpu_layers, 40))
                                else:
                                    gpu_layers = str(min(settings.gpu_layers, 20))
                            else:
                                gpu_layers = str(settings.gpu_layers)
                        except Exception:
                            gpu_layers = str(settings.gpu_layers)
                        
                        gpu_params = [
                            "-ngl", gpu_layers,     # GPU layers
                            "--main-gpu", "0"       # Use first GPU
                        ]
                        cmd.extend(gpu_params)
                        logging.info(f"GPU detected, using {gpu_layers} layers on GPU")
                except Exception as e:
                    logging.debug(f"GPU check failed: {e}")
                        
                if not gpu_available:
                    logging.info("No GPU detected, using CPU only")
            except Exception as e:
                logging.debug(f"GPU detection failed, using CPU: {e}")
            
            # Advanced parameters (may not be supported by all models)
            try:
                advanced_params = [
                    "--numa",  # NUMA systems
                    "--batch-size", "512",
                    "--ubatch-size", "512"
                ]
                cmd.extend(advanced_params)
                logging.info("Added advanced llama.cpp parameters")
            except Exception as e:
                logging.warning(f"Advanced parameters failed: {e}")
            
            if extra_args:
                cmd.extend(extra_args)
                
            logging.info(f"Starting llama.cpp server: {' '.join(cmd)}")
            
            try:
                self.process = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                
                self.current_model = model_name
                
                # Log stderr in background to see llama-server errors
                asyncio.create_task(self._log_stderr())
                
                await self._wait_for_server(timeout=settings.request_timeout)
                
                logging.info(f"llama.cpp server started with model: {model_name}")
                
            except Exception as e:
                logging.error(f"Failed to start llama.cpp server: {e}")
                await self._stop_server_internal()
                raise
        
    async def _log_stderr(self):
        """Log stderr output from llama-server process."""
        if not self.process or not self.process.stderr:
            return
            
        try:
            while True:
                line = await self.process.stderr.readline()
                if not line:
                    break
                error_msg = line.decode().strip()
                if error_msg:
                    import re
                    # Regex pattern to match health check log messages
                    health_check_pattern = re.compile(r"request:\s*GET\s*/health", re.IGNORECASE)
                    if not health_check_pattern.search(error_msg):
                        logging.error(f"llama-server: {error_msg}")
        except Exception as e:
            logging.debug(f"Error reading stderr: {e}")
        
    async def _stop_server_internal(self):
        """Internal method to stop server without lock."""
        if self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                logging.warning("Force killing llama.cpp server")
                self.process.kill()
                await self.process.wait()
            except Exception as e:
                logging.error(f"Error stopping server: {e}")
            finally:
                self.process = None
                self.current_model = None
                
    async def stop_server(self):
        """Stop current llama.cpp server."""
        async with self.lock:
            await self._stop_server_internal()
            
    async def _wait_for_server(self, timeout: int = 120):
        """Wait for server to be ready with adaptive polling."""
        async with httpx.AsyncClient() as client:
            model_loading_detected = False
            consecutive_503s = 0
            
            # Adaptive polling intervals: start fast, then slow down
            intervals = [0.5, 0.5, 1, 1, 2, 2, 3, 3, 5, 5]
            base_interval = 5 
            
            attempt = 0
            total_time = 0
            
            while total_time < timeout:
                if self.process and self.process.returncode is not None:
                    raise RuntimeError(f"llama-server process died with code {self.process.returncode}")
                    
                try:
                    response = await client.get(f"{self.base_url}/health", timeout=3.0)
                    
                    if response.status_code == 200:
                        logging.info(f"llama.cpp server is ready (took {total_time}s)")
                        return
                        
                    elif response.status_code == 503:
                        consecutive_503s += 1
                        
                        if not model_loading_detected:
                            logging.info("llama.cpp server is loading model, please wait...")
                            model_loading_detected = True
                        
                        if consecutive_503s == 5:  # After ~10s of 503s
                            logging.info("Model loading in progress...")
                        elif consecutive_503s % 20 == 0:  # Every ~60s after that
                            logging.info(f"Model still loading... ({total_time}s elapsed)")
                            
                    else:
                        logging.warning(f"Unexpected health response: {response.status_code}")
                        consecutive_503s = 0
                        
                except Exception as e:
                    # Server not responding yet - this is normal during startup
                    if attempt == 0:
                        logging.info("Waiting for llama.cpp server to start...")
                    elif attempt % 15 == 0:  # Log every ~30s
                        logging.debug(f"Still waiting for server... ({total_time}s)")
                        
                # Calculate next sleep interval
                if attempt < len(intervals):
                    sleep_time = intervals[attempt]
                else:
                    sleep_time = base_interval
                    
                await asyncio.sleep(sleep_time)
                total_time += sleep_time
                attempt += 1
                
        raise TimeoutError(f"llama.cpp server failed to start within {timeout}s")
                
    async def is_healthy(self) -> bool:
        """Check if server is healthy."""
        if not self.process or self.process.returncode is not None:
            return False
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.base_url}/health", timeout=5.0)
                # Server is healthy if it responds with 200 (ready) or 503 (loading)
                return response.status_code in [200, 503]
        except (httpx.RequestError, asyncio.TimeoutError) as e:
            logging.debug(f"Health check failed: {e}")
            return False
    
    async def is_ready(self) -> bool:
        """Check if server is ready (model loaded)."""
        if not self.process or self.process.returncode is not None:
            return False
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.base_url}/health", timeout=5.0)
                return response.status_code == 200
        except (httpx.RequestError, asyncio.TimeoutError) as e:
            logging.debug(f"Ready check failed: {e}")
            return False

    async def generate(self, prompt: str, max_tokens: int = 512, temperature: float = 0.3, timeout: float = 60.0) -> str:
        """Generate text using llama.cpp server."""
        if not await self.is_ready():
            raise RuntimeError("Server not ready - model may still be loading")
            
        payload = {
            "prompt": prompt,
            "n_predict": max_tokens,
            "temperature": temperature,
            "top_p": 0.8,
            "top_k": 30,
            "repeat_penalty": 1.3,
            "repeat_last_n": 128,
            "frequency_penalty": 0.5,
            "presence_penalty": 0.3,
            "stop": [
                "</s>", 
                "<|end|>", 
                "<|im_end|>",
                "\n\n\n",
                "\n---",
                "Example:",
                "Note:",
                "Explanation:",
                "Alternative:",
            ],
            "stream": False
        }

        logging.debug(f"Sending request to llama.cpp server: {payload}")

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(f"{self.base_url}/completion", json=payload)
            response.raise_for_status()
            result = response.json()
            return result.get("content", "").strip()

class ModelManager:
    """Manages available models and current selection."""
    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        self.current_model = None
        
    def get_available_models(self) -> List[str]:
        """Get list of available GGUF models."""
        models_path = Path(self.models_dir)
        if not models_path.exists():
            return []
        return [f.name for f in models_path.glob("*.gguf")]
        
    def set_current_model(self, model_name: str):
        """Set current model."""
        available = self.get_available_models()
        if model_name not in available:
            raise ValueError(f"Model {model_name} not found. Available: {available}")
        self.current_model = model_name

class Settings(BaseSettings):
    """
    Application settings loaded from .env file.
    The max_context_tokens setting is used to configure the context size for big DOM inputs.
    Large values (e.g., 32768) may require >32GB RAM and slow down processing.
    """
    models_dir: str = "/app/llm/models"
    llamacpp_binary: str = "/app/llm/llama-server"
    llamacpp_port: int = 8080
    default_model: str = "model.gguf"
    max_tokens: int = 2048
    temperature: float = 0.3
    request_timeout: int = 300
    generation_timeout: int = 90
    large_input_threshold: int = 20000
    max_context_tokens: int = 32768
    gpu_layers: int = 35

    class Config:
        env_file = ".env"
        case_sensitive = False

settings = Settings()

# Initialize managers
model_manager = ModelManager(settings.models_dir)
llama_server = LlamaCppServer(
    binary_path=settings.llamacpp_binary,
    models_dir=settings.models_dir,
    port=settings.llamacpp_port
)

class AIMessage(BaseModel):
    role: str
    content: str

class AIRequest(BaseModel):
    model: str = "default"
    messages: list[AIMessage]
    stream: bool = False
    max_tokens: int = 512
    temperature: float = 0.7
    top_p: float = 0.7
    top_k: int = 50
    frequency_penalty: float = 0.5
    n: int = 1
    response_format: dict = {"type": "text"}
    stop: list = ["null"]

    @model_validator(mode="after") 
    def validate_fields(self):
        if not self.messages:
            raise ValueError('Field "messages" must contain at least one message')
        return self

class ModelRequest(BaseModel):
    model: str

class ModelResponse(BaseModel):
    current_model: Optional[str]
    available_models: List[str]

app = FastAPI(title="XPathAI Backend", description="AI-powered XPath generation with llama.cpp")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["POST", "GET", "PUT"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    """Initialize with default model on startup."""
    try:
        available_models = model_manager.get_available_models()
        if available_models:
            default_model = settings.default_model if settings.default_model in available_models else available_models[0]
            model_manager.set_current_model(default_model)
            await llama_server.start_server(default_model)
            logging.info(f"Started with model: {default_model}")
        else:
            logging.warning("No models found in models directory")
    except Exception as e:
        logging.error(f"Startup error: {e}")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    await llama_server.stop_server()

async def call_llama(prompt: str, model: Optional[str] = None) -> str:
    """Generate text using llama.cpp server."""
    try:
        # Switch model if requested
        if model and model != llama_server.current_model:
            logging.debug(f"Model switch requested: {llama_server.current_model} -> {model}")
            await llama_server.start_server(model)
            model_manager.set_current_model(model)
            
        response = await llama_server.generate(
            prompt=prompt,
            max_tokens=settings.max_tokens,
            temperature=settings.temperature,
            timeout=settings.generation_timeout
        )
        return response
    except Exception as e:
        logging.error(f"llama.cpp error: {str(e)}")
        raise HTTPException(status_code=502, detail="Error calling local LLM")

@app.get("/models", response_model=ModelResponse)
async def get_models():
    """Get available models and current selection."""
    return ModelResponse(
        current_model=model_manager.current_model,
        available_models=model_manager.get_available_models()
    )

@app.put("/models")
async def set_model(request: ModelRequest):
    """Switch to a different model."""
    try:
        await llama_server.start_server(request.model)
        model_manager.set_current_model(request.model)
        return {"message": f"Switched to model: {request.model}"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logging.error(f"Model switch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to switch model")

@app.post("/generate-xpath")
async def generate_xpath(data: AIRequest):
    """Generate XPath using llama.cpp with chat API format."""
    start = time()
    try:
        prompt = ""
        model = data.model
        
        for msg in reversed(data.messages):
            if msg.role == "user" and msg.content:
                prompt = msg.content
                break
        
        if not prompt:
            raise HTTPException(status_code=400, detail="No user message found in request")
        
        prompt_chars = len(prompt)
        prompt_tokens_estimate = prompt_chars // 4
        is_large_input = prompt_chars > settings.large_input_threshold
        
        logging.info(f"Processing {'LARGE' if is_large_input else 'NORMAL'} input: "
                    f"{prompt_chars} chars (~{prompt_tokens_estimate} tokens)")
        logging.debug(f"Requested model: {model or 'current'}")
        
        # Check if input might be too large for fast processing
        if prompt_tokens_estimate > settings.max_context_tokens * 0.9:
            raise HTTPException(
                status_code=413, 
                detail=f"Input too large ({prompt_tokens_estimate} tokens). "
                       f"Maximum supported: {int(settings.max_context_tokens * 0.9)} tokens. "
                       f"Please optimize DOM on extension side."
            )
        
        # Warn if input might be slow
        if prompt_tokens_estimate > settings.max_context_tokens * 0.6:
            logging.warning(f"Large input ({prompt_tokens_estimate} tokens) may take longer to process")
        
        response = await call_llama(prompt, model)
        
        execution_time = time() - start
        
        # Log performance warning if too slow
        if execution_time > 30:
            logging.warning(f"Slow generation: {execution_time:.2f}s for {prompt_chars} chars. "
                          f"Consider DOM optimization.")
        
        logging.info(f"XPath generation completed in {execution_time:.2f}s "
                    f"(input: {prompt_chars} chars)")
        
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": response
                    },
                    "finish_reason": "stop",
                    "index": 0
                }
            ],
            "model": llama_server.current_model,
            "usage": {
                "completion_tokens": len(response.split()),
                "prompt_tokens": prompt_tokens_estimate,
                "total_tokens": len(response.split()) + prompt_tokens_estimate
            },
            "execution_time": execution_time,
            "input_size": prompt_chars,
            "estimated_tokens": prompt_tokens_estimate,
            "large_input": is_large_input,
            "performance_warning": execution_time > 30,
            "backend": "llama.cpp"
        }
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    server_healthy = await llama_server.is_healthy()
    server_ready = await llama_server.is_ready()
    
    # Determine server status
    if server_ready:
        server_status = "ready"
    elif server_healthy:
        server_status = "loading"
    else:
        server_status = "unhealthy"
    
    if llama_server.process:
        process_status = "running" if llama_server.process.returncode is None else "dead"
    else:
        process_status = "stopped"
    
    # Check GPU availability
    gpu_available = False
    gpu_info = "Not detected"
    try:
        import os
        import subprocess
        if os.path.exists("/usr/local/cuda") or os.environ.get("CUDA_VISIBLE_DEVICES"):
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=3, shell=False
            )
            if result.returncode == 0:
                gpu_available = True
                gpu_info = result.stdout.strip()
    except Exception:
        pass
    
    return {
        "status": "ok",
        "server_status": server_status,
        "server_ready": server_ready,
        "process_status": process_status,
        "current_model": model_manager.current_model,
        "available_models": len(model_manager.get_available_models()),
        "server_url": llama_server.base_url,
        "gpu_available": gpu_available,
        "gpu_info": gpu_info,
        "acceleration": "GPU" if gpu_available else "CPU"
    }