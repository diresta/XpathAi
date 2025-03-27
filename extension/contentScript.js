let highlightedElement = null;
let isSelectionActive = false;
let isInitialized = false;

function setupHighlightStyles() {
    if (!document.getElementById('xpath-helper-highlight-style')) {
        const highlightStyle = document.createElement('style');
        highlightStyle.id = 'xpath-helper-highlight-style';
        highlightStyle.textContent = `
            .xpath-helper-highlight {
                outline: 2px solid #f00 !important;
                box-shadow: 0 0 5px rgba(255, 0, 0, 0.5) !important;
                background: rgba(255, 0, 0, 0.1) !important;
                cursor: crosshair !important;
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

    chrome.runtime.onMessage.addListener((message) => {
        try {
            switch (message.type) {
                case "activateSelection":
                    activateSelection();
                    break;
                    
                case "checkXpathUniqueness":
                    const duplicates = evaluateXpathCount(message.xpath);
                    chrome.runtime.sendMessage({ 
                        type: "xpathUniquenessResult", 
                        duplicates 
                    });
                    break;
            }
        } catch (error) {
            console.error("Error handling message:", message.type, error);
        }
    });
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

function optimizeDOM(targetElement) {
    console.time('DOM optimization');
    const originalSize = document.documentElement.outerHTML.length;
    console.log(`Original DOM size: ${(originalSize / 1024).toFixed(1)}KB`);

    const parser = new DOMParser();
    const domClone = parser.parseFromString(document.documentElement.outerHTML, "text/html");
    const pathToTarget = getElementPath(targetElement);
    
    const selectorsToClean = [
        'script', 'style', 'noscript',
        'svg', 'canvas', 'video', 'audio',
        'link[rel="stylesheet"]', 'meta',
        'link[rel="preload"]', 'link[rel="prefetch"]'
    ];
    
    domClone.querySelectorAll(selectorsToClean.join(',')).forEach(el => {
        el.parentNode?.removeChild(el);
    });
    
    const MAX_DOM_SIZE = 100000; // ~100KB
    let domString = domClone.documentElement.outerHTML;

    if (domString.length > MAX_DOM_SIZE) 
    {
        const protectedElements = getProtectedElements(domClone, pathToTarget);
        processLargeCollections(domClone, protectedElements);
        pruneDeepContainers(domClone, protectedElements);
        domString = domClone.documentElement.outerHTML;
        if (domString.length > MAX_DOM_SIZE) {
            domString = domString.substring(0, MAX_DOM_SIZE) + "<!-- DOM truncated -->";
        }
    }
    
    domString = compressDOM(domString);

    const optimizedSize = domString.length;
    console.log(`Optimized DOM size: ${(optimizedSize / 1024).toFixed(1)}KB (${(optimizedSize/originalSize*100).toFixed(1)}% of original)`);
    console.timeEnd('DOM optimization');
    
    return domString;
}

function compressDOM(domString) {
    domString = domString.replace(/<!--(?!.*truncated).*?-->/gs, '');
    domString = domString.replace(/>\s+</g, '><');
    
    domString = domString.replace(/\s+"/g, '"');
    domString = domString.replace(/"\s+/g, '"');
    
    const textPattern = />([^<]+)</g;
    domString = domString.replace(textPattern, (match, text) => {
        if (!/^(\s*\n\s*)+$/.test(text)) {
            return match;
        }
        return '>' + text.trim().replace(/\s+/g, ' ') + '<';
    });
    
    domString = domString.replace(/\s+([a-zA-Z-]+)=""/g, '');
    
    console.log(`DOM compressed from ${domString.length} to ${domString.length} chars`);

    return domString;
}

function getElementPath(element) {
    const path = [];
    let current = element;
    
    while (current && current !== document.documentElement) {
        path.unshift(current);
        current = current.parentNode;
    }
    path.unshift(document.documentElement);
    return path;
}

function getProtectedElements(domClone, pathToTarget) {
    const protectedElements = new Set();
    const importantElements = domClone.querySelectorAll('header, footer, [role="navigation"], nav');
    importantElements.forEach(el => protectedElements.add(el));
    
    for (let i = 0; i < pathToTarget.length; i++) {
        const element = pathToTarget[i];
        protectedElements.add(element);
        
        if (element.parentNode) {
            const siblings = Array.from(element.parentNode.children);
            const index = siblings.indexOf(element);
            const start = Math.max(0, index - 3);
            const end = Math.min(siblings.length, index + 4);
            
            for (let j = start; j < end; j++) {
                if (siblings[j]) protectedElements.add(siblings[j]);
            }
        }
    }
    
    return protectedElements;
}


function processLargeCollections(domClone, protectedElements) {
    const collections = domClone.querySelectorAll('ul, ol, table, div > div:nth-child(n+5)');
    collections.forEach(collection => {
        if (protectedElements.has(collection)) 
            return;
        
        let hasProtected = false;
        collection.querySelectorAll('*').forEach(el => {
            if (protectedElements.has(el)) 
                hasProtected = true;
        });
        
        if (!hasProtected && collection.children.length > 5) {
            const toKeep = 2;
            
            while (collection.children.length > toKeep * 2) {
                collection.removeChild(collection.children[toKeep]);
            }
            
            const truncateMarker = document.createElement('li');
            truncateMarker.textContent = '... (truncated)';
            truncateMarker.style.textAlign = 'center';
            truncateMarker.style.fontStyle = 'italic';
            collection.insertBefore(truncateMarker, collection.children[toKeep]);
        }
    });
}


function pruneDeepContainers(domClone, protectedElements) {
    const deepDivs = Array.from(domClone.querySelectorAll('div div div div')).filter(div => {
        let current = div;
        while (current && current !== domClone.documentElement) {
            if (protectedElements.has(current)) 
                return false;

            current = current.parentNode;
        }
        return true;
    });
    
    deepDivs.forEach(div => {
        if (div.parentNode) {
            div.innerHTML = '<!-- Deep content removed -->';
        }
    });
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

    const optimizedDOM = optimizeDOM(element);

    try {
        chrome.runtime.sendMessage({
            type: "elementSelected",
            dom: optimizedDOM,
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