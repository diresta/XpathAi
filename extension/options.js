document.addEventListener('DOMContentLoaded', () => {
    const apiServiceUrlInput = document.getElementById('apiServiceUrl');
    const apiKeyInput = document.getElementById('apiKey');
    const modelNameInput = document.getElementById('modelName');
    const maxPromptLengthInput = document.getElementById('maxPromptLength');
    const requestTimeoutInput = document.getElementById('requestTimeout');
    const defaultPromptTemplateTextarea = document.getElementById('defaultPromptTemplate');
    const saveButton = document.getElementById('saveSettings');
    const statusDiv = document.getElementById('status');

    const defaultTemplateValue = `Generate an XPath that uniquely identifies this element:
{element}

Within this DOM:
{dom}

Please provide your response as a JSON object with the following keys:
- "primary_xpath": (string) The most reliable XPath.
- "alternative_xpath": (string | null) A backup XPath, or null if not applicable.
- "explanation": (string) A brief explanation of why this approach was chosen.
Ensure the output is a single, valid JSON object only.`;

    // Load saved settings
    chrome.storage.sync.get([
        'apiServiceUrl', 
        'apiKey', 
        'modelName',
        'maxPromptLength',
        'requestTimeout',
        'defaultPromptTemplate'
    ], (settings) => {
        if (chrome.runtime.lastError) {
            console.error("Error loading settings:", chrome.runtime.lastError);
            statusDiv.textContent = 'Error loading settings.';
            statusDiv.style.color = 'red';
        }
        apiServiceUrlInput.value = settings.apiServiceUrl || '';
        apiKeyInput.value = settings.apiKey || '';
        modelNameInput.value = settings.modelName || 'gpt-4';
        maxPromptLengthInput.value = settings.maxPromptLength || 10000;
        requestTimeoutInput.value = settings.requestTimeout || 60;
        defaultPromptTemplateTextarea.value = settings.defaultPromptTemplate || defaultTemplateValue;
    });

    // Save settings
    saveButton.addEventListener('click', () => {
        const settingsToSave = {
            apiServiceUrl: apiServiceUrlInput.value.trim(),
            apiKey: apiKeyInput.value.trim(), // API key is saved directly
            modelName: modelNameInput.value.trim(),
            maxPromptLength: parseInt(maxPromptLengthInput.value, 10) || 70000,
            requestTimeout: parseInt(requestTimeoutInput.value, 10) || 60,
            defaultPromptTemplate: defaultPromptTemplateTextarea.value.trim() || defaultTemplateValue
        };

        if (!settingsToSave.apiServiceUrl) {
            statusDiv.textContent = 'API Service URL is required.';
            statusDiv.style.color = 'red';
            return;
        }
        if (!settingsToSave.apiKey) {
            statusDiv.textContent = 'API Key is required.';
            statusDiv.style.color = 'red';
            return;
        }


        chrome.storage.sync.set(settingsToSave, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving settings:", chrome.runtime.lastError);
                statusDiv.textContent = 'Error saving settings.';
                statusDiv.style.color = 'red';
            } else {
                statusDiv.textContent = 'Settings saved!';
                statusDiv.style.color = 'green';
                setTimeout(() => {
                    statusDiv.textContent = '';
                }, 3000);
            }
        });
    });
});
