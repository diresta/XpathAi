import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError, model_validator
from pydantic_settings import BaseSettings
import logging
from time import time
from typing import Optional

logging.basicConfig(level=logging.DEBUG)

class LlamaFileProcess:
    """Manages a persistent llamafile subprocess for LLM inference via stdin/stdout."""
    def __init__(self, llamafile_path: str, model_path: str, extra_args: Optional[list] = None):
        self.llamafile_path = llamafile_path
        self.model_path = model_path
        self.extra_args = extra_args or []
        self.process = None
        self.lock = asyncio.Lock()
        self.loop = asyncio.get_event_loop()

    async def start(self):
        if self.process is not None:
            return
        cmd = [self.llamafile_path, self.model_path] + self.extra_args
        self.process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        logging.info(f"Started llamafile: {' '.join(cmd)}")

    async def ask(self, prompt: str, stop: str = None, max_lines: int = 512) -> str:
        async with self.lock:
            if self.process is None:
                await self.start()
            # Format prompt for llamafile (adjust as needed for your llamafile build)
            prompt_data = prompt.strip().replace("\n", " ")
            prompt_data += "\n"
            self.process.stdin.write(prompt_data.encode("utf-8"))
            await self.process.stdin.drain()
            # Read until stop or max_lines or EOF
            output = b""
            lines_read = 0
            while lines_read < max_lines:
                line = await self.process.stdout.readline()
                if not line:
                    break
                output += line
                lines_read += 1
                if stop and stop in line.decode("utf-8"):
                    break
            return output.decode("utf-8").strip()

# Settings: add llamafile_path and llamafile_model_path
class Settings(BaseSettings):
    max_prompt_length: int = 70000
    request_timeout: int = 60
    prompt_template_file: str = "default_template.txt"
    llamafile_path: str = "llamafile.exe"  # path to llamafile binary
    llamafile_model_path: str = "model.gguf"  # path to model file
    llamafile_extra_args: Optional[str] = None  # e.g. "--temp 0.7"
    class Config:
        env_file = ".env"
        case_sensitive = False

settings = Settings()

llama = LlamaFileProcess(
    llamafile_path=settings.llamafile_path,
    model_path=settings.llamafile_model_path,
    extra_args=settings.llamafile_extra_args.split() if settings.llamafile_extra_args else []
)

class ElementData(BaseModel):
    dom: str
    element: dict
    prompt: Optional[str] = None

    @model_validator(mode="after")
    def validate_fields(self):
        if not self.dom or not isinstance(self.dom, str) or not self.dom.strip():
            raise ValueError('Field "dom" must be a non-empty string')
        if not self.element or not isinstance(self.element, dict) or not self.element.get('tag'):
            raise ValueError('Field "element" must be a dict with at least a "tag" key')
        if not self.prompt or not isinstance(self.prompt, str) or not self.prompt.strip():
            raise ValueError('Field "prompt" must be a non-empty string')
        return self

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

async def call_llamafile(prompt: str) -> str:
    """Calls the local llamafile LLM via stdin/stdout."""
    try:
        response = await llama.ask(prompt)
        return response
    except Exception as e:
        logging.error(f"llamafile error: {str(e)}")
        raise HTTPException(status_code=502, detail="Error calling local LLM")

@app.post("/generate-xpath")
async def generate_xpath(data: ElementData):
    """Accepts DOM and element data, calls llamafile for XPath generation or uses simple generation."""
    start = time()
    try:
        prompt = data.prompt
        logging.debug(f"Prompt to deliver {len(prompt)} context, first 5000: {prompt[:5000]}")
        logging.debug(f"Calling llamafile at {settings.llamafile_path} with model {settings.llamafile_model_path}")
        try:
            response = await call_llamafile(prompt)
        except HTTPException as e:
            raise e
        logging.info(f"llamafile response: {response}")
        execution_time = time() - start
        logging.info(f"XPath generation completed in {execution_time:.2f}s")
        return {"response": response}
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok"}