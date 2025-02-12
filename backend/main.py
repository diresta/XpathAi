import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from lxml import html, etree
from lxml.etree import XMLSyntaxError
import logging

# python -m venv .venv
# .\.venv\Scripts\activate
# pip install -r backend/requirements.txt
# cd .\backend\
# uvicorn main:app --reload --port 8000

logging.basicConfig(level=logging.DEBUG)

app = FastAPI()

API_URL = ""
API_KEY = ""
MODEL_NAME = ""

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
    """Удаляет тяжелые неполезные элементы из DOM."""
    try:
        tree = html.fromstring(dom)
        etree.strip_elements(tree, 'script', 'style', 'svg')
        return etree.tostring(tree, encoding='unicode', method='html')
    except XMLSyntaxError as e:
        raise HTTPException(status_code=422, detail=f"DOM parsing error: {str(e)}")

async def generate_ai_prompt(element: dict, dom: str) -> str:
    """Формирует промпт согласно требованиям к XPath и полученным атрибутам."""
    attrs = {attr['name']: attr['value'] for attr in element.get("attributes", [])}
    attributes_str = " ".join([f'@{k}="{v}"' for k, v in attrs.items()])
    return (
        f"Generate stable XPath for the following HTML element within the given DOM. "
        f"Rules:\n"
        "1. Prefer unique attributes: id, data-id, class, alt, title\n"
        "2. Use indexes only when necessary\n"
        "3. Avoid numbers and ids in attribute values\n"
        "4. Avoid fragile class combinations\n"
        "5. Consider parent hierarchy carefully\n\n"
        "6. Check if the element exist in the DOM\n\n"
        "7. Check if the element is unique in the DOM\n\n"
        f"HTML Element: <{element['tag']} {attributes_str}>\n\n"
        f"DOM:\n{dom}\n\n"
        "Return ONLY XPath without explanations."
    )

async def call_model_api(prompt: str) -> str:
    """Отправляет запрос к API, возвращает сгенерированный ответ как строку."""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": "You are a helpful stable XPath finder assistant"},
            {"role": "user", "content": prompt}
            ],
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
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(API_URL, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
    except (httpx.RequestError, IndexError, KeyError) as e:
        logging.error(f"API Error: {str(e)}")
        raise HTTPException(status_code=502, detail="Error calling AI service")

def generate_simple_xpath(element: dict) -> str:
    """Простая генерация XPath на основе атрибутов элемента."""
    xpath_parts = [f"//{element['tag'].lower()}"]
    attributes = {attr['name']: attr['value'] for attr in element.get("attributes", [])}

    for name, value in attributes.items():
        if name in ["id", "data", "name", "label", "class"]:
            xpath_parts.append(f"[@{name}='{value}']")
            break
    return "".join(xpath_parts)

@app.post("/generate-xpath")
async def generate_xpath(data: ElementData, use_ai: bool = Query(True, description="Use AI for XPath generation")):
    """Принимает DOM и данные элемента, вызывает DeepSeek API для генерации XPath или использует простую генерацию."""
    try:
        if not data.dom.strip():
            raise HTTPException(status_code=400, detail="Empty DOM")
        if not data.element.get("tag"):
            raise HTTPException(status_code=400, detail="Missing element tag")

        try:
            tree = html.fromstring(data.dom)
        except XMLSyntaxError as e:
            raise HTTPException(status_code=422, detail=f"DOM parsing error: {str(e)}")

        cleaned_dom = clean_dom(data.dom)

        if use_ai:
            prompt = await generate_ai_prompt(data.element, cleaned_dom)
            logging.debug(f"Generated prompt: {prompt}")

            try:
                full_xpath = await call_model_api(prompt)
            except HTTPException as e:
                raise e

            logging.debug(f"Generated Response: {full_xpath}")

            if not full_xpath.startswith('/'):
                raise HTTPException(status_code=422, detail="Invalid XPath format")
            try:
                elements = tree.xpath(full_xpath)
            except Exception as e:
                raise HTTPException(status_code=422, detail=f"Invalid XPath syntax: {str(e)}")

            if not elements:
                raise HTTPException(status_code=404, detail="XPath not found in DOM")
        else:
            full_xpath = generate_simple_xpath(data.element)
            logging.debug(f"Generated simple XPath: {full_xpath}")

            try:
                elements = tree.xpath(full_xpath)
            except Exception as e:
                raise HTTPException(status_code=422, detail=f"Invalid XPath syntax: {str(e)}")

            if not elements:
                raise HTTPException(status_code=404, detail="XPath not found in DOM")

        return {"xpath": full_xpath}
    except HTTPException as he:
        raise he
    except Exception as e:
        logging.error(f"Unexpected error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")