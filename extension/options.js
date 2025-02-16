document.addEventListener('DOMContentLoaded', () => {
  const useAI = document.getElementById('useAI');
  const apiUrl = document.getElementById('apiUrl');
  const saveBtn = document.getElementById('saveBtn');
  const closeBtn = document.getElementById('closeSettings');

  chrome.storage.sync.get(['useAISetting', 'API_URL'], (data) => {
    useAI.checked = !!data.useAISetting;
    apiUrl.value = data.API_URL || '';
  });

  saveBtn.addEventListener('click', () => {
    chrome.storage.sync.set({
      useAISetting: useAI.checked,
      API_URL: apiUrl.value
    });
  });

  closeBtn.addEventListener('click', () => {
    window.close();
  });
});
