let highlightedElement = null;
let isSelectionActive = false;
let isInitialized = false;

/**
 * Initialize highlight styles once
 */
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

function handleClick(e) {
    if (!isSelectionActive) {
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();

    const element = e.target;
    const hadHighlight = element.classList.contains('xpath-helper-highlight');

    // Temporarily remove highlight class to avoid it being included in the HTML
    if (hadHighlight) {
        element.classList.remove('xpath-helper-highlight');
    }

    try {
        chrome.runtime.sendMessage({
            type: "elementSelected",
            dom: document.documentElement.outerHTML,
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
        console.error("Error sending message:", error);
    } finally {
        // Restore highlight class if it was removed
        if (hadHighlight) {
            element.classList.add('xpath-helper-highlight');
        }
        
        deactivateSelection();
    }
}

/**
 * Evaluate XPath expression and return matching nodes count
 */
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
        console.error("Error evaluating XPath:", error);
        return -1; // Signal error with negative count
    }
}

// Initialize the extension
setupHighlightStyles();
init();