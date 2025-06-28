document.addEventListener('DOMContentLoaded', () => {
    const apiServiceUrlInput = document.getElementById('apiServiceUrl');
    const apiKeyInput = document.getElementById('apiKey');
    const modelNameInput = document.getElementById('modelName');
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
            content: `Generate an XPath that uniquely identifies this element:
{element}

Within this DOM:
{dom}

Please provide your response as a JSON object with the following keys:
- "primary_xpath": (string) The most reliable XPath.
- "alternative_xpath": (string | null) A backup XPath, or null if not applicable.
- "explanation": (string) A brief explanation of why this approach was chosen.
Ensure the output is a single, valid JSON object only.`
        },
        template1: {
            name: "Базовый XPath шаблон",
            description: "C правилами и практическими примерами",
            content: null
        },
        template2: {
            name: "Продвинутый XPath шаблон", 
            description: "C системой приоритетов и всесторонними рекомендациями",
            content: null
        },
        template3: {
            name: "Компактный XPath шаблон",
            description: "Краткая версия, сфокусированная на лучших практиках и производительности",
            content: null
        }
    };

    async function loadTemplateFromFile(templateKey, filename) {
        try {
            const response = await fetch(chrome.runtime.getURL(`prompts/${filename}`));
            const content = await response.text();
            templates[templateKey].content = content;
        } catch (error) {
            console.error(`Failed to load template ${filename}:`, error);
            templates[templateKey].content = templates.custom.content;
        }
    }

    Promise.all([
        loadTemplateFromFile('template1', 'prompt_template.txt'),
        loadTemplateFromFile('template2', 'prompt_template2.txt'),
        loadTemplateFromFile('template3', 'prompt_template3.txt')
    ]).then(() => {
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
                console.error("Error loading settings:", chrome.runtime.lastError);
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
                console.error("Error saving settings:", chrome.runtime.lastError);
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
