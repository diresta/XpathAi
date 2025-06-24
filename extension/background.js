// background.js - Service Worker

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
Ensure the output is a single, valid JSON object only.`
};

// Load settings from storage when the extension starts or when settings change
async function loadSettings() {
    try {
        const loadedSettings = await chrome.storage.sync.get(Object.keys(settings));
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
    if (namespace === 'sync') {
        console.log("XPath AI: Detected settings change, reloading.");
        loadSettings();
    }
});

// Listen for messages from the content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
    } else if (request.type === "initSelection") {
        if (request.tabId) {
            chrome.tabs.sendMessage(request.tabId, { type: "activateSelection" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("XPath AI: Could not send activateSelection to content script. It might not be injected or ready.", chrome.runtime.lastError.message);
                } else {
                    console.log("XPath AI: activateSelection message sent to tab", request.tabId);}
            });
        } else {
            console.error("XPath AI: initSelection request missing tabId.");}
        return true;
    }
});

async function getAIGeneratedXPath(dom, element, prompt_template_override) {
    if (!settings.apiServiceUrl || !settings.apiKey) {
        throw new Error("API Service URL or API Key is not configured. Please check the extension options.");
    }
    const prompt = generatePromptForAI(dom, element, prompt_template_override);
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
    
    console.log("XPath AI: Cleaning DOM for prompt...");
    const cleanedDom = cleanDOMForPrompt(domString);
    const elementHtml = elementData.html || '';
    
    let prompt = template
        .replace("{element}", elementHtml)
        .replace("{dom}", cleanedDom);
    
    if (prompt.length > settings.maxPromptLength) {
        console.warn(`XPath AI: Prompt length ${prompt.length} exceeds MAX_PROMPT_LENGTH (${settings.maxPromptLength}). Truncating.`);
        // prioritize truncating the DOM part
        const elementPlaceholder = "{element}";
        const domPlaceholder = "{dom}";
        const elementPart = template.substring(0, template.indexOf(domPlaceholder));
        const domPartStructure = template.substring(template.indexOf(domPlaceholder));
        
        const fixedPartsLength = elementPart.replace(elementPlaceholder, elementHtml).length + 
                                 domPartStructure.replace(domPlaceholder, "").length;
        
        let availableDomLength = settings.maxPromptLength - fixedPartsLength;

        if (availableDomLength < 0) {
            availableDomLength = 0; // Should not happen if template is reasonable
        }

        const truncatedDom = cleanedDom.length > availableDomLength 
            ? cleanedDom.substring(0, availableDomLength) + "... (DOM truncated)"
            : cleanedDom;

        prompt = elementPart.replace(elementPlaceholder, elementHtml) + 
                 domPartStructure.replace(domPlaceholder, truncatedDom);
        
        // Final check if still too long (e.g. elementHTML is massive)
        if (prompt.length > settings.maxPromptLength) {
            prompt = prompt.substring(0, settings.maxPromptLength);
        }
        console.log(`XPath AI: Truncated prompt length: ${prompt.length}`);
    }
    
    console.log("XPath AI: Generated prompt (first 500 chars):", prompt.substring(0,500));
    return prompt;
}

function cleanDOMForPrompt(domString) {
    if (typeof domString !== 'string' || domString.trim() === '') {
        return "";
    }
    console.time("XPath AI: DOM Cleaning");
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(domString, "text/html");

        const tagsToRemove = ['script', 'style', 'noscript', 'meta', 'link', 'svg', 'iframe', 'embed', 'object', 'canvas', 'audio', 'video'];
        tagsToRemove.forEach(tagName => {
            Array.from(doc.getElementsByTagName(tagName)).forEach(el => el.remove());
        });

        const commentIterator = doc.createNodeIterator(doc.documentElement, NodeFilter.SHOW_COMMENT);
        let currentNode;
        while (currentNode = commentIterator.nextNode()) {
            currentNode.remove();
        }
        
        // Remove all attributes except a few common/useful ones to reduce size and noise
        // This is aggressive and might remove necessary attributes for context.
        // Consider making this configurable or less aggressive.
        // For now, let's keep more attributes.
        /*
        doc.querySelectorAll('*').forEach(el => {
            const allowedAttrs = ['id', 'class', 'name', 'href', 'src', 'alt', 'title', 'role', 'type', 'value', 'placeholder', 'aria-label', 'aria-labelledby', 'aria-describedby', 'data-testid'];
            Array.from(el.attributes).forEach(attr => {
                if (!allowedAttrs.includes(attr.name.toLowerCase()) && !attr.name.startsWith('data-')) {
                    el.removeAttribute(attr.name);
                }
            });
        });
        */

        let cleanedHtml = doc.body ? doc.body.innerHTML : doc.documentElement.innerHTML;
        cleanedHtml = cleanedHtml.replace(/\s+/g, ' ').trim(); // Compact whitespace
        
        console.debug(`XPath AI: DOM cleaned. Original size: ${domString.length}, Cleaned size: ${cleanedHtml.length}`);
        console.timeEnd("XPath AI: DOM Cleaning");
        return cleanedHtml;

    } catch (e) {
        console.error("XPath AI: DOMParser cleaning failed, using basic regex cleaning:", e);
        // Basic regex cleaning as a fallback (less effective)
        let cleaned = domString
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
            .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "") // Remove SVG tags
            .replace(/<meta\b[^>]*>/gi, "")    // Remove meta tags
            .replace(/<link\b[^>]*>/gi, "");   // Remove link tags
        
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        console.timeEnd("XPath AI: DOM Cleaning");
        return cleaned;
    }
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
        // stream: false, 
        // max_tokens: 1024,
        // temperature: 0.5,
    };

    console.log("XPath AI: Sending request to AI API:", settings.apiServiceUrl, "Payload (preview):", JSON.stringify(payload).substring(0, 200));
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
        //console.log("XPath AI: AI API Full Response:", responseData);

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

// Renamed original parser to be used as a fallback
function parseAIResponseWithRegex(responseText, domString) {
    console.log("XPath AI: Parsing AI Response with regex (first 300 chars):", responseText.substring(0,300));
    const result = {
        originalResponse: responseText,
        primary_xpath: "",
        alternative_xpath: null,
        explanation: null
    };

    const primaryMatch = responseText.match(/1\.?\s*(?:Primary|Main)\s*XPath:?\s*([^\n`]+)/i);
    const altMatch = responseText.match(/2\.?\s*(?:Alternative|Secondary)\s*XPath:?\s*([^\n`]+)/i);
    const explanationMatch = responseText.match(/(?:3\.?\s*(?:Brief explanation|Explanation|Approach)[^:]*:?|Explanation:)\s*([\s\S]*?)(?=\n\s*(?:\d\.|<!--|$)|\Z)/i);

    if (primaryMatch && primaryMatch[1]) {
        result.primary_xpath = primaryMatch[1].trim().replace(/^[`"']+|[`"']+$/g, '').trim();
        
        if (altMatch && altMatch[1]) {
            result.alternative_xpath = altMatch[1].trim().replace(/^[`"']+|[`"']+$/g, '').trim();
        }
        
        if (explanationMatch && explanationMatch[1]) {
            result.explanation = explanationMatch[1].trim();
        }
    } else {
        // Fallback: try to find XPath-like strings if no structured response
        const lines = responseText.replace(/```(?:xpath|xml|html)?/g, "").split('\n');
        let foundXpath = null;
        for (const line of lines) {
            const trimmedLine = line.trim().replace(/^[`"']+|[`"']+$/g, '').trim();
            if ((trimmedLine.startsWith("//") || trimmedLine.startsWith(".//") || trimmedLine.startsWith("(/")) && trimmedLine.length > 5) {
                if (!trimmedLine.includes(" ") || trimmedLine.includes("[")) {
                    foundXpath = trimmedLine;
                    break;
                }
            }
            const mdXpathMatch = trimmedLine.match(/\*\*XPath:\*\*\s*([^\n`]+)/i);
            if (mdXpathMatch && mdXpathMatch[1]) {
                foundXpath = mdXpathMatch[1].trim().replace(/^[`"']+|[`"']+$/g, '').trim();
                break;
            }
        }
        if (foundXpath) {
            result.primary_xpath = foundXpath;
        } else {
            // Last resort: if response is short and seems like an XPath, use it.
            // Or use the first non-empty line.
            const firstNonEmptyLine = lines.find(line => line.trim().length > 0);
            if (responseText.length < 200 && (responseText.startsWith("//") || responseText.startsWith(".//"))) {
                 result.primary_xpath = responseText.trim().replace(/^[`"']+|[`"']+$/g, '').trim();
            } else if (firstNonEmptyLine) {
                result.primary_xpath = firstNonEmptyLine.trim().replace(/^[`"']+|[`"']+$/g, '').trim();
            } else {
                 result.primary_xpath = responseText.trim().replace(/^[`"']+|[`"']+$/g, '').trim(); // Default to the whole response
            }
            console.warn("XPath AI: Could not parse structured XPath. Fallback XPath:", result.primary_xpath);
        }
        // Try to get an explanation if not found with primary XPath
        if (!result.explanation && explanationMatch && explanationMatch[1]) {
             result.explanation = explanationMatch[1].trim();
        } else if (!result.explanation) {
            // If no structured explanation, try to find a line starting with "Explanation:" or similar
            const explLines = responseText.split('\n');
            for(const line of explLines) {
                if (line.toLowerCase().startsWith("explanation:") || line.toLowerCase().startsWith("approach:")) {
                    result.explanation = line.substring(line.indexOf(":") + 1).trim();
                    break;
                }
            }
        }
    }
    
    if (!result.primary_xpath && responseText.length > 0) {
        console.warn("XPath AI: Primary XPath is empty after parsing. Using the original response as a fallback if it looks like an XPath.");
        if (responseText.startsWith("//") || responseText.startsWith(".//") || responseText.startsWith("(/")) {
            result.primary_xpath = responseText.trim().replace(/^[`"']+|[`"']+$/g, '').trim();
        }
    }
    
    console.log("XPath AI: Parsed AI Response data:", result);
    return result;
}

function parseAIResponse(responseText, domString) {
    console.log("XPath AI: Attempting to parse AI Response. Raw (first 300 chars):", responseText.substring(0,300));
    try {
        // Attempt to find a JSON block if the response isn't pure JSON (e.g., wrapped in ```json ... ```
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
        let jsonStringToParse = responseText;

        if (jsonMatch && jsonMatch[1]) {
            jsonStringToParse = jsonMatch[1].trim();
            console.log("XPath AI: Extracted JSON block from markdown code block.");
        } else {
            // If no markdown block, try to find the first '{' and last '}' to extract a potential JSON object
            // This helps if the AI includes any prefix/suffix text around the JSON.
            const firstBrace = responseText.indexOf('{');
            const lastBrace = responseText.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
                jsonStringToParse = responseText.substring(firstBrace, lastBrace + 1);
                console.log("XPath AI: Extracted potential JSON substring from response.");
            }
        }
        
        const jsonData = JSON.parse(jsonStringToParse);

        const { primary_xpath, alternative_xpath, explanation } = jsonData;

        if (!primary_xpath || typeof primary_xpath !== 'string') {
            console.error("XPath AI: AI response JSON missing or invalid 'primary_xpath'.", jsonData);
            // If primary_xpath is missing from JSON, it's a critical failure for JSON parsing path.
            // Fallback to regex might be better here.
            throw new Error("AI response JSON missing or invalid 'primary_xpath'.");
        }

        const result = {
            originalResponse: responseText, // Still store the original full response
            primary_xpath: primary_xpath.trim(),
            alternative_xpath: (alternative_xpath && typeof alternative_xpath === 'string') ? alternative_xpath.trim() : null,
            explanation: (explanation && typeof explanation === 'string') ? explanation.trim() : "No explanation provided in JSON."
        };
        console.log("XPath AI: Successfully parsed AI JSON Response data:", result);
        return result;

    } catch (error) {
        console.warn("XPath AI: Failed to parse AI response as JSON. Error:", error.message, "Will attempt regex-based parsing as fallback.");
        return parseAIResponseWithRegex(responseText, domString); 
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