// background.js - Service Worker to handle AI API calls

// Default settings - these will be overridden by user settings from storage
let settings = {
    apiServiceUrl: '',
    apiKey: '',
    modelName: 'gpt-3.5-turbo',
    maxPromptLength: 70000,
    requestTimeout: 60, // seconds
    defaultPromptTemplate: `Generate an XPath that uniquely identifies this element:
{element}

Within this DOM:
{dom}

Please provide your response as a JSON object with the following keys:
- "primary_xpath": (string) The most reliable XPath.
- "alternative_xpath": (string | null) A backup XPath, or null if not applicable.
- "explanation": (string) A brief explanation of why this approach was chosen.
**IMPORTANT**: Return ONLY the JSON object in your response. Do NOT wrap it in markdown code blocks (\`\`\`json or \`\`\`). Do NOT include any additional text, explanations, or formatting. The response must be a valid JSON object that can be parsed directly.`
};

// Load settings from storage when the extension starts or when settings change
async function loadSettings() {
    try {
        const loadedSettings = await chrome.storage.local.get(Object.keys(settings));
        settings = { ...settings, ...loadedSettings };
        console.log("XPath AI: Settings loaded/updated", settings);
    } catch (e) {
        console.error("XPath AI: Error loading settings:", e);
    }
}

// Initial load
loadSettings();

// Listen for changes in settings and update
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        console.log("XPath AI: Detected settings change, reloading.");
        loadSettings();
    }
});

// Listen for messages from the content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "initSelection") {
        if (request.tabId) {
            chrome.tabs.sendMessage(request.tabId, { 
                action: "activateSelection",
                useAI: request.useAI
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("XPath AI: Could not send activateSelection to content script.", chrome.runtime.lastError.message);
                } else {
                    console.log("XPath AI: activateSelection message sent to tab", request.tabId, "with useAI:", request.useAI);
                }
            });
        } else {
            console.error("XPath AI: initSelection request missing tabId.");
        }
        return true;
    }

    if (request.action === "generateXPath") {
        console.log("XPath AI: Received generateXPath request", request.data);
        handleGenerateXPathRequest(request.data)
            .then(responsePayload => {
                console.log("XPath AI: Sending success response to original sender", responsePayload);
                const storageUpdate = {
                    status: responsePayload.isAI ? 'XPath сгенерирован (ИИ)' : 'XPath сгенерирован (простой)',
                    xpath: responsePayload.primary_xpath,
                    alternativeXpath: responsePayload.alternative_xpath,
                    explanation: responsePayload.explanation,
                    error: null,
                    lastResponseIsAI: responsePayload.isAI
                };
                chrome.storage.local.set(storageUpdate, () => {
                    if (chrome.runtime.lastError) {
                        console.error("XPath AI: Error setting storage after success:", chrome.runtime.lastError.message);
                    } else {
                        console.log("XPath AI: Results stored for popup.", storageUpdate);
                    }
                });
                sendResponse({ success: true, data: responsePayload });
            })
            .catch(error => {
                console.error("XPath AI: Error processing generateXPath request:", error);
                const errorStorageUpdate = {
                    status: 'Ошибка генерации XPath',
                    xpath: '',
                    alternativeXpath: null,
                    explanation: null,
                    error: error.message || "Unknown error in background script",
                    lastResponseIsAI: false
                };
                chrome.storage.local.set(errorStorageUpdate, () => {
                     if (chrome.runtime.lastError) {
                        console.error("XPath AI: Error setting error state in storage:", chrome.runtime.lastError.message);
                    } else {
                        console.log("XPath AI: Error state stored for popup.", errorStorageUpdate);
                    }
                });
                sendResponse({ success: false, error: error.message || "Unknown error in background script" });
            });
        return true;
    } else if (request.action === "getSettings") {
        loadSettings().then(() => {
            sendResponse({ success: true, data: settings });
        });
        return true; 
    }
});

async function getAIGeneratedXPath(dom, element, prompt_template_override) {
    const prompt = generatePromptForAI(dom, element, prompt_template_override);
    if (!settings.apiServiceUrl || !settings.apiKey) {
        throw new Error("API Service URL or API Key is not configured. Please check the extension options.");
    }
    const aiResponseText = await callAIModelAPI(prompt);
    return parseAIResponse(aiResponseText, dom);
}

