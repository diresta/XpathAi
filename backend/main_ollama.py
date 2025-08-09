import httpx
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, model_validator
import logging
from time import time

logging.basicConfig(level=logging.INFO)

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
    messages: list[AIMessage]
    stream: bool = False
    max_tokens: int = 512
    temperature: float = 0.7
    top_p: float = 0.7
    top_k: int = 50
    frequency_penalty: float = 0.5
    n: int = 1
    response_format: dict = {"type": "text"}
    stop: list = ["</s>", "<|end|>", "\n\n"]

    @model_validator(mode="after") 
    def validate_fields(self):
        if not self.messages:
            raise ValueError('Field "messages" must contain at least one message')
        return self

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

logging.info(f"Ollama URL: {OLLAMA_BASE_URL}")

async def call_ollama(prompt: str, model: str = "qwen2.5:3b", *, max_tokens: int = 512, temperature: float = 0.3) -> str:
    async with httpx.AsyncClient(timeout=120.0) as client:
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": float(temperature),
                "top_p": 0.8,
                "top_k": 30,
                "repeat_penalty": 1.3,
                "num_predict": int(max_tokens),
                "stop": ["</s>", "<|end|>", "\n\n\n"]
            }
        }
        
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
        
        response = await call_ollama(prompt_text, data.model, max_tokens=data.max_tokens, temperature=data.temperature)
        execution_time = time() - start
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

@app.get("/models")
async def get_models():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if response.status_code == 200:
                models_data = response.json()
                models = [model["name"] for model in models_data.get("models", [])]
                return {"available_models": models, "backend": "ollama"}
            else:
                return {"available_models": [], "error": "Ollama not available"}
    except Exception as e:
        return {"available_models": [], "error": str(e)}

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

@app.post("/v1/chat/completions")
async def chat_completions(data: AIRequest):
    """OpenAI-compatible Chat API endpoint."""
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
        
        logging.info(f"Chat API request for model: {model}")
        
        response_text = await call_ollama(prompt, model, max_tokens=data.max_tokens, temperature=data.temperature)
        execution_time = time() - start
        
        return {
            "choices": [
                {
                    "message": {
                        "role": "assistant", 
                        "content": response_text
                    },
                    "finish_reason": "stop",
                    "index": 0
                }
            ],
            "model": model,
            "usage": {
                "completion_tokens": len(response_text.split()),
                "prompt_tokens": len(prompt.split()),
                "total_tokens": len(response_text.split()) + len(prompt.split())
            },
            "execution_time": execution_time,
            "backend": "ollama"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Chat API error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat API error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
