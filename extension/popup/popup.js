document.addEventListener('DOMContentLoaded', () => {
    const statusElem = document.getElementById('status');
    const xpathOutput = document.getElementById('xpathOutput');
    const selectElementButton = document.getElementById('selectElement');

    // Обновление интерфейса
    const updateUI = () => {
        chrome.storage.local.get(['status', 'xpath', 'error'], (data) => {
            statusElem.textContent = `Статус: ${data.status || 'Не активно'}`;
            
            if (data.xpath) {
                xpathOutput.value = data.xpath;
                xpathOutput.classList.remove('error');
            } else if (data.error) {
                xpathOutput.value = `Ошибка: ${data.error}`;
                xpathOutput.classList.add('error');
            } else {
                xpathOutput.value = '';
                xpathOutput.classList.remove('error');
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

    chrome.storage.onChanged.addListener(updateUI);
});