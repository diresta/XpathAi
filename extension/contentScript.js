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
        switch(message.action) 
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

function createContextualDOM(targetElement, ancestorDepth = 10, descendantDepth = 10) {
    console.time("XPath AI: Contextual DOM Creation");
    
    try {
        const pageStructure = createPageSkeleton();
        const detailedContext = createDetailedContext(targetElement, Math.min(ancestorDepth, 5), Math.min(descendantDepth, 3));
        const contextualHTML = combineContexts(pageStructure, detailedContext, targetElement);
        const documentedHTML = addContextualComments(contextualHTML, targetElement);
        
        console.debug(`XPath AI: Enhanced contextual DOM created. Target: ${targetElement.tagName}, Size: ${documentedHTML.length}`);
        console.timeEnd("XPath AI: Contextual DOM Creation");
        
        return documentedHTML;
        
    } catch (error) {
        console.error("XPath AI: Error creating contextual DOM:", error);
        console.timeEnd("XPath AI: Contextual DOM Creation");
        return createFallbackContext(targetElement);
    }
}

function cloneDescendants(sourceElement, targetElement, maxDepth, currentDepth = 0) {
    if (currentDepth >= maxDepth) return;
    
    Array.from(sourceElement.children).forEach(child => {
        if (shouldSkipElement(child)) return;
        
        const childClone = optimizeContextElement(child, currentDepth);
        childClone.setAttribute('data-descendant-level', currentDepth + 1);
        
        if (currentDepth + 1 < maxDepth) {
            cloneDescendants(child, childClone, maxDepth, currentDepth + 1);
        } else if (child.children.length > 0) {
            const placeholder = document.createElement('span');
            placeholder.textContent = `[${child.children.length} more children...]`;
            placeholder.setAttribute('data-placeholder', 'true');
            childClone.appendChild(placeholder);
        }
        
        targetElement.appendChild(childClone);
    });
}

function optimizeContextElement(element, level) {
    const clone = element.cloneNode(false);
    const importance = getElementImportance(element);
    
    if (level > 2 && importance === 1) {
        const keyAttrs = ['id', 'class', 'data-testid', 'role', 'aria-label'];
        Array.from(clone.attributes).forEach(attr => {
            if (!keyAttrs.includes(attr.name) && !attr.name.startsWith('data-')) {
                clone.removeAttribute(attr.name);
            }
        });
    }
    
    return clone;
}

function addSiblingContext(targetElement, container, targetClone) {
    const siblings = Array.from(targetElement.parentElement?.children || []);
    const targetIndex = siblings.indexOf(targetElement);
    
    const siblingRange = 2;
           element.classList.contains('xpath-helper-highlight') ||
           element.classList.contains('xpath-helper-duplicate-highlight');
}

function getElementImportance(element) {
    const tagName = element.tagName.toLowerCase();
    const hasId = element.hasAttribute('id');
    const hasClass = element.hasAttribute('class');
    const hasDataAttrs = Array.from(element.attributes).some(attr => attr.name.startsWith('data-'));
    
    if (hasId || ['form', 'table', 'nav', 'header', 'footer', 'main', 'article', 'section'].includes(tagName)) {
        return 3;
    }

    if (hasClass || hasDataAttrs || ['div', 'ul', 'ol', 'li', 'button', 'input', 'select', 'textarea'].includes(tagName)) {
        return 2;
    }

    return 1;
}


function cleanElementHTML(element) {
    let html = element.innerHTML;
    
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    html = html.replace(/\s+/g, ' ').trim();
    html = html.replace(/^\s*$/gm, '');
    
    return html;
}

