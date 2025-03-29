import httpx
import re
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from lxml import html, etree
from lxml.etree import XMLSyntaxError, XPathEvalError
import logging
from functools import lru_cache
from time import time

# python -m venv .venv
# .\.venv\Scripts\activate
# pip install -r backend/requirements.txt
# cd .\backend\
# uvicorn main:app --reload --port 8000

logging.basicConfig(level=logging.DEBUG)

class Settings(BaseSettings):
    api_url: str
    api_key: str
    model_name: str
    max_prompt_length: int = 70000
    request_timeout: int = 60
    prompt_template_file: str = "default_template.txt"
    
    class Config:
        env_file = ".env"
        case_sensitive = False

settings = Settings()

class ElementData(BaseModel):
    dom: str
    element: dict
    context: dict = None
    use_ai: bool = False
    prompt_template: str = None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

def clean_dom(dom: str) -> str:
    """Clean the DOM from unwanted elements and attributes."""
    logging.debug(f"Original DOM size: {len(dom)} characters")

    if len(dom) > 1_000_000: #1MB
        logging.warning(f"Extremely large DOM received ({len(dom)} chars). Truncating.")
        dom = dom[:1_000_000]
        
    try:
        tree = html.fromstring(dom)
    except XMLSyntaxError as e:
        raise HTTPException(status_code=422, detail=f"DOM parsing error: {str(e)}")
    
    for el in tree.xpath("//noscript | //script | //meta | //link | //style | //svg"):
        if el.getparent() is not None:
            el.getparent().remove(el)

    cleaned_dom = etree.tostring(tree, encoding='unicode', method='html')
    logging.debug(f"Cleaned DOM size: {len(cleaned_dom)} characters")

    if len(cleaned_dom) > 100000:
        logging.warning(f"Cleaned DOM size exceeds 100KB!")
    return cleaned_dom

def get_default_template(template_path: str) -> str:
    try:
        with open(template_path, "r", encoding="utf-8") as file:
            return file.read()
    except FileNotFoundError:
        logging.error(f"Template {template_path} not found")
        return None

def generate_prompt(data: ElementData) -> str:
    """Generates a prompt for the AI model."""
    template = ""

    if data.prompt_template and ("{element}" in data.prompt_template or "{dom}" in data.prompt_template):
        template = data.prompt_template
        logging.debug("Using extension provided prompt template content")
    else:
        logging.debug("Using extension provided prompt template content")
        template = get_default_template(settings.prompt_template_file)
        if not template:
            logging.error(f"Default template file {settings.prompt_template_file} not found")
            template = """
            Generate an XPath that uniquely identifies this element:
            {element}
            
            Within this DOM:
            {dom}
            """
            logging.debug("Using emergency built-in template")
    
    cleaned_dom = clean_dom(data.dom)
    prompt = template.format(element=data.element.get('html', ''), dom=cleaned_dom)
    
    # Truncate if needed
    if len(prompt) > settings.max_prompt_length:
        logging.warning(f"Prompt length {len(prompt)} exceeds MAX_PROMPT_LENGTH ({settings.max_prompt_length}). Truncating.")
        final_prompt = prompt[:settings.max_prompt_length]
    else:
        final_prompt = prompt
    
    return final_prompt

@lru_cache()
def get_httpx_client():
    return httpx.AsyncClient(timeout=settings.request_timeout, limits=httpx.Limits(max_connections=20, max_keepalive_connections=10))

