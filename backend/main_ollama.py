import httpx
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator
import logging
from time import time

logging.basicConfig(level=logging.INFO)

from typing import Optional, List

app = FastAPI(title="XPathAI Backend - Ollama", description="AI-powered XPath generation with Ollama")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

class AIMessage(BaseModel):
    role: str
    content: str

class AIRequest(BaseModel):
    model: str = "qwen2.5:3b"
    messages: List[AIMessage]
    stream: bool = False
    max_tokens: int = 512
    temperature: float = 0.0
    top_p: float = 1.0
    top_k: int = 0
    frequency_penalty: float = 0.5
    n: int = 1
    response_format: dict = {"type": "text"}
    stop: List[str] = ["</s>", "<|end|>", "\n\n"]

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
    backend: str = "ollama"
    error: Optional[str] = None


OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
logging.info(f"Ollama URL: {OLLAMA_BASE_URL}")

CURRENT_MODEL = None

async def call_ollama(data: AIRequest) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        payload = {
            "model": data.model,
            "prompt": data.messages[0].content,
            "stream": False,
            "options": {
                "temperature": float(data.temperature),
                "top_p": float(data.top_p),
                "top_k": int(data.top_k),
                "repeat_penalty": float(data.frequency_penalty),
                "num_predict": int(data.max_tokens),
                "stop": ["</s>", "<|end|>", "\n\n\n"]
            }
        }
        logging.info(f"call_ollama: model={data.model}, max_tokens={data.max_tokens}, temperature={data.temperature}, prompt_len={len(data.messages[0].content)}, prompt_preview={data.messages[0].content[:1000].replace('\n',' ')}")
        try:
            response = await client.post(f"{OLLAMA_BASE_URL}/api/generate", json=payload)
            response.raise_for_status()
            result = response.json()
            return result.get("response", "").strip()
        except Exception as e:
            logging.error(f"Ollama error: {e}")
            raise HTTPException(status_code=502, detail=f"Ollama error: {str(e)}")

@app.post("/generate-xpath")
async def generate_xpath(data: AIRequest):
    start = time()
    try:
        prompt_text = ""
        for msg in reversed(data.messages):
            if msg.role == "user" and msg.content:
                prompt_text = msg.content
                break
        if not prompt_text:
            raise HTTPException(status_code=400, detail="No user message found in request")

        response = await call_ollama(data)

        execution_time = time() - start
        logging.info(f"/generate-xpath response time: {execution_time:.3f}s")
        logging.info(f"/generate-xpath response: {response}")
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
            "model": data.model,
            "usage": {
                "completion_tokens": len(response.split()),
                "prompt_tokens": len(prompt_text.split()),
                "total_tokens": len(response.split()) + len(prompt_text.split())
            },
            "execution_time": execution_time,
            "backend": "ollama"
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/models", response_model=ModelResponse)
async def get_models():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                models_data = response.json()
                models = [model["name"] for model in models_data.get("models", [])]
                return ModelResponse(current_model=CURRENT_MODEL, available_models=models, backend="ollama")
            else:
                return ModelResponse(current_model=CURRENT_MODEL, available_models=[], backend="ollama", error="Ollama not available")
    except Exception as e:
        return ModelResponse(current_model=CURRENT_MODEL, available_models=[], backend="ollama", error=str(e))

@app.put("/models")
async def set_model(request: ModelRequest):
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                models_data = response.json()
                models = [model["name"] for model in models_data.get("models", [])]
                if request.model not in models:
                    raise HTTPException(status_code=400, detail=f"Model {request.model} not found. Available: {models}")
                global CURRENT_MODEL
                CURRENT_MODEL = request.model
                return {"message": f"Switched to model: {request.model}", "current_model": CURRENT_MODEL}
            else:
                raise HTTPException(status_code=500, detail="Ollama not available")
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Model switch error: {e}")
        raise HTTPException(status_code=500, detail="Failed to switch model")

@app.get("/endpoint-health")
async def endpoint_health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                return {"status": "ok", "ollama_status": "ready", "backend": "ollama", "url": OLLAMA_BASE_URL}
            else:
                return {"status": "error", "ollama_status": "error", "backend": "ollama", "url": OLLAMA_BASE_URL}
    except Exception:
        return {"status": "offline", "ollama_status": "offline", "backend": "ollama", "url": OLLAMA_BASE_URL}

@app.get("/health")
async def health_check():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            ollama_status = "ready" if response.status_code == 200 else "error"
    except Exception:
        ollama_status = "offline"
    
    return {
        "status": "ok",
        "ollama_status": ollama_status,
        "backend": "ollama",
        "url": OLLAMA_BASE_URL
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