function createFallbackContext(targetElement) {
    try {
        const parent = targetElement.parentElement;
        if (parent) {
            const parentClone = parent.cloneNode(false);
            const targetClone = targetElement.cloneNode(true);
            parentClone.appendChild(targetClone);
            return cleanElementHTML(parentClone);
        } else {
            return cleanElementHTML(targetElement.cloneNode(true));
        }
    } catch (error) {
        console.error("XPath AI: Fallback context creation failed:", error);
        return targetElement.outerHTML;
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
        const contextualDom = createContextualDOM(element);
        const cleanedDOM = cleanDOMForPrompt(document.documentElement.outerHTML);
        chrome.runtime.sendMessage({
            action: "generateXPath",
            data: {
                use_ai: useAIForNextGeneration,
                dom: cleanedDOM,
                conntext: contextualDom,
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

function addContextualComments(html, targetElement) {
    // Добавляем полезную информацию для AI в виде комментариев
    const targetInfo = {
        tag: targetElement.tagName.toLowerCase(),
        id: targetElement.id || 'none',
        classes: targetElement.className || 'none',
        text: targetElement.textContent?.trim().substring(0, 100) || 'none',
        visible: isElementVisible(targetElement),
        position: getElementPositionInfo(targetElement),
        xpath_hints: generateXPathHints(targetElement)
    };
    
    const contextInfo = `
<!-- XPath AI Context Information:
Target Element: ${targetInfo.tag}
ID: ${targetInfo.id}
Classes: ${targetInfo.classes}
Text Preview: "${targetInfo.text}"
Visible: ${targetInfo.visible}
Position: ${targetInfo.position}
XPath Hints: ${targetInfo.xpath_hints}
Context Structure: This DOM contains both page structure overview and detailed local context
-->`;

    return contextInfo + '\n' + html;
}

function generateXPathHints(element) {
    const hints = [];
    
    if (element.id) {
        hints.push(`id="${element.id}"`);
    }
    
    if (element.className) {
        const classes = element.className.split(' ').filter(c => c.trim());
        if (classes.length > 0) {
            hints.push(`classes=[${classes.slice(0, 3).join(', ')}]`);
        }
    }
    
    // Проверяем data-атрибуты
    const dataAttrs = Array.from(element.attributes).filter(attr => attr.name.startsWith('data-'));
    if (dataAttrs.length > 0) {
        hints.push(`data-attrs=[${dataAttrs.slice(0, 2).map(a => a.name).join(', ')}]`);
    }
    
    // Проверяем текстовое содержимое
    if (element.textContent && element.textContent.trim()) {
        hints.push(`has-text="${element.textContent.trim().substring(0, 30)}"`);
    }
    
    // Проверяем уникальность в контексте родителя
    const parent = element.parentElement;
    if (parent) {
        const siblings = Array.from(parent.children).filter(el => el.tagName === element.tagName);
        hints.push(`sibling-count=${siblings.length}`);
        hints.push(`sibling-index=${siblings.indexOf(element) + 1}`);
    }
    
    return hints.length > 0 ? hints.join(', ') : 'none';
}

function isElementVisible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           element.offsetWidth > 0 && 
           element.offsetHeight > 0;
}

function getElementPosition(element) {
    const rect = element.getBoundingClientRect();
    return `top:${Math.round(rect.top)}, left:${Math.round(rect.left)}, width:${Math.round(rect.width)}, height:${Math.round(rect.height)}`;
}

function createPageSkeleton() {
    // Создаем упрощенную структуру страницы, сохраняя важные элементы
    const skeleton = document.createElement('div');
    skeleton.setAttribute('data-page-skeleton', 'true');
    
    // Добавляем основные структурные элементы
    const structuralSelectors = [
        'header', 'nav', 'main', 'article', 'section', 'aside', 'footer',
        '[id]', // Все элементы с ID
        '[data-testid]', // Элементы для тестирования
        'form', 'table', 
        '.navbar', '.header', '.footer', '.sidebar', '.content', '.main'
    ];
    
    const importantElements = new Set();
    structuralSelectors.forEach(selector => {
        try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                if (!shouldSkipElement(el)) {
                    importantElements.add(el);
                }
            });
        } catch (e) {
            // Игнорируем ошибки в селекторах
        }
    });
    
    // Создаем минимальную структуру
    Array.from(importantElements).forEach(el => {
        const clone = el.cloneNode(false); // Только сам элемент, без детей
        
        // Добавляем информацию о расположении
        try {
            const rect = el.getBoundingClientRect();
            clone.setAttribute('data-position', `${Math.round(rect.top)},${Math.round(rect.left)}`);
            clone.setAttribute('data-size', `${Math.round(rect.width)}x${Math.round(rect.height)}`);
        } catch (e) {
            // Игнорируем ошибки получения позиции
        }
        
        clone.setAttribute('data-skeleton-element', 'true');
        
        // Добавляем заглушку для содержимого
        if (el.children.length > 0) {
            const placeholder = document.createElement('span');
            placeholder.textContent = `[${el.children.length} children]`;
            placeholder.setAttribute('data-placeholder', 'true');
            clone.appendChild(placeholder);
        }
        
        skeleton.appendChild(clone);
    });
    
    return skeleton.innerHTML;
}

function createDetailedContext(targetElement, ancestorDepth, descendantDepth) {
    // Создаем детальную структуру вокруг целевого элемента
    const ancestors = [];
    let currentAncestor = targetElement.parentElement;
    let depth = 0;
    
    // Собираем всю цепочку предков до body или html
    while (currentAncestor && currentAncestor !== document.body && currentAncestor !== document.documentElement) {
        ancestors.unshift({
            element: currentAncestor,
            depth: depth,
            isInFocus: depth < ancestorDepth // В фокусе только ближайшие предки
        });
        currentAncestor = currentAncestor.parentElement;
        depth++;
    }
    
    // Создаем контейнер для детального контекста
    const contextContainer = document.createElement('div');
    contextContainer.setAttribute('data-detailed-context', 'true');
    
    // Строим иерархию предков
    let currentContainer = contextContainer;
    ancestors.forEach((ancestorInfo, index) => {
        const { element, isInFocus } = ancestorInfo;
        const ancestorClone = element.cloneNode(false);
        
        if (isInFocus) {
            // Для ближайших предков копируем все атрибуты
            Array.from(element.attributes).forEach(attr => {
                ancestorClone.setAttribute(attr.name, attr.value);
            });
            ancestorClone.setAttribute('data-ancestor-level', ancestorDepth - index);
        } else {
            // Для дальних предков сохраняем только ключевые атрибуты
            const keyAttrs = ['id', 'class', 'data-testid', 'role'];
            keyAttrs.forEach(attrName => {
                if (element.hasAttribute(attrName)) {
                    ancestorClone.setAttribute(attrName, element.getAttribute(attrName));
                }
            });
            ancestorClone.setAttribute('data-ancestor-distant', 'true');
        }
        
        currentContainer.appendChild(ancestorClone);
        currentContainer = ancestorClone;
    });
    
    // Добавляем целевой элемент
    const targetClone = targetElement.cloneNode(false);
    targetClone.setAttribute('data-target-element', 'true');
    
    // Копируем все атрибуты целевого элемента
    Array.from(targetElement.attributes).forEach(attr => {
        targetClone.setAttribute(attr.name, attr.value);
    });
    
    // Добавляем текстовое содержимое если есть
    if (targetElement.textContent && targetElement.textContent.trim()) {
        const text = targetElement.textContent.trim().substring(0, 100);
        targetClone.textContent = text + (targetElement.textContent.length > 100 ? '...' : '');
    }
    
    // Добавляем потомков
    if (descendantDepth > 0) {
        cloneDescendants(targetElement, targetClone, descendantDepth);
    }
    
    currentContainer.appendChild(targetClone);
    
    // Добавляем контекст соседних элементов
    addExtendedSiblingContext(targetElement, currentContainer, targetClone);
    
    return contextContainer.innerHTML;
}

function addExtendedSiblingContext(targetElement, container, targetClone) {
    const parent = targetElement.parentElement;
    if (!parent) return;
    
    const siblings = Array.from(parent.children);
    const targetIndex = siblings.indexOf(targetElement);
    const siblingRange = 3; // Увеличиваем диапазон
    
    // Добавляем соседей с обеих сторон
    for (let i = Math.max(0, targetIndex - siblingRange); i < Math.min(siblings.length, targetIndex + siblingRange + 1); i++) {
        if (i === targetIndex) continue;
        
        const sibling = siblings[i];
        if (shouldSkipElement(sibling)) continue;
        
        const siblingClone = sibling.cloneNode(false);
        
        // Определяем важность соседа
        const importance = getElementImportance(sibling);
        const distance = Math.abs(i - targetIndex);
        
        if (importance >= 2 || distance <= 1) {
            // Важные соседи или очень близкие - копируем все атрибуты
            Array.from(sibling.attributes).forEach(attr => {
                siblingClone.setAttribute(attr.name, attr.value);
            });
            
            // Добавляем первый уровень детей для важных соседей
            if (importance >= 3) {
                cloneDescendants(sibling, siblingClone, 1);
            }
        } else {
            // Менее важные соседи - только ключевые атрибуты
            const keyAttrs = ['id', 'class', 'data-testid', 'role', 'type'];
            keyAttrs.forEach(attrName => {
                if (sibling.hasAttribute(attrName)) {
                    siblingClone.setAttribute(attrName, sibling.getAttribute(attrName));
                }
            });
        }
        
        siblingClone.setAttribute('data-sibling', i < targetIndex ? 'before' : 'after');
        siblingClone.setAttribute('data-sibling-distance', distance.toString());
        
        // Добавляем текстовое содержимое для контекста
        if (sibling.textContent && sibling.textContent.trim()) {
            const text = sibling.textContent.trim().substring(0, 50);
            siblingClone.setAttribute('data-text-preview', text);
        }
        
        if (i < targetIndex) {
            container.insertBefore(siblingClone, targetClone);
        } else {
            container.appendChild(siblingClone);
        }
    }
}

function combineContexts(pageStructure, detailedContext, targetElement) {
    // Создаем полный контекст, объединяя структуру страницы и детальный контекст
    const fullContext = `
<!-- Page Structure Overview -->
<div data-page-structure="true">
${pageStructure}
</div>

<!-- Detailed Context Around Target Element -->
<div data-detailed-context="true">
${detailedContext}
</div>

<!-- Target Element Path Information -->
<div data-element-path="true">
${generateElementPath(targetElement)}
</div>
    `.trim();
    
    return fullContext;
}

function generateElementPath(element) {
    // Генерируем полный путь к элементу для понимания AI
    const path = [];
    let current = element;
    
    while (current && current !== document.documentElement) {
        const pathInfo = {
            tag: current.tagName.toLowerCase(),
            id: current.id || null,
            classes: current.className ? current.className.split(' ').filter(c => c.trim()) : [],
            position: getElementPositionInfo(current),
            isTarget: current === element
        };
        
        path.unshift(pathInfo);
        current = current.parentElement;
    }
    
    const pathDescription = path.map((info, index) => {
        let desc = `${info.tag}`;
        if (info.id) desc += `#${info.id}`;
        if (info.classes.length > 0) desc += `.${info.classes.slice(0, 3).join('.')}`; // Ограничиваем количество классов
        if (info.isTarget) desc += ' [TARGET]';
        return `${'  '.repeat(index)}${desc}`;
    }).join('\n');
    
    return `<pre data-element-path="true">\nElement Path:\n${pathDescription}\n</pre>`;
}

function getElementPositionInfo(element) {
    try {
        const rect = element.getBoundingClientRect();
        return `top:${Math.round(rect.top)}, left:${Math.round(rect.left)}, width:${Math.round(rect.width)}, height:${Math.round(rect.height)}`;
    } catch (e) {
        return 'position:unknown';
    }
}

setupHighlightStyles();
init();