async def call_model_api(prompt: str) -> str:
    """Calls the AI model API to generate XPath."""
    headers = {
        "Authorization": f"Bearer {settings.api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = {
        "model": settings.model_name,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "max_tokens": 512,
        "stop": ["null"],
        "temperature": 0.7,
        "top_p": 0.7,
        "top_k": 50,
        "frequency_penalty": 0.5,
        "n": 1,
        "response_format": {"type": "text"}
    }

    try:
        client = get_httpx_client()
        response = await client.post(settings.api_url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"].strip()
    except (httpx.RequestError, IndexError, KeyError) as e:
        logging.error(f"API Error: {str(e)}")
        raise HTTPException(status_code=502, detail="Error calling AI service")

def generate_simple_xpath(element: dict) -> str:
    """simple XPath generation from element attributes."""
    xpath_parts = [f"//{element['tag'].lower()}"]
    attributes = {attr['name']: attr['value'] for attr in element.get("attributes", [])}

    for name, value in attributes.items():
        if name in ["id", "data", "name", "label", "class"]:
            xpath_parts.append(f"[@{name}='{value}']")
            break
    return "".join(xpath_parts)

def clean_response(response: str, dom: str) -> dict:
    result = {
        "primary_xpath": "",
        "alternative_xpath": None,
        "explanation": None
    }
    
    primary_match = re.search(r"1\.?\s*(?:Primary|Main)\s*XPath:?\s*([^\n]+)", response, re.IGNORECASE)
    alt_match = re.search(r"2\.?\s*(?:Alternative|Secondary)\s*XPath:?\s*([^\n]+)", response, re.IGNORECASE)
    explanation_match = re.search(r"3\.?\s*(?:Brief explanation|Explanation|Approach)[^:]*:?\s*(.*?)(?=\n\d\.|\Z)", response, re.DOTALL | re.IGNORECASE)
    
    if primary_match:
        primary_xpath = primary_match.group(1).strip().strip('`').strip()
        result["primary_xpath"] = primary_xpath
        
        if alt_match:
            alt_xpath = alt_match.group(1).strip().strip('`').strip()
            result["alternative_xpath"] = alt_xpath
        
        if explanation_match:
            explanation = explanation_match.group(1).strip()
            result["explanation"] = explanation
    else:
        lines = response.replace("```", "").splitlines()
        for line in lines:
            line = line.strip()
            if line.startswith("//") or line.startswith(".//"):
                result["primary_xpath"] = line
                break
            elif "**XPath:**" in line:
                raw_xpath = line.split("**XPath:**", 1)[1].strip().strip("`")
                result["primary_xpath"] = raw_xpath
                break
        if not result["primary_xpath"]:
            result["primary_xpath"] = response.strip()
    
    tree = html.fromstring(dom)
    try:
        elements = tree.xpath(result["primary_xpath"])
        if not elements:
            logging.warning(f"Primary XPath not found in DOM: {result['primary_xpath']}")
    except XPathEvalError as e:
        logging.error(f"Invalid primary XPath: {str(e)}")
    
    if result["alternative_xpath"]:
        try:
            elements = tree.xpath(result["alternative_xpath"])
            if not elements:
                logging.warning(f"Alternative XPath not found in DOM: {result['alternative_xpath']}")
        except XPathEvalError as e:
            logging.error(f"Invalid alternative XPath: {str(e)}")
    
    logging.debug(f"Parsed XPaths - Primary: {result['primary_xpath']}, " + 
                  f"Alternative: {result['alternative_xpath']}")
    
    return result

@app.post("/generate-xpath")
async def generate_xpath(data: ElementData):
    """Accepts DOM and element data, calls API for XPath generation or uses simple generation."""
    start = time()
    try:
        if not data.dom.strip():
            raise HTTPException(status_code=400, detail="Empty DOM")

        prompt = generate_prompt(data)
        logging.debug(f"Prompt to deliver {len(prompt)} context, first 5000: {prompt[:5000]}")

        use_ai = data.use_ai
        if not isinstance(use_ai, bool):
            raise HTTPException(status_code=400, detail="Invalid value for use_ai. It must be a boolean.")
        
        if use_ai:
            logging.debug(f"Calling API at {settings.api_url} with model {settings.model_name}")
            try:
                response = await call_model_api(prompt)
            except HTTPException as e:
                raise e
            logging.debug(f"Generated Response: {response}")
            xpath_data = clean_response(response, data.dom)
            
            execution_time = time() - start
            logging.info(f"XPath generation completed in {execution_time:.2f}s (AI={use_ai})")
            
            return {
                "response": response,
                "xpath": xpath_data["primary_xpath"],
                "alternative_xpath": xpath_data["alternative_xpath"],
                "explanation": xpath_data["explanation"]
            }
        else:
            logging.debug("Using simple XPath generation")
            xpath = generate_simple_xpath(data.element)
            
            execution_time = time() - start
            logging.info(f"XPath generation completed in {execution_time:.2f}s (AI={use_ai})")
            
            return {
                "response": "",
                "xpath": xpath,
                "alternative_xpath": None,
                "explanation": None
            }
    
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)} | element: {data.element} | use_ai: {use_ai}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok"}