from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from lxml import html
from lxml.etree import XMLSyntaxError
import logging

# python -m venv .venv
# .\.venv\Scripts\activate
# pip install -r backend/requirements.txt
# cd .\backend\
# uvicorn main:app --reload --port 8000

logging.basicConfig(level=logging.DEBUG)

app = FastAPI()

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

@app.get("/generate-xpath")
@app.post("/generate-xpath")
async def generate_xpath(data: ElementData):
    try:
        if not data.dom.strip():
            logging.error("Пустой DOM", exc_info=True)
            raise HTTPException(status_code=400, detail="Пустой DOM")

        if not data.element.get("tag"):
            logging.error("Отсутствует тег элемента", exc_info=True)
            raise HTTPException(status_code=400, detail="Отсутствует тег элемента")

        try:
            tree = html.fromstring(data.dom)
        except XMLSyntaxError as e:
            logging.error(f"Ошибка парсинга DOM: {str(e)}", exc_info=True)
            raise HTTPException(status_code=422, detail=f"Ошибка парсинга DOM: {str(e)}")

        #Генерация XPath
        xpath_parts = [f"//{data.element['tag'].lower()}"]
        attributes = data.element.get("attributes", [])

        for attr in attributes:
            if attr["name"] in ["id", "data", "name", "label", "class"]:
                xpath_parts.append(f"[@{attr['name']}='{attr['value']}']")
                break
        else:
            if attributes:
                attr = attributes[0]
                xpath_parts.append(f"[@{attr['name']}='{attr['value']}']")
            else:
                logging.error("Нет доступных атрибутов", exc_info=True)
                raise HTTPException(status_code=404, detail="Нет доступных атрибутов")

        full_xpath = "".join(xpath_parts)
        
        logging.debug(f"Получен xpath: {full_xpath}")

        if not tree.xpath(full_xpath):
            logging.error("XPath не найден в DOM!", exc_info=True)
            raise HTTPException(status_code=404, detail="XPath не найден в DOM!")
        
        return {"xpath": full_xpath}

    except HTTPException as he:
        raise he
    except Exception as e:
        logging.error(f"Ошибка: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")
    