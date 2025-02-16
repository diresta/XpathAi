chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    
    console.log("Message received in background:", message.type);

    if (message.type === "initSelection") {
        chrome.tabs.sendMessage(message.tabId, { type: "activateSelection" });
    }

    if (message.type === "elementSelected") {
        chrome.storage.local.set({ status: 'Загрузка...' });
        chrome.storage.sync.get(['useAISetting', 'API_URL'], (config) => {
            const finalURL = (config.API_URL || "http://localhost:8000") + "/generate-xpath";
            const requestBody = {
                ...message,
                use_ai: !!config.useAISetting
            };
            fetch(finalURL, {
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
                    status: 'Готово',
                    xpath: data.xpath,
                    error: null
                });
            })
            .catch(error => {
                chrome.storage.local.set({ 
                    status: 'Ошибка',
                    xpath: null,
                    error: error.detail || error.message || 'Неизвестная ошибка'
                });
            });
        });
    }
});