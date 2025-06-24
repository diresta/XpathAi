document.addEventListener('DOMContentLoaded', () => {
    const statusElem = document.getElementById('status');
    const primaryXpathOutput = document.getElementById('primaryXpathOutput');
    const alternativeXpathOutput = document.getElementById('alternativeXpathOutput');
    const selectElementButton = document.getElementById('selectElement');
    const settingsButton = document.getElementById('openSettings');
    const checkUniquenessButton = document.getElementById('checkUniqueness');
    const clearButton = document.getElementById('clear');
    
    const explanationContent = document.getElementById('explanationContent');
    const toggleExplanationBtn = document.getElementById('toggleExplanation');
    const explanationSection = document.getElementById('explanationSection');
    const alternativeHeader = document.querySelector('.alternative-header');
    const useAIButton = document.getElementById('useAI');

    const STATUS = {
        INACTIVE: 'Не активно',
        SELECTING: 'Выбор элемента...',
        COPIED: 'XPath скопирован в буфер обмена!',
        COPY_FAILED: 'Не удалось скопировать XPath.',
        STORAGE_ERROR: 'Ошибка при получении данных из хранилища.'
    };
    
    const setElementState = (element, value, isError = false) => {
        element.value = value;
        element.classList.toggle('error', isError);
        element.classList.toggle('success', !isError && value);
    };
    
    primaryXpathOutput.addEventListener('click', () => {
        if (primaryXpathOutput.value) {
            navigator.clipboard.writeText(primaryXpathOutput.value)
                .then(() => {
                    statusElem.textContent = STATUS.COPIED;
                    flashElement(primaryXpathOutput);
                })
                .catch(() => {
                    statusElem.textContent = STATUS.COPY_FAILED;
                });
        }
    });

    alternativeXpathOutput.addEventListener('click', () => {
        if (alternativeXpathOutput.value) {
            navigator.clipboard.writeText(alternativeXpathOutput.value)
                .then(() => {
                    statusElem.textContent = STATUS.COPIED;
                    flashElement(alternativeXpathOutput);
                })
                .catch(() => {
                    statusElem.textContent = STATUS.COPY_FAILED;
                });
        }
    });
    
    function flashElement(element) {
        element.classList.add('copied');
        setTimeout(() => {
            element.classList.remove('copied');
        }, 300);
    }
    
    toggleExplanationBtn.addEventListener('click', () => {
        const isCollapsed = explanationContent.classList.toggle('collapsed');
        toggleExplanationBtn.textContent = isCollapsed ? '▼' : '▲';
    });
    
    alternativeHeader.style.display = 'none';
    alternativeXpathOutput.style.display = 'none';
    explanationSection.style.display = 'none';

    const updateUI = () => {
        chrome.storage.local.get([
            'status', 'response', 'xpath', 'error', 
            'duplicates', 'alternativeXpath', 'explanation'
        ], (data) => {
            if (chrome.runtime.lastError) {
                statusElem.textContent = STATUS.STORAGE_ERROR;
                setElementState(primaryXpathOutput, '');
                setElementState(alternativeXpathOutput, '');
                return;
            }
            
            statusElem.textContent = `Статус: ${data.status || STATUS.INACTIVE}`;
            
            console.log("UI Update with data:", data);
            
            setElementState(primaryXpathOutput, data.xpath || '', !!data.error);
            
            if (data.alternativeXpath) {
                alternativeHeader.style.display = 'block';
                alternativeXpathOutput.style.display = 'block';
                setElementState(alternativeXpathOutput, data.alternativeXpath, false);
            } else {
                alternativeHeader.style.display = 'none';
                alternativeXpathOutput.style.display = 'none';
            }
            
            if (data.explanation) {
                explanationContent.textContent = data.explanation;
                explanationSection.style.display = 'block';
            } else {
                explanationSection.style.display = 'none';
            }
            
            if (data.error) {
                setElementState(primaryXpathOutput, `Ошибка: ${data.error}`, true);
            }

            if (typeof data.duplicates === 'number') {
                statusElem.textContent += ` | Дубликаты: ${data.duplicates}`;
            }
        });
    };

    // Initialize UI and listen for changes
    updateUI();
    chrome.storage.onChanged.addListener(updateUI);

    // Event handlers
    selectElementButton.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) throw new Error('No active tab found');

            chrome.runtime.sendMessage({
                type: "initSelection", 
                tabId: tab.id
            });
        } catch (error) {
            console.error('Error initiating selection:', error);
            statusElem.textContent = `Error: ${error.message}`;
        }
    });
    
    clearButton.addEventListener('click', () => {
        setElementState(primaryXpathOutput, '');
        setElementState(alternativeXpathOutput, '');
        
        chrome.storage.local.set({
            status: STATUS.INACTIVE,
            response: '',
            xpath: '',
            alternativeXpath: null,
            explanation: null,
            error: '',
            duplicates: 0
        });
        
        statusElem.textContent = `Статус: ${STATUS.INACTIVE}`;
        alternativeHeader.style.display = 'none';
        alternativeXpathOutput.style.display = 'none';
        explanationSection.style.display = 'none';
    });

    settingsButton.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    checkUniquenessButton.addEventListener('click', async () => {
        try {
            const xpathToCheck = primaryXpathOutput.value;
            if (!xpathToCheck) return;
            
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error('No active tab found');
            }
            
            statusElem.textContent = 'Проверка уникальности...';
            chrome.tabs.sendMessage(tab.id, {
                type: "checkXpathUniqueness",
                xpath: xpathToCheck
            });
        } catch (error) {
            console.error('Error checking uniqueness:', error);
            statusElem.textContent = `Error: ${error.message}`;
        }
    });
    
    // Message listener for XPath generation response
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "generateXPathResponse") {
            const { xpath, alternativeXpath, explanation, error, useAI } = message;
            
            setElementState(primaryXpathOutput, xpath || '', !!error);
            
            if (alternativeXpath) {
                alternativeHeader.style.display = 'block';
                alternativeXpathOutput.style.display = 'block';
                setElementState(alternativeXpathOutput, alternativeXpath, false);
            } else {
                alternativeHeader.style.display = 'none';
                alternativeXpathOutput.style.display = 'none';
            }
            
            if (explanation) {
                explanationContent.textContent = explanation;
                explanationSection.style.display = 'block';
            } else {
                explanationSection.style.display = 'none';
            }
            
            if (error) {
                setElementState(primaryXpathOutput, `Ошибка: ${error}`, true);
            }

            if (useAI) {
                statusElem.textContent += ' | Использован ИИ для генерации XPath';
            }
            else {
                statusElem.textContent += ' | XPath сгенерирован без ИИ';
            }

            if (typeof message.duplicates === 'number') {
                statusElem.textContent += ` | Дубликаты: ${message.duplicates}`;
            }
        }
    });
    
    // Send message to background script to generate XPath
    function generateXPath(useAI) {
        chrome.runtime.sendMessage({
            action: "generateXPath",
            useAI: useAI
        });
    }
    
    // Example of how to call generateXPath with AI flag
    // generateXPath(useAICheckbox.checked);
});