async function handleGenerateXPathRequest(data) {
    const { dom, element, use_ai, prompt_template_override } = data;

    let responsePayload = {};

    if (use_ai) {
        responsePayload = await getAIGeneratedXPath(dom, element, prompt_template_override);
        responsePayload.isAI = true; 
    } else {
        const simpleXPath = generateSimpleXPath(element);
        responsePayload = {
            isAI: false,
            primary_xpath: simpleXPath,
            alternative_xpath: null,
            explanation: "Generated using simple (non-AI) method."
        };
    }

    return responsePayload;
}

function generatePromptForAI(domString, elementData, promptTemplateOverride) {
    
    let template = promptTemplateOverride || settings.defaultPromptTemplate;
    let prompt = template
        .replace("{element}", elementData.html)
        .replace("{dom}", domString);
    
    if (prompt.length > settings.maxPromptLength) {
        console.warn(`XPath AI: Prompt length ${prompt.length} exceeds MAX_PROMPT_LENGTH (${settings.maxPromptLength}). Truncating DOM.`);
        // prioritize truncating the DOM part
        const elementPlaceholder = "{element}";
        const domPlaceholder = "{dom}";
        const elementPart = template.substring(0, template.indexOf(domPlaceholder));
        const domPartStructure = template.substring(template.indexOf(domPlaceholder));
        
        const fixedPartsLength = elementPart.replace(elementPlaceholder, elementData.html).length + 
                                 domPartStructure.replace(domPlaceholder, "").length;
        
        let availableDomLength = settings.maxPromptLength - fixedPartsLength;

        if (availableDomLength < 0) {
            availableDomLength = 0; // Should not happen if template is reasonable
        }

        const truncatedDom = domString.length > availableDomLength 
            ? domString.substring(0, availableDomLength) + "... (DOM truncated)"
            : domString;

        prompt = elementPart.replace(elementPlaceholder, elementData.html) + 
                 domPartStructure.replace(domPlaceholder, truncatedDom);
        
        // Final check if still too long (e.g. elementHTML is massive)
        if (prompt.length > settings.maxPromptLength) {
            prompt = prompt.substring(0, settings.maxPromptLength);
        }
        console.log(`XPath AI: Truncated prompt length: ${prompt.length}`);
    }
    
    console.log("XPath AI: Generated prompt (first 500 chars): ", prompt.substring(0,500));
    return prompt;
}

