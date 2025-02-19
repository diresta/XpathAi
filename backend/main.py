import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from lxml import html, etree
from lxml.etree import XMLSyntaxError, XPathEvalError
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
MAX_PROMPT_LENGTH = int(os.getenv("MAX_PROMPT_LENGTH", "70000"))

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
    use_ai: bool = False

def clean_dom(dom: str) -> str:
    """Clean the DOM from unwanted elements and attributes."""
    logging.debug(f"Original DOM size: {len(dom)} characters")
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

def generate_prompt(element: dict, dom: str) -> str:
    """Generates a prompt for the AI model."""
#    attrs = {attr['name']: attr['value'] for attr in element.get("attributes", [])}
#    attributes_str = " ".join([f'@{k}="{v}"' for k, v in attrs.items()])
    
    with open("prompt_template.txt", "r", encoding="utf-8") as file:
        template = file.read()
    prompt = template.format(element=element.get('html'), dom=dom)

    if len(prompt) > MAX_PROMPT_LENGTH:
        logging.warning(f"Prompt length {len(prompt)} exceeds MAX_PROMPT_LENGTH ({MAX_PROMPT_LENGTH}). Truncating.")
        final_prompt = prompt[:MAX_PROMPT_LENGTH]

    return final_prompt

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
    """simple XPath generation from element attributes."""
    xpath_parts = [f"//{element['tag'].lower()}"]
    attributes = {attr['name']: attr['value'] for attr in element.get("attributes", [])}

    for name, value in attributes.items():
        if name in ["id", "data", "name", "label", "class"]:
            xpath_parts.append(f"[@{name}='{value}']")
            break
    return "".join(xpath_parts)

def clean_response(response: str, cleaned_dom: str) -> str:
    """Return only the XPath from the response, removing any code fences and explanations."""
    lines = response.replace("```", "").splitlines()
    cleaned_xpath = ""
    for line in lines:
        line = line.strip()
        if line.startswith("//") or line.startswith(".//"):
            cleaned_xpath = line
            break
        elif "**XPath:**" in line:
            raw_xpath = line.split("**XPath:**", 1)[1].strip().strip("`")
            cleaned_xpath = raw_xpath
            break
    if not cleaned_xpath:
        cleaned_xpath = response.strip()

    tree = html.fromstring(cleaned_dom)
    try:
        elements = tree.xpath(cleaned_xpath)
        if not elements:
            logging.error("XPath not found in DOM", exc_info=True)
    except XPathEvalError as e:
        logging.error("Invalid XPath but whatever", exc_info=True)

    logging.debug(f"Cleaned XPath: {cleaned_xpath}")

    return cleaned_xpath

@app.post("/generate-xpath")
async def generate_xpath(data: ElementData):
    """Accepts DOM and element data, calls API for XPath generation or uses simple generation."""
    try:
        if not data.dom.strip():
            raise HTTPException(status_code=400, detail="Empty DOM")

        cleaned_dom = clean_dom(data.dom)
        use_ai = data.use_ai

        if not isinstance(use_ai, bool):
            raise HTTPException(status_code=400, detail="Invalid value for use_ai. It must be a boolean.")
        
        prompt = generate_prompt(data.element, cleaned_dom)
        logging.debug(f"Prompt to deliver: {len(prompt)} context, {prompt}")

        response = ""
        if use_ai:
            try:
                response = await call_model_api(prompt)
            except HTTPException as e:
                raise e
            logging.debug(f"Generated Response: {response}")
            xpath = clean_response(response, cleaned_dom)   
        else:
            xpath = generate_simple_xpath(data.element)

        logging.debug(f"Done! Xpath: {xpath}")

        return {"response": response, "xpath": xpath}
    
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)} | element: {data.element} | use_ai: {use_ai}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")