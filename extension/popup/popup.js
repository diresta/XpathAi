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

    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    const historySearch = document.getElementById('historySearch');
    const clearHistoryButton = document.getElementById('clearHistory');
    const historyList = document.getElementById('historyList');

    const STATUS = {
        INACTIVE: 'Не активно',
        SELECTING: 'Выбор элемента...',
        PROCESSING: 'Обработка запроса...',
        COPIED: 'XPath скопирован в буфер обмена!',
        COPY_FAILED: 'Не удалось скопировать XPath.',
        STORAGE_ERROR: 'Ошибка при получении данных из хранилища.'
    };
    
    const setElementState = (element, value, isError = false) => {
        element.value = value;
        element.classList.toggle('error', isError);
        element.classList.toggle('success', !isError && value);
    };

    const setStatusWithLoader = (message, showLoader = false, statusClass = '') => {
        statusElem.className = statusClass;
        if (showLoader) {
            statusElem.innerHTML = `<span class="loader"></span>${message}`;
        } else {
            statusElem.textContent = message;
        }
    };

    const updateAIButtonState = (isAIEnabled) => {
        useAIButton.classList.toggle('active', isAIEnabled);
    };

    chrome.storage.local.get('isAIEnabled', (data) => {
        updateAIButtonState(data.isAIEnabled);
    });
    
    statusElem.addEventListener('click', async () => {
        const xpath = primaryXpathOutput.value;
        if (!xpath || xpath.startsWith('Ошибка:')) return;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) throw new Error('No active tab found');

            chrome.tabs.sendMessage(tab.id, {
                action: "highlightDuplicates",
                xpath: xpath
            });
        } catch (error) {
            console.error('Error highlighting duplicates:', error);
        }
    });
    
    function handleCopyToClipboard(element) {
        if (element.value) {
            navigator.clipboard.writeText(element.value)
                .then(() => {
                    setStatusWithLoader(STATUS.COPIED, false, 'status-success');
                    flashElement(element);
                })
                .catch(() => {
                    setStatusWithLoader(STATUS.COPY_FAILED, false, 'status-error');
                });
        }
    }

    primaryXpathOutput.addEventListener('click', () => {
        handleCopyToClipboard(primaryXpathOutput);
    });

    alternativeXpathOutput.addEventListener('click', () => {
        handleCopyToClipboard(alternativeXpathOutput);
    });

    useAIButton.addEventListener('click', () => {
        chrome.storage.local.get('isAIEnabled', (data) => {
            const newState = !data.isAIEnabled;
            chrome.storage.local.set({ isAIEnabled: newState }, () => {
                updateAIButtonState(newState);
            });
        });
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
        ], async (data) => {
            if (chrome.runtime.lastError) {
                setStatusWithLoader(STATUS.STORAGE_ERROR, false, 'status-error');
                setElementState(primaryXpathOutput, '');
                setElementState(alternativeXpathOutput, '');
                return;
            }
            
            const currentStatus = data.status || STATUS.INACTIVE;
            
            let showLoader = false;
            let statusClass = '';
            
            if (currentStatus === STATUS.SELECTING || 
                currentStatus === STATUS.PROCESSING) {
                showLoader = true;
                statusClass = 'status-loading';
            } else if (data.error) {
                statusClass = 'status-error';
            } else if (data.xpath) {
                statusClass = 'status-success';
                
                // Save to history
                if (data.xpath && !data.error && !data.xpath.startsWith('Ошибка:')) {
                    try {
                        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                        if (tab && tab.url) {
                            await saveToHistory(data.xpath, tab.url);
                        }
                    } catch (error) {
                        console.error('Error saving to history:', error);
                    }
                }
            }
            
            setStatusWithLoader(`Статус: ${currentStatus}`, showLoader, statusClass);
            
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
                statusElem.innerHTML += ` | ${data.duplicates}`;
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
            setStatusWithLoader(`Статус: ${STATUS.SELECTING}`, true, 'status-loading');

            chrome.storage.local.get('isAIEnabled', (data) => {
                chrome.runtime.sendMessage({
                    action: "initSelection", 
                    tabId: tab.id,
                    useAI: data.isAIEnabled
                });
            });
        } catch (error) {
            console.error('Error initiating selection:', error);
            setStatusWithLoader(`Error: ${error.message}`, false, 'status-error');
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
        statusElem.className = '';
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
            
            chrome.tabs.sendMessage(tab.id, {
                action: "checkXpathUniqueness",
                xpath: xpathToCheck
            });
        } catch (error) {
            console.error('Error checking uniqueness:', error);
            setStatusWithLoader(`Error: ${error.message}`, false, 'status-error');
        }
    });

    // Tab switching
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            button.classList.add('active');
            document.getElementById(targetTab + 'Tab').classList.add('active');
            
            if (targetTab === 'history') {
                loadHistory();
            }
        });
    });

    async function loadHistory() {
        try {
            const data = await chrome.storage.local.get('xpathHistory');
            const history = data.xpathHistory || [];
            renderHistory(history);
        } catch (error) {
            console.error('Error loading history:', error);
        }
    }

    function renderHistory(history) {
        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty-history">История пуста</div>';
            return;
        }

        const sortedHistory = history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        historyList.innerHTML = sortedHistory.map(item => `
            <div class="history-item" data-xpath="${escapeHtml(item.xpath)}">
                <div class="history-item-header">
                    <div class="history-item-url">${escapeHtml(truncateUrl(item.url))}</div>
                    <div class="history-item-date">${formatDate(item.timestamp)}</div>
                </div>
                <div class="history-item-xpath">${escapeHtml(item.xpath)}</div>
            </div>
        `).join('');

        document.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                const xpath = item.getAttribute('data-xpath');
                copyToClipboard(xpath);
                showNotification('XPath скопирован!');
            });
        });
    }

    function truncateUrl(url) {
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname;
            return domain.length > 30 ? domain.substring(0, 27) + '...' : domain;
        } catch {
            return url.length > 30 ? url.substring(0, 27) + '...' : url;
        }
    }

    function formatDate(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.error('Copy failed:', error);
            return false;
        }
    }

    function showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'copied-notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 2000);
    }

    // History search functionality
    historySearch.addEventListener('input', () => {
        const query = historySearch.value.toLowerCase();
        const items = document.querySelectorAll('.history-item');
        
        items.forEach(item => {
            const text = item.textContent.toLowerCase();
            item.style.display = text.includes(query) ? 'block' : 'none';
        });
    });

    clearHistoryButton.addEventListener('click', async () => {
        if (confirm('Очистить всю историю?')) {
            try {
                await chrome.storage.local.set({ xpathHistory: [] });
                loadHistory();
                showNotification('История очищена');
            } catch (error) {
                console.error('Error clearing history:', error);
            }
        }
    });

    async function saveToHistory(xpath, url) {
        try {
            const data = await chrome.storage.local.get('xpathHistory');
            const history = data.xpathHistory || [];
            
            // Check if this xpath already exists
            const exists = history.some(item => item.xpath === xpath && item.url === url);
            if (exists) return;
            
            const newItem = {
                id: Date.now(),
                xpath: xpath,
                url: url,
                timestamp: new Date().toISOString()
            };
            
            // Add to beginning and limit to 50 items
            history.unshift(newItem);
            if (history.length > 50) {
                history.splice(50);
            }
            
            await chrome.storage.local.set({ xpathHistory: history });
        } catch (error) {
            console.error('Error saving to history:', error);
        }
    }
});
