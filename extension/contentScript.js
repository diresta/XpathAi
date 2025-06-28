// contentScript.js - Runs in the context of web pages

let highlightedElement = null;
let isSelectionActive = false;
let isInitialized = false;
let useAIForNextGeneration = false;

function setupHighlightStyles() {
    if (!document.getElementById('xpath-helper-highlight-style')) {
        const highlightStyle = document.createElement('style');
        highlightStyle.id = 'xpath-helper-highlight-style';
        highlightStyle.textContent = `
            .xpath-helper-highlight {
                outline: 2px solid #f00 !important;
                box-shadow: 0 0 5px rgba(0, 132, 255, 0.5) !important;
                background: rgba(0, 38, 255, 0.1) !important;
                cursor: crosshair !important;
            }
            .xpath-helper-duplicate-highlight {
                outline: 2px solid #ffA500 !important;
                background: rgba(255, 165, 0, 0.2) !important;
                transition: all 0.3s ease-in-out;
            }
        `;
        document.head.appendChild(highlightStyle);
    }
}

function init() {
    if (isInitialized) {
        return;
    }
    
    isInitialized = true;
    setupHighlightStyles();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch(message.type) 
        {
            case "activateSelection":
                useAIForNextGeneration = message.useAI;
                activateSelection();
                sendResponse({success: true, message: "Selection activated"});
                break;
                
            case "checkXpathUniqueness":
                try {
                    if (!message.xpath.startsWith('//')) {
                        chrome.storage.local.set({ 
                            duplicates: 'N/A',
                            status: 'Проверка невозможна: в поле не XPath'
                        });
                        return;
                    }
                    const count = document.evaluate(`count(${message.xpath})`, document, null, XPathResult.NUMBER_TYPE, null).numberValue;
                    chrome.storage.local.set({ 
                        duplicates: count,
                        status: count === 1 ? 'Дублей нет' : 'Дубли есть'
                    });
                } catch (error) {
                    console.error('Error evaluating XPath:', error);
                }
                break;
            case "highlightDuplicates":
                highlightDuplicateElements(message.xpath);
                break;
        }
    });
}

let highlightedDuplicates = [];

function clearDuplicateHighlights() {
    highlightedDuplicates.forEach(el => el.classList.remove('xpath-helper-duplicate-highlight'));
    highlightedDuplicates = [];
}

function highlightDuplicateElements(xpath) {
    clearDuplicateHighlights();
    try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
            const element = result.snapshotItem(i);
            element.classList.add('xpath-helper-duplicate-highlight');
            highlightedDuplicates.push(element);
        }
        setTimeout(clearDuplicateHighlights, 5000);
    } catch (error) {
        console.error('Error highlighting duplicate elements:', error);
    }
}

function cleanDOMForPrompt(domString) {
    if (typeof domString !== 'string' || domString.trim() === '') {
        console.error("XPath AI: Invalid DOM string provided for cleaning.");
        return "";
    }
    console.time("XPath AI: DOM Cleaning");
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(domString, "text/html");

        const tagsToRemove = ['script', 'style', 'noscript', 'meta', 'link', 'svg', 'iframe', 'embed', 'object', 'canvas', 'audio', 'video'];
        tagsToRemove.forEach(tagName => {
            Array.from(doc.getElementsByTagName(tagName)).forEach(el => el.remove());
        });

        const commentIterator = doc.createNodeIterator(doc.documentElement, NodeFilter.SHOW_COMMENT);
        let currentNode;
        while (currentNode = commentIterator.nextNode()) {
            currentNode.remove();
        }

        let cleanedHtml = doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
        cleanedHtml = cleanedHtml.replace(/\s+/g, ' ').trim(); // Compact whitespace
        
        console.debug(`XPath AI: DOM cleaned. Original size: ${domString.length}, Cleaned size: ${cleanedHtml.length}`);
        console.timeEnd("XPath AI: DOM Cleaning");
        return cleanedHtml;

    } catch (e) {
        console.error("XPath AI: DOMParser cleaning failed, using basic regex cleaning:", e);
        let cleaned = domString
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
            .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "") // Remove SVG tags
            .replace(/<meta\b[^>]*>/gi, "")    // Remove meta tags
            .replace(/<link\b[^>]*>/gi, "");   // Remove link tags
        
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        console.timeEnd("XPath AI: DOM Cleaning");
        console.debug(`XPath AI: DOM basic regex cleaned. Original size: ${domString.length}, Cleaned size: ${cleaned.length}`);
        return cleaned;
    }
}

function activateSelection() {
    if (isSelectionActive) {
        return;
    }
    
    console.log("Activating selection");
    isSelectionActive = true;
    
    // Use capture phase for all events
    const captureOptions = true;
    document.addEventListener('mouseover', handleMouseOver, captureOptions);
    document.addEventListener('mouseout', handleMouseOut, captureOptions);
    document.addEventListener('click', handleClick, captureOptions);
}

function deactivateSelection() {
    if (!isSelectionActive) {
        return;
    }
    
    console.log("Deactivating selection");
    isSelectionActive = false;
    removeHighlight();
    
    const captureOptions = true;
    document.removeEventListener('mouseover', handleMouseOver, captureOptions);
    document.removeEventListener('mouseout', handleMouseOut, captureOptions);
    document.removeEventListener('click', handleClick, captureOptions);
}

function highlightElement(element) {
    if (highlightedElement) {
        highlightedElement.classList.remove('xpath-helper-highlight');
    }
    highlightedElement = element;
    highlightedElement.classList.add('xpath-helper-highlight');
}

function removeHighlight() {
    if (highlightedElement) {
        highlightedElement.classList.remove('xpath-helper-highlight');
        highlightedElement = null;
    }
}

function handleMouseOver(e) {
    if (!isSelectionActive) {
        return;
    }
    highlightElement(e.target);
}

function handleMouseOut(e) {
    if (!isSelectionActive || !highlightedElement) {
        return;
    }
    if (e.target === highlightedElement) {
        removeHighlight();
    }
}

function handleClick(e) {
    if (!isSelectionActive) {
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();

    const element = e.target;
    const hadHighlight = element.classList.contains('xpath-helper-highlight');


    if (hadHighlight) {
        element.classList.remove('xpath-helper-highlight');
    }

    try {
        const cleanedDom = cleanDOMForPrompt(document.documentElement.outerHTML);

        chrome.runtime.sendMessage({
            action: "generateXPath",
            data: {
                use_ai: useAIForNextGeneration,
                dom: cleanedDom,
                element: {
                    x: e.clientX,
                    y: e.clientY,
                    html: element.outerHTML,
                    tag: element.tagName,
                    attributes: Array.from(element.attributes).map(attr => ({
                        name: attr.name,
                        value: attr.value
                    }))
                }
            }
        });
    } catch (error) {
        console.error("Error sending message: ", error);
    } finally {
        if (hadHighlight) {
            element.classList.add('xpath-helper-highlight');
        }
        
        deactivateSelection();
    }
}

function evaluateXpathCount(xpath) {
    try {
        const snapshot = document.evaluate(
            xpath, 
            document, 
            null, 
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, 
            null
        );
        return snapshot.snapshotLength;
    } catch (error) {
        console.error("Error evaluating XPath: ", error);
        return -1;
    }
}

setupHighlightStyles();
init();