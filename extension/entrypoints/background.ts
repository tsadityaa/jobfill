// ============================================================
// Background Service Worker
// ============================================================
// Minimal for Phase 1. Manages badge text and relays messages.
// ============================================================

export default defineBackground(() => {
  console.log('[Personal Copilot] Background service worker started.');

  // Update badge when a tab is activated
  chrome.tabs.onActivated.addListener(async () => {
    // Clear badge on tab switch
    await chrome.action.setBadgeText({ text: '' });
  });

  // Listen for messages that need background processing
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.type === 'UPDATE_BADGE') {
      chrome.action.setBadgeText({ text: message.count > 0 ? String(message.count) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
    }
    return false;
  });
});
