document.addEventListener('DOMContentLoaded', () => {
    const apiServiceUrlInput = document.getElementById('apiServiceUrl');
    const apiKeyInput = document.getElementById('apiKey');
    const modelNameInput = document.getElementById('modelName');
    const modelSelector = document.getElementById('modelSelector');
    const modelStatus = document.getElementById('modelStatus');
    const endpointStatus = document.getElementById('endpointStatus');
    const checkEndpointButton = document.getElementById('checkEndpoint');
    const maxPromptLengthInput = document.getElementById('maxPromptLength');
    const requestTimeoutInput = document.getElementById('requestTimeout');
    const defaultPromptTemplateTextarea = document.getElementById('defaultPromptTemplate');
    const templateSelector = document.getElementById('templateSelector');
    const templateDescription = document.getElementById('templateDescription');
    const saveButton = document.getElementById('saveSettings');
    const statusDiv = document.getElementById('status');

    const templates = {
        custom: {
            name: "Пользовательский шаблон",
            description: "Используйте свой собственный шаблон промпта",
            content: ""
        }
    };

    const templateFiles = [
        { key: 'template1', filename: 'prompt_template.txt', name: '1 Базовый XPath шаблон', description: 'C правилами и практическими примерами' },
        { key: 'template2', filename: 'prompt_template2.txt', name: '2 Продвинутый XPath шаблон', description: 'C системой приоритетов и всесторонними рекомендациями' },
        { key: 'template3', filename: 'prompt_template3.txt', name: '3 Компактный XPath шаблон', description: 'Краткая версия, сфокусированная на лучших практиках и производительности' },
        { key: 'template4', filename: 'prompt_template4.txt', name: '4 Минималистичный XPath шаблон', description: 'Упрощенная версия с акцентом на краткость и ясность' },
        { key: 'template5', filename: 'prompt_template5.txt', name: '5 Экспертный XPath шаблон', description: 'Подробное руководство с примерами и объяснениями' }
    ];

    async function loadTemplateFromFile(templateKey, filename) {
        try {
            const response = await fetch(chrome.runtime.getURL(`prompts/${filename}`));
            const content = await response.text();
            templates[templateKey].content = content;
        } catch (error) {
            console.error(`Не удалось загрузить шаблон ${filename}:`, error);
            templates[templateKey].content = templates.custom.content;
        }
    }

    async function loadTemplates() {
        const loadPromises = templateFiles.map(async ({ key, filename, name, description }) => {
            templates[key] = { name, description, content: null };
            await loadTemplateFromFile(key, filename);
        });
        await Promise.all(loadPromises);
    }

    async function checkEndpoint(url) {
        endpointStatus.textContent = 'Проверка...';
        endpointStatus.className = '';
        try {
            const resp = await fetch(url.replace(/\/$/, '') + '/endpoint-health');
            if (!resp.ok) throw new Error('Ошибка подключения');
            const data = await resp.json();
            if (data.status === 'ok' || data.status === 'ready' || data.server_ready) {
                endpointStatus.textContent = '✅ Подключение успешно';
                endpointStatus.className = 'success';
            } else {
                endpointStatus.textContent = '⚠️ Эндпоинт не готов: ' + (data.status || 'unknown');
                endpointStatus.className = 'error';
            }
        } catch (e) {
            endpointStatus.textContent = '❌ Нет подключения: ' + e.message;
            endpointStatus.className = 'error';
        }
    }

    async function fetchModels(url, selectedModel) {
        modelSelector.innerHTML = '<option value="">Загрузка...</option>';
        modelStatus.textContent = '';
        try {
            const resp = await fetch(url.replace(/\/$/, '') + '/models');
            if (!resp.ok) throw new Error('Ошибка получения моделей');
            const data = await resp.json();
            if (Array.isArray(data.available_models)) {
                modelSelector.innerHTML = '';
                data.available_models.forEach(model => {
                    const opt = document.createElement('option');
                    opt.value = model;
                    opt.textContent = model;
                    modelSelector.appendChild(opt);
                });
                if (selectedModel && data.available_models.includes(selectedModel)) {
                    modelSelector.value = selectedModel;
                } else if (data.current_model) {
                    modelSelector.value = data.current_model;
                }
                modelStatus.textContent = 'Доступно моделей: ' + data.available_models.length;
                modelStatus.className = 'success';
            } else {
                modelSelector.innerHTML = '<option value="">Нет моделей</option>';
                modelStatus.textContent = 'Нет доступных моделей';
                modelStatus.className = 'error';
            }
        } catch (e) {
            modelSelector.innerHTML = '<option value="">Ошибка</option>';
            modelStatus.textContent = 'Ошибка загрузки моделей: ' + e.message;
            modelStatus.className = 'error';
        }
    }

    async function setModel(url, model) {
        modelStatus.textContent = 'Смена модели...';
        modelStatus.className = '';
        try {
            const resp = await fetch(url.replace(/\/$/, '') + '/models', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model })
            });
            if (!resp.ok) throw new Error('Ошибка смены модели');
            const data = await resp.json();
            modelStatus.textContent = 'Текущая модель: ' + (data.current_model || model);
            modelStatus.className = 'success';
        } catch (e) {
            modelStatus.textContent = 'Ошибка смены модели: ' + e.message;
            modelStatus.className = 'error';
        }
    }

    // --- UI EVENTS ---
    checkEndpointButton.addEventListener('click', () => {
        const url = apiServiceUrlInput.value.trim();
        if (!url) {
            endpointStatus.textContent = 'Введите URL сервиса.';
            endpointStatus.className = 'error';
            return;
        }
        checkEndpoint(url);
        fetchModels(url, modelSelector.value);
    });

    apiServiceUrlInput.addEventListener('change', () => {
        const url = apiServiceUrlInput.value.trim();
        if (url) {
            fetchModels(url, modelSelector.value);
        }
    });

    modelSelector.addEventListener('change', () => {
        const url = apiServiceUrlInput.value.trim();
        const model = modelSelector.value;
        if (url && model) {
            setModel(url, model);
            modelNameInput.value = model;
        }
    });

    // --- ШАБЛОНЫ ---
    loadTemplates().then(() => {
        loadSettings();
    });

    const defaultTemplateValue = templates.custom.content;

    function updateTemplateDescription(templateKey) {
        const template = templates[templateKey];
        if (template && template.description) {
            templateDescription.textContent = template.description;
            templateDescription.classList.add('show');
        } else {
            templateDescription.classList.remove('show');
        }
    }

    function updateTemplateContent(templateKey) {
        const template = templates[templateKey];
        if (template && template.content) {
            defaultPromptTemplateTextarea.value = template.content;
        }
    }

    templateSelector.addEventListener('change', (e) => {
        const selectedTemplate = e.target.value;
        updateTemplateDescription(selectedTemplate);
        if (selectedTemplate !== 'custom') {
            updateTemplateContent(selectedTemplate);
        }
    });

    function loadSettings() {
        chrome.storage.local.get([
            'apiServiceUrl', 
            'apiKey', 
            'modelName',
            'maxPromptLength',
            'requestTimeout',
            'defaultPromptTemplate',
            'selectedTemplate'
        ], (settings) => {
            if (chrome.runtime.lastError) {
                console.error("Ошибка загрузки настроек:", chrome.runtime.lastError);
                statusDiv.textContent = 'Ошибка загрузки настроек.';
                statusDiv.style.color = 'red';
                return;
            }
            apiServiceUrlInput.value = settings.apiServiceUrl || '';
            apiKeyInput.value = settings.apiKey || '';
            modelNameInput.value = settings.modelName || 'gpt-4';
            maxPromptLengthInput.value = settings.maxPromptLength || 10000;
            requestTimeoutInput.value = settings.requestTimeout || 60;
            const savedTemplate = settings.selectedTemplate || 'custom';
            templateSelector.value = savedTemplate;
            updateTemplateDescription(savedTemplate);
            if (settings.defaultPromptTemplate) {
                defaultPromptTemplateTextarea.value = settings.defaultPromptTemplate;
            } else if (savedTemplate !== 'custom' && templates[savedTemplate] && templates[savedTemplate].content) {
                defaultPromptTemplateTextarea.value = templates[savedTemplate].content;
            } else {
                defaultPromptTemplateTextarea.value = defaultTemplateValue;
            }
            if (settings.apiServiceUrl) {
                fetchModels(settings.apiServiceUrl, settings.modelName);
            }
        });
    }

    defaultPromptTemplateTextarea.addEventListener('input', () => {
        const currentTemplate = templateSelector.value;
        if (currentTemplate !== 'custom') {
            const currentTemplateContent = templates[currentTemplate]?.content;
            if (defaultPromptTemplateTextarea.value !== currentTemplateContent) {
                templateSelector.value = 'custom';
                updateTemplateDescription('custom');
            }
        }
    });

    // Save settings
    saveButton.addEventListener('click', () => {
        const settingsToSave = {
            apiServiceUrl: apiServiceUrlInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            modelName: modelNameInput.value.trim(),
            maxPromptLength: parseInt(maxPromptLengthInput.value, 10) || 70000,
            requestTimeout: parseInt(requestTimeoutInput.value, 10) || 60,
            defaultPromptTemplate: defaultPromptTemplateTextarea.value.trim() || defaultTemplateValue,
            selectedTemplate: templateSelector.value
        };

        if (!settingsToSave.apiServiceUrl) {
            statusDiv.textContent = 'Требуется URL API сервиса.';
            statusDiv.style.color = 'red';
            return;
        }
        if (!settingsToSave.apiKey) {
            statusDiv.textContent = 'Требуется API ключ.';
            statusDiv.style.color = 'red';
            return;
        }

        chrome.storage.local.set(settingsToSave, () => {
            if (chrome.runtime.lastError) {
                console.error("Ошибка сохранения настроек:", chrome.runtime.lastError);
                statusDiv.textContent = 'Ошибка сохранения настроек.';
                statusDiv.classList.remove('success');
                statusDiv.classList.add('error');
            } else {
                statusDiv.textContent = 'Настройки сохранены!';
                statusDiv.classList.remove('error');
                statusDiv.classList.add('success');
                setTimeout(() => {
                    statusDiv.textContent = '';
                    statusDiv.classList.remove('success');
                }, 3000);
            }
        });
    });
});
