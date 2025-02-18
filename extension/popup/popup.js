document.addEventListener('DOMContentLoaded', () => {
    const statusElem = document.getElementById('status');
    const responseOutput = document.getElementById('responseOutput');
    const xpathOutput = document.getElementById('xpathOutput');
    const selectElementButton = document.getElementById('selectElement');
    const settingsButton = document.getElementById('openSettings');

    // Обновление интерфейса
    const updateUI = () => {
        chrome.storage.local.get(['status', 'response', 'xpath', 'error'], (data) => {
            if (chrome.runtime.lastError) {
                statusElem.textContent = 'Ошибка при получении данных из хранилища.';
                responseOutput.value = '';
                responseOutput.classList.remove('error');
                responseOutput.classList.remove('success');
                xpathOutput.value = '';
                xpathOutput.classList.remove('error');
                xpathOutput.classList.remove('success');
                return;
            }
            statusElem.textContent = `Статус: ${data.status || 'Не активно'}`;
            
            if (data.response) {
                responseOutput.value = data.response;
                responseOutput.classList.add('success');
            } else {
                responseOutput.value = '';
                xpathOutput.classList.add('error');
            }

            if (data.xpath) {
                xpathOutput.value = data.xpath;
                xpathOutput.classList.remove('error');
                xpathOutput.classList.add('success');
            } else if (data.error) {
                xpathOutput.value = `Ошибка: ${data.error}`;
                xpathOutput.classList.remove('success');
                xpathOutput.classList.add('error');
            } else {
                xpathOutput.value = '';
                xpathOutput.classList.remove('error');
                xpathOutput.classList.remove('success');
            }
        });
    };

    // Первоначальное обновление
    updateUI();

    // Обработчик кнопки выбора элемента
    selectElementButton.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.storage.local.set({ status: 'Выбор элемента...' });
        console.log("Sending initSelection message");
        chrome.runtime.sendMessage({ type: "initSelection", tabId: tab.id });
    });

    // Копирование XPath в буфер обмена
    xpathOutput.addEventListener('click', () => {
        if (xpathOutput.value) {
            navigator.clipboard.writeText(xpathOutput.value)
                .then(() => {
                    statusElem.textContent = 'XPath скопирован в буфер обмена!';
                })
                .catch(() => {
                    statusElem.textContent = 'Не удалось скопировать XPath.';
                });
        }
    });

    settingsButton.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    chrome.storage.onChanged.addListener(updateUI);
});