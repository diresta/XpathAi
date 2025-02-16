import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from lxml import html, etree
from lxml.etree import XMLSyntaxError
import logging
from dotenv import load_dotenv
import os

# python -m venv .venv
# .\.venv\Scripts\activate
# pip install -r backend/requirements.txt
# cd .\backend\
# uvicorn main:app --reload --port 8000

logging.basicConfig(level=logging.DEBUG)

app = FastAPI()

load_dotenv()
API_URL = os.getenv("API_URL")
API_KEY = os.getenv("API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ElementData(BaseModel):
    dom: str
    element: dict
    context: dict = None

def clean_dom(dom: str) -> str:
    """Clean the DOM from unwanted elements and attributes."""
    logging.debug(f"Original DOM size: {len(dom)} characters")
    try:
        tree = html.fromstring(dom)
        etree.strip_elements(tree, 'noscript', 'script','meta', 'link', 'style', with_tail=True)
        etree.strip_elements(tree, 'svg', with_tail=True)
        cleaned_dom = etree.tostring(tree, encoding='unicode', method='html')
        logging.debug(f"Cleaned DOM size: {len(cleaned_dom)} characters")

        if len(cleaned_dom) > 100000:
            logging.error(f"Cleaned DOM size exceeds 100KB: {len(cleaned_dom)} characters")
         
        remaining_svgs = tree.xpath('//svg')
        if remaining_svgs:
            logging.warning(f"SVG elements still present in DOM: {len(remaining_svgs)}")
        else:
            logging.debug("All SVG elements successfully removed from DOM")
        
        return cleaned_dom
    except XMLSyntaxError as e:
        raise HTTPException(status_code=422, detail=f"DOM parsing error: {str(e)}")

def generate_ai_prompt(element: dict, dom: str) -> str:
    """Generates a prompt for the AI model."""
#    attrs = {attr['name']: attr['value'] for attr in element.get("attributes", [])}
#    attributes_str = " ".join([f'@{k}="{v}"' for k, v in attrs.items()])
    
    with open("prompt_template.txt", "r", encoding="utf-8") as file:
        template = file.read()
    
    return template.format(element=element.get('html'), dom=dom)

async def call_model_api(prompt: str) -> str:
    """Calls the AI model API to generate XPath."""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = {
        "model": MODEL_NAME,
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
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
    except (httpx.RequestError, IndexError, KeyError) as e:
        logging.error(f"API Error: {str(e)}")
        raise HTTPException(status_code=502, detail="Error calling AI service")

def generate_simple_xpath(element: dict) -> str:
    """simple XPath generationна from element attributes."""
    xpath_parts = [f"//{element['tag'].lower()}"]
    attributes = {attr['name']: attr['value'] for attr in element.get("attributes", [])}

    for name, value in attributes.items():
        if name in ["id", "data", "name", "label", "class"]:
            xpath_parts.append(f"[@{name}='{value}']")
            break
    return "".join(xpath_parts)

@app.post("/generate-xpath")
async def generate_xpath(data: ElementData, use_ai: bool = Query(False, description="Use AI for XPath generation")):
    """Accepts DOM and element data, calls API for XPath generation or uses simple generation."""
    try:
        if not data.dom.strip():
            raise HTTPException(status_code=400, detail="Empty DOM")

        cleaned_dom = clean_dom(data.dom)

        prompt = generate_ai_prompt(data.element, cleaned_dom)
        final_prompt = (prompt[:5000] + '...') if len(prompt) > 500 else prompt
        logging.debug(f"Prompt to deliver: {final_prompt}")

        if not isinstance(use_ai, bool):
            raise HTTPException(status_code=400, detail="Invalid value for use_ai. It must be a boolean.")

        if use_ai:
            try:
                full_xpath = await call_model_api(prompt)
            except HTTPException as e:
                raise e
            logging.debug(f"Generated Response: {full_xpath}")
            
        else:
            try:
                tree = html.fromstring(cleaned_dom)
                elements = tree.xpath(full_xpath)
                if not elements:
                    raise HTTPException(status_code=404, detail="XPath not found in DOM")
            except XMLSyntaxError as e:
                raise HTTPException(status_code=422, detail=f"Invalid XPath syntax: {str(e)}")
            except Exception as e:
                raise HTTPException(status_code=422, detail=f"Invalid XPath syntax: {str(e)}")
            if not elements:
                raise HTTPException(status_code=404, detail="XPath not found in DOM")

        return {"xpath": full_xpath}
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")