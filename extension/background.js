const STATUS = {
    INACTIVE: 'Не активно',
    LOADING: 'Загрузка...',
    COMPLETE: 'Готово',
    ERROR: 'Ошибка',
    SELECTING: 'Выбор элемента...'
};

const REQUEST_TIMEOUT = 30000;

const fetchWithTimeout = (url, options, timeout = REQUEST_TIMEOUT) => {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), timeout)
        )
    ]);
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Message received in background:", message.type);
    switch (message.type) {
        case "initSelection":
            handleInitSelection(message);
            break;
            
        case "elementSelected":
            handleElementSelected(message, sender);
            return true;
            
        case "xpathUniquenessResult":
            handleUniquenessResult(message);
            break;
    }
});

function handleInitSelection(message) {
    if (!message.tabId) {
        console.error('No tabId provided for initSelection');
        return;
    }
    
    chrome.tabs.sendMessage(message.tabId, { type: "activateSelection" })
        .catch(error => console.error('Error activating selection:', error));
}

function handleElementSelected(message, sender) {
    const tabId = sender.tab?.id;
    if (!tabId) {
        console.error('No tab ID found in sender');
        return;
    }

    chrome.storage.local.set({ status: STATUS.LOADING });
    
    chrome.storage.sync.get(['useAISetting', 'API_URL', 'promptTemplate'], (config) => {
        const apiUrl = (config.API_URL || "http://localhost:80") + "/generate-xpath";
        const requestBody = {
            ...message,
            use_ai: !!config.useAISetting,
            prompt_template: config.promptTemplate || ""
        };
        
        console.log("Sending request with template:", requestBody.prompt_template ? 
                  `Template length: ${requestBody.prompt_template.length}` : "No template");
        
        fetchWithTimeout(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => Promise.reject(err));
            }
            return response.json();
        })
        .then(data => {
            chrome.storage.local.set({ 
                status: STATUS.COMPLETE,
                response: data.response,
                xpath: data.xpath,
                error: null
            });
            
            if (data.xpath) {
                chrome.tabs.sendMessage(tabId, { 
                    type: "checkXpathUniqueness", 
                    xpath: data.xpath 
                }).catch(err => console.error('Error requesting uniqueness check:', err));
            }
        })
        .catch(error => {
            console.error('API request failed:', error);
            chrome.storage.local.set({ 
                status: STATUS.ERROR,
                xpath: null,
                error: error.detail || error.message || 'Неизвестная ошибка'
            });
        });
    });
}

function handleUniquenessResult(message) {
    chrome.storage.local.set({ duplicates: message.duplicates })
        .catch(err => console.error('Error storing duplicates count:', err));
}