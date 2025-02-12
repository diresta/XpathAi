// Стили для подсветки
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

let highlightedElement = null;
let isSelectionActive = false;
let isInitialized = false;

function init() {
    if (isInitialized) return;
    isInitialized = true;

    chrome.runtime.onMessage.addListener((message) => {
        console.log("Message received in content script:", message);
        if (message.type === "activateSelection") {
            activateSelection();
        }
    });
}

// Активация выбора элемента
function activateSelection() {
    if (isSelectionActive) return;
    console.log("Activating selection");
    isSelectionActive = true;
    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    document.addEventListener('click', handleClick);
}

// Деактивация выбора элемента
function deactivateSelection() {
    if (!isSelectionActive) return;
    console.log("Deactivating selection");
    isSelectionActive = false;
    removeHighlight();
    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('mouseout', handleMouseOut);
    document.removeEventListener('click', handleClick);
}

// Функция для подсветки элемента
function highlightElement(element) {
    if (highlightedElement) {
        highlightedElement.classList.remove('xpath-helper-highlight');
    }
    highlightedElement = element;
    highlightedElement.classList.add('xpath-helper-highlight');
}

// Функция для снятия подсветки
function removeHighlight() {
    if (highlightedElement) {
        highlightedElement.classList.remove('xpath-helper-highlight');
        highlightedElement = null;
    }
}

// Обработчик наведения на элемент
function handleMouseOver(e) {
    if (!isSelectionActive) return;
    highlightElement(e.target);
}

// Обработчик ухода курсора с элемента
function handleMouseOut(e) {
    if (!isSelectionActive || !highlightedElement) return;
    if (e.target === highlightedElement) {
        removeHighlight();
    }
}

// Обработчик клика для выбора элемента
function handleClick(e) {
    if (!isSelectionActive) return;
    e.preventDefault();
    e.stopPropagation();

    const element = e.target;
    const hadHighlight = element.classList.contains('xpath-helper-highlight');

    // Временно удаляем класс
    if (hadHighlight) 
        element.classList.remove('xpath-helper-highlight');

    // Отправляем данные
    try {
        chrome.runtime.sendMessage({
            type: "elementSelected",
            dom: document.documentElement.outerHTML,
            element: {
                x: e.clientX,
                y: e.clientY,
                tag: element.tagName,
                attributes: Array.from(element.attributes).map(attr => ({
                    name: attr.name,
                    value: attr.value
                }))
            }
        });
    } catch (error) {
        console.error("Error sending message:", error);
    }

    if (hadHighlight) 
        element.classList.add('xpath-helper-highlight');

    deactivateSelection();
}

init();