async function callAIModelAPI(prompt) {
    const headers = {
        "Authorization": `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
    };
    const payload = {
        model: settings.modelName,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        max_tokens: 512,
        stop: ["null"],
        temperature: 0.7,
        top_p: 0.7,
        top_k: 50,
        frequency_penalty: 0.5,
        n: 1,
        response_format: {"type": "text"}
    };

    console.log("XPath AI: Sending request to AI API:", settings.apiServiceUrl, "Headers:" ,JSON.stringify(headers), "Payload (preview):", JSON.stringify(payload).substring(0, 200));
    console.time("XPath AI: AI API Call");

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.warn("XPath AI: API request aborted due to timeout.");
        }, settings.requestTimeout * 1000);

        const response = await fetch(settings.apiServiceUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        console.timeEnd("XPath AI: AI API Call");

        if (!response.ok) {
            const errorBody = await response.text();
            console.error("XPath AI: API Error Response Status:", response.status, "Body:", errorBody);
            throw new Error(`AI API request failed: ${response.status} ${response.statusText}. ${errorBody}`);
        }

        const responseData = await response.json();
        console.log("XPath AI: AI API Full Response:", responseData);

        // Extract content - this is highly dependent on the API provider's response structure
        let aiGeneratedText = "";
        if (responseData.choices && responseData.choices[0] && responseData.choices[0].message && responseData.choices[0].message.content) {
            aiGeneratedText = responseData.choices[0].message.content; // OpenAI
        } else if (responseData.completion) { // Some other APIs (e.g. Anthropic older or Cohere)
            aiGeneratedText = responseData.completion;
        } else if (responseData.candidates && responseData.candidates[0] && responseData.candidates[0].content && responseData.candidates[0].content.parts && responseData.candidates[0].content.parts[0] && responseData.candidates[0].content.parts[0].text) {
            aiGeneratedText = responseData.candidates[0].content.parts[0].text; // Google Gemini
        } else {
            console.warn("XPath AI: Could not extract AI content using common patterns. Trying generic extraction.");
            // Try to find any string that looks like a response
            const findText = (obj) => {
                for (const key in obj) {
                    if (typeof obj[key] === 'string' && obj[key].length > 50) return obj[key];
                    if (typeof obj[key] === 'object' && obj[key] !== null) {
                        const found = findText(obj[key]);
                        if (found) return found;
                    }
                }
                return null;
            };
            aiGeneratedText = findText(responseData) || JSON.stringify(responseData); // Fallback to stringified JSON
            if (aiGeneratedText === JSON.stringify(responseData)) {
                 console.error("XPath AI: Failed to extract text from AI response. Full response:", responseData);
                 throw new Error("Failed to parse AI-generated text from the API response. Check API documentation and response structure.");
            } else {
                console.log("XPath AI: Fallback extraction found text:", aiGeneratedText.substring(0,100) + "...");
            }
        }

        console.log("XPath AI: AI Generated Text full:", aiGeneratedText);
        return aiGeneratedText.trim();

    } catch (error) {
        console.timeEnd("XPath AI: AI API Call"); // Ensure timer ends on error too
        if (error.name === 'AbortError') {
             throw new Error(`AI API request timed out after ${settings.requestTimeout} seconds.`);
        }
        console.error("XPath AI: Error calling AI model API:", error);
        throw error;
    }
}

function parseAIResponse(responseText, domString) {
    console.log("XPath AI: Attempting to parse AI Response. Raw (first 1000 chars):", responseText.substring(0,1000));
    try {
        let jsonStringToParse = responseText.trim();
        // First, try to extract JSON from markdown code blocks
        // Handle both complete and incomplete (truncated) code blocks
        const codeBlockPatterns = [
            // Complete code blocks
            { pattern: /```json\s*\n?([\s\S]*?)\n?\s*```/i, type: 'complete' },
            { pattern: /```JSON\s*\n?([\s\S]*?)\n?\s*```/, type: 'complete' },
            { pattern: /```\s*\n?([\s\S]*?)\n?\s*```/, type: 'complete' },
            // Incomplete/truncated code blocks
            { pattern: /```json\s*\n?([\s\S]*)$/i, type: 'truncated' },
            { pattern: /```JSON\s*\n?([\s\S]*)$/i, type: 'truncated' },
            { pattern: /```\s*\n?([\s\S]*)$/, type: 'truncated' }
        ];

        let foundInCodeBlock = false;
        for (const { pattern, type } of codeBlockPatterns) {
            const match = responseText.match(pattern);
            if (match && match[1]) {
                const extracted = match[1].trim();
                console.log(`XPath AI: Extracted candidate from ${type} code block:`, extracted.substring(0, 100) + "...");
                // Verify it looks like JSON (starts with { and contains expected keys)
                if (extracted.startsWith('{') && (extracted.includes('"primary_xpath"') || extracted.includes("'primary_xpath'"))) {
                    jsonStringToParse = extracted;
                    console.log(`XPath AI: Successfully extracted JSON from ${type} markdown code block using pattern:`, pattern.source);
                    foundInCodeBlock = true;
                    break;
                } else {
                    console.log(`XPath AI: Extracted text from ${type} block doesn't look like valid JSON, trying next pattern...`);
                }
            }
        }

        // Additional cleanup: remove any remaining markdown artifacts
        jsonStringToParse = jsonStringToParse
            .replace(/^```[a-zA-Z]*\s*\n?/, '')  // Remove opening ```language
            .replace(/\n?\s*```$/, '')           // Remove closing ```
            .trim();

        // If no code block found, try to find JSON by braces
        if (!foundInCodeBlock) {
            console.log("XPath AI: No code block found, searching for JSON by braces...");
            const firstBrace = responseText.indexOf('{');
            const lastBrace = responseText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                const potentialJson = responseText.substring(firstBrace, lastBrace + 1);
                console.log("XPath AI: Found potential JSON by braces:", potentialJson.substring(0, 100) + "...");
                // Only use if it contains expected JSON structure
                if (potentialJson.includes('"primary_xpath"') || potentialJson.includes("'primary_xpath'")) {
                    jsonStringToParse = potentialJson;
                    console.log("XPath AI: Using JSON found by braces extraction.");
                }
            }
        }
        
        // Log what we're about to parse for debugging
        console.log("XPath AI: About to parse JSON string (first 500 chars):", jsonStringToParse.substring(0, 500));
        
        // Additional validation before parsing
        if (!jsonStringToParse.trim().startsWith('{')) {
            console.warn("XPath AI: JSON string doesn't start with '{'. Full string:", jsonStringToParse);
            throw new Error("Extracted text is not valid JSON format");
        }

        let jsonData = JSON.parse(jsonStringToParse);

        const { primary_xpath, alternative_xpath, explanation } = jsonData;

        if (!primary_xpath || typeof primary_xpath !== 'string') {
            console.error("XPath AI: AI response JSON missing or invalid 'primary_xpath'.", jsonData);
            throw new Error("AI response JSON missing or invalid 'primary_xpath'.");
        }

        const result = {
            originalResponse: responseText,
            primary_xpath: primary_xpath.trim(),
            alternative_xpath: (alternative_xpath && typeof alternative_xpath === 'string') ? alternative_xpath.trim() : null,
            explanation: (explanation && typeof explanation === 'string') ? explanation.trim() : "No explanation provided in JSON."
        };

        if (!result.primary_xpath && responseText.length > 0) {
            console.warn("XPath AI: Primary XPath is empty after parsing. Using the original response as a fallback if it looks like an XPath.");
            if (responseText.startsWith("//") || responseText.startsWith(".//") || responseText.startsWith("(/")) {
                result.primary_xpath = responseText.trim().replace(/^[`"']+|[`"']+$/g, '').trim();
            }
        }

        console.log("XPath AI: Successfully parsed AI JSON Response data:", result);
        return result;

    } catch (error) {
        console.error("XPath AI: Failed to parse AI response as JSON. Error:", error.message);
        return {
            originalResponse: responseText,
            primary_xpath: "",
            alternative_xpath: null,
            explanation: `Failed to parse AI response: ${error.message}`
        };
    }
}


function generateSimpleXPath(elementData) {
    // elementData is expected to be { tag: 'div', attributes: [{name: 'id', value: 'test'}, ...], html: 'outerHTML' }
    // This structure should come from contentScript.js
    if (!elementData || !elementData.tag || !Array.isArray(elementData.attributes)) {
        console.error("XPath AI: Invalid elementData for simple XPath generation", elementData);
        return "//"; // Should not happen
    }

    const { tag, attributes } = elementData;
    let xpath = `//${tag.toLowerCase()}`;
    
    const idAttr = attributes.find(attr => attr.name && attr.name.toLowerCase() === 'id' && attr.value);
    if (idAttr) {
        xpath += `[@id='${idAttr.value}']`;
        return xpath;
    }

    const prioritizedAttrs = ['name', 'data-testid', 'role', 'type', 'value', 'placeholder', 'label', 'aria-label', 'title'];
    for (const attrName of prioritizedAttrs) {
        const attr = attributes.find(a => a.name && a.name.toLowerCase() === attrName && a.value);
        if (attr) {
            xpath += `[@${attr.name.toLowerCase()}='${attr.value}']`;
            return xpath; // Return as soon as a prioritized attribute is found
        }
    }
    
    const classAttr = attributes.find(attr => attr.name && attr.name.toLowerCase() === 'class' && attr.value);
    if (classAttr) {
        const classes = classAttr.value.trim().split(/\s+/).filter(c => c.length > 0);
        if (classes.length > 0) {
            // Prefer a more specific class if available (e.g., not just "button" or "container")
            // This is a simple heuristic; more complex logic could be added.
            const specificClass = classes.find(c => c.length > 5 && !/^(btn|button|container|wrapper|item|element|block)$/i.test(c)) || classes[0];
            xpath += `[contains(@class, '${specificClass}')]`;
        }
    }
    // Could add text content as a fallback, e.g., [normalize-space(.)='text'] but can be fragile.
    console.log("XPath AI: Generated Simple XPath:", xpath);
    return xpath; 
}

console.log("XPath AI Service Worker (background.js) started and listening.");