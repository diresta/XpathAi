document.addEventListener('DOMContentLoaded', async () => {
  const useAI = document.getElementById('useAI');
  const apiUrl = document.getElementById('apiUrl');
  const promptTemplate = document.getElementById('promptTemplate');
  const templateSelector = document.getElementById('templateSelector');
  const saveBtn = document.getElementById('saveBtn');
  const closeBtn = document.getElementById('closeSettings');
  const saveStatus = document.getElementById('saveStatus');
  
  // Template descriptions
  const templateDescriptions = {
    'prompt_template': document.getElementById('template1-info'),
    'prompt_template2': document.getElementById('template2-info'),
    'prompt_template3': document.getElementById('template3-info'),
    'custom': document.getElementById('custom-info')
  };
  
  // Load templates
  const templates = {};
  const templateFiles = ['prompt_template', 'prompt_template2', 'prompt_template3'];
  
  try {
    await Promise.all(templateFiles.map(async (name) => {
      const response = await fetch(chrome.runtime.getURL(`templates/${name}.txt`));
      if (response.ok) {
        templates[name] = await response.text();
      } else {
        console.error(`Failed to load template: ${name}`);
      }
    }));
  } catch (error) {
    console.error("Error loading templates:", error);
  }
  
  // Update description visibility on template selection change
  function updateTemplateDescription(selectedTemplate) {
    // Hide all descriptions first
    Object.values(templateDescriptions).forEach(desc => {
      desc.style.display = 'none';
    });
    
    // Show selected template description
    if (templateDescriptions[selectedTemplate]) {
      templateDescriptions[selectedTemplate].style.display = 'block';
    }
  }
  
  // Load saved settings
  chrome.storage.sync.get(['useAISetting', 'API_URL', 'promptTemplate', 'selectedTemplate'], (data) => {
    useAI.checked = !!data.useAISetting;
    apiUrl.value = data.API_URL || 'http://localhost:8000';
    
    // Set selected template
    const selectedTemplate = data.selectedTemplate || 'prompt_template3';
    templateSelector.value = selectedTemplate;
    
    // Set template content
    if (selectedTemplate === 'custom' && data.promptTemplate) {
      promptTemplate.value = data.promptTemplate;
    } else if (templates[selectedTemplate]) {
      promptTemplate.value = templates[selectedTemplate];
    }
    
    updateTemplateDescription(selectedTemplate);
  });
  
  // Handle template selection
  templateSelector.addEventListener('change', () => {
    const selectedTemplate = templateSelector.value;
    
    if (selectedTemplate !== 'custom') {
      if (templates[selectedTemplate]) {
        promptTemplate.value = templates[selectedTemplate];
      }
    }
    
    updateTemplateDescription(selectedTemplate);
  });
  
  // Save settings
  saveBtn.addEventListener('click', () => {
    const selectedTemplate = templateSelector.value;
    
    chrome.storage.sync.set({
      useAISetting: useAI.checked,
      API_URL: apiUrl.value,
      promptTemplate: promptTemplate.value,
      selectedTemplate: selectedTemplate
    }, () => {
      saveStatus.textContent = 'Settings saved!';
      saveStatus.style.opacity = 1;
      
      setTimeout(() => {
        saveStatus.style.opacity = 0;
      }, 2000);
    });
  });
  
  // Close settings
  closeBtn.addEventListener('click', () => {
    window.close();
  });
  
  // Initial description update
  updateTemplateDescription(templateSelector.value);
});
