document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const statusElem = document.getElementById('status');
    const responseOutput = document.getElementById('responseOutput');
    const xpathOutput = document.getElementById('xpathOutput');
    const selectElementButton = document.getElementById('selectElement');
    const settingsButton = document.getElementById('openSettings');
    const checkUniquenessButton = document.getElementById('checkUniqueness');
    const clearButton = document.getElementById('clear');
    
    // Constants
    const STATUS = {
        INACTIVE: 'Не активно',
        SELECTING: 'Выбор элемента...',
        COPIED: 'XPath скопирован в буфер обмена!',
        COPY_FAILED: 'Не удалось скопировать XPath.',
        STORAGE_ERROR: 'Ошибка при получении данных из хранилища.'
    };
    
    // Helper functions
    const setElementState = (element, value, isError = false) => {
        element.value = value;
        element.classList.toggle('error', isError);
        element.classList.toggle('success', !isError && value);
    };
    
    const updateUI = () => {
        chrome.storage.local.get(['status', 'response', 'xpath', 'error', 'duplicates'], (data) => {
            if (chrome.runtime.lastError) {
                statusElem.textContent = STATUS.STORAGE_ERROR;
                setElementState(responseOutput, '');
                setElementState(xpathOutput, '');
                return;
            }
            
            statusElem.textContent = `Статус: ${data.status || STATUS.INACTIVE}`;
            
            // Update response output
            setElementState(responseOutput, data.response || '', !data.response);
            
            // Update XPath output
            if (data.xpath) {
                setElementState(xpathOutput, data.xpath);
            } else if (data.error) {
                setElementState(xpathOutput, `Ошибка: ${data.error}`, true);
            } else {
                setElementState(xpathOutput, '');
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
            if (!tab) {
                throw new Error('No active tab found');
            }
            
            chrome.storage.local.set({ status: STATUS.SELECTING });
            chrome.runtime.sendMessage({ type: "initSelection", tabId: tab.id });
        } catch (error) {
            console.error('Error initiating selection:', error);
            statusElem.textContent = `Error: ${error.message}`;
        }
    });
    
    clearButton.addEventListener('click', () => {
        setElementState(responseOutput, '');
        setElementState(xpathOutput, '');
        
        chrome.storage.local.set({
            status: STATUS.INACTIVE,
            response: '',
            xpath: '',
            error: '',
            duplicates: 0
        });
        
        statusElem.textContent = `Статус: ${STATUS.INACTIVE}`;
    });
    
    xpathOutput.addEventListener('click', () => {
        if (xpathOutput.value) {
            navigator.clipboard.writeText(xpathOutput.value)
                .then(() => {
                    statusElem.textContent = STATUS.COPIED;
                })
                .catch(() => {
                    statusElem.textContent = STATUS.COPY_FAILED;
                });
        }
    });

    settingsButton.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    checkUniquenessButton.addEventListener('click', async () => {
        try {
            const currentXpath = xpathOutput.value;
            if (!currentXpath) return;
            
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) {
                throw new Error('No active tab found');
            }
            
            statusElem.textContent = 'Проверка уникальности...';
            chrome.tabs.sendMessage(tab.id, {
                type: "checkXpathUniqueness",
                xpath: currentXpath
            });
        } catch (error) {
            console.error('Error checking uniqueness:', error);
            statusElem.textContent = `Error: ${error.message}`;
        }
    });
});
