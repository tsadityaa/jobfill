// ============================================================
// Content Script
// ============================================================
// Runs on all web pages. Listens for messages from popup/background
// to scan forms, fill fields, and inject files.
//
// Pre-scan pipeline (background-initiated):
//   1. On page load → send NOTIFY_PAGE_LOADED to background
//   2. Background calls DETECT_JOB_PAGE → local scorer (zero AI)
//   3. If JOB_APPLICATION → background calls PRESCAN → regex + sanitized fields + fingerprint
//   4. Background stores result keyed by tabId
//   5. Popup click → reads cache → instant result
// ============================================================

import { hasVisibleFormFields, scanPageFields, extractSanitizedFields } from '../utils/fieldDetector';
import { fillFields } from '../utils/formFiller';
import { detectJobPage } from '../utils/jobPageDetector';
import { computeFormFingerprint } from '../utils/formFingerprint';
import type { ContentScriptRequest, ScanFieldsResponse, FillFieldsResponse, AIScanFieldsResponse, InjectFileResponse, DetectJobPageResponse, WaitForFormReadyResponse, PrescanResponse } from '../types/messages';
import type { ScanResult } from '../types/autofill';

function injectFile(fileName: string, mimeType: string, dataUrl: string): boolean {
  const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  if (fileInputs.length === 0) return false;

  // Convert base64 data URL back to a File object
  const [, b64data] = dataUrl.split(',');
  const binary = atob(b64data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const file = new File([bytes], fileName, { type: mimeType });

  // Try to find the best matching file input using label text
  let targetInput: HTMLInputElement = fileInputs[0];
  const fileNameLower = fileName.toLowerCase();

  for (const input of fileInputs) {
    const label = input.getAttribute('aria-label')?.toLowerCase() ?? '';
    const name = input.getAttribute('name')?.toLowerCase() ?? '';
    const accept = input.getAttribute('accept')?.toLowerCase() ?? '';
    const parentText = input.closest('div, section, fieldset')?.textContent?.toLowerCase() ?? '';

    // Match resume/cv inputs to resume files
    if (
      (fileNameLower.includes('resume') || fileNameLower.includes('cv') || fileNameLower.includes('docscan')) &&
      (label.includes('resume') || name.includes('resume') || parentText.includes('resume') || parentText.includes('upload'))
    ) {
      targetInput = input;
      break;
    }

    // Match photo inputs
    if (
      (fileNameLower.includes('photo') || fileNameLower.includes('img')) &&
      (label.includes('photo') || name.includes('photo') || accept.includes('image'))
    ) {
      targetInput = input;
      break;
    }
  }

  // Inject the file using DataTransfer API
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  targetInput.files = dataTransfer.files;

  // Dispatch events to notify React/Angular/Vue frameworks
  targetInput.dispatchEvent(new Event('change', { bubbles: true }));
  targetInput.dispatchEvent(new Event('input', { bubbles: true }));

  // Also simulate a drop event for sites that use drag-and-drop zones
  const dropZone = targetInput.closest('[class*="drop"], [class*="upload"], [class*="drag"]') ?? targetInput.parentElement;
  if (dropZone) {
    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    });
    dropZone.dispatchEvent(dropEvent);
  }

  // Visual feedback: brief green glow
  const rect = targetInput.getBoundingClientRect();
  const glow = document.createElement('div');
  glow.style.cssText = `
    position: absolute;
    top: ${rect.top + window.scrollY - 3}px;
    left: ${rect.left + window.scrollX - 3}px;
    width: ${rect.width + 6}px;
    height: ${rect.height + 6}px;
    border: 2px solid #22c55e;
    border-radius: 6px;
    box-shadow: 0 0 12px rgba(34,197,94,0.5);
    pointer-events: none;
    z-index: 999999;
    transition: opacity 0.5s ease;
  `;
  document.body.appendChild(glow);
  setTimeout(() => { glow.style.opacity = '0'; }, 1500);
  setTimeout(() => { glow.remove(); }, 2000);

  return true;
}

function waitForFormReady(timeoutMs = 20000): Promise<WaitForFormReadyResponse> {
  return new Promise((resolve) => {
    let finished = false;
    let mutationTimer: ReturnType<typeof setTimeout> | undefined;
    let quietTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

    const observer = new MutationObserver(scheduleCheck);
    const finish = (ready: boolean) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      if (mutationTimer) clearTimeout(mutationTimer);
      if (quietTimer) clearTimeout(quietTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      resolve({ type: 'WAIT_FOR_FORM_READY_RESULT', ready });
    };
    const check = () => {
      if (!hasVisibleFormFields()) return;
      quietTimer = setTimeout(() => {
        if (hasVisibleFormFields()) finish(true);
      }, 500);
    };
    function scheduleCheck() {
      if (mutationTimer) clearTimeout(mutationTimer);
      if (quietTimer) clearTimeout(quietTimer);
      mutationTimer = setTimeout(check, 150);
    }

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
    deadlineTimer = setTimeout(() => finish(false), timeoutMs);
    scheduleCheck();
  });
}

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',

  main() {
    // Listen for messages from popup or background
    chrome.runtime.onMessage.addListener(
      (
        message: ContentScriptRequest,
        _sender,
        sendResponse: (response: ScanFieldsResponse | FillFieldsResponse | AIScanFieldsResponse | InjectFileResponse | DetectJobPageResponse | WaitForFormReadyResponse | PrescanResponse) => void,
      ) => {
        switch (message.type) {
          case 'SCAN_FIELDS': {
            const fields = scanPageFields();
            console.log(`[JobFill] Scanned ${window.location.href}: found ${fields.length} fields`);
            const result: ScanResult = {
              url: window.location.href,
              totalFields: fields.length,
              mappedFields: fields.filter((f) => f.category === 'SAFE_AUTO').length,
              sensitiveFields: fields.filter((f) => f.category === 'USER_DECISION_REQUIRED').length,
              unknownFields: fields.filter((f) => f.category === 'UNKNOWN').length,
              fields,
            };
            sendResponse({ type: 'SCAN_FIELDS_RESULT', result });
            break;
          }

          case 'AI_SCAN_FIELDS': {
            const { sanitizedFields, selectorLookup } = extractSanitizedFields();
            sendResponse({
              type: 'AI_SCAN_FIELDS_RESULT',
              sanitizedFields,
              selectorLookup,
            });
            break;
          }

          case 'DETECT_JOB_PAGE': {
            const { classification, score } = detectJobPage();
            console.log(`[JobFill] Page classification: ${classification} (score: ${score})`);
            sendResponse({ type: 'DETECT_JOB_PAGE_RESULT', classification, score });
            break;
          }

          case 'WAIT_FOR_FORM_READY': {
            waitForFormReady().then(sendResponse);
            return true;
          }

          case 'PRESCAN': {
            // Run regex scan + sanitized field extraction + fingerprint — all synchronous DOM work
            const fields = scanPageFields();
            const scanResult: ScanResult = {
              url: window.location.href,
              totalFields: fields.length,
              mappedFields: fields.filter((f) => f.category === 'SAFE_AUTO').length,
              sensitiveFields: fields.filter((f) => f.category === 'USER_DECISION_REQUIRED').length,
              unknownFields: fields.filter((f) => f.category === 'UNKNOWN').length,
              fields,
            };
            const { sanitizedFields, selectorLookup } = extractSanitizedFields();

            // Fingerprint is async (WebCrypto SHA-256) — use async response
            computeFormFingerprint().then((fingerprint) => {
              console.log(`[JobFill] Pre-scan complete. ${fields.length} fields, fingerprint: ${fingerprint.slice(0, 8)}...`);
              sendResponse({
                type: 'PRESCAN_RESULT',
                scanResult,
                sanitizedFields,
                selectorLookup,
                fingerprint,
              });
            });

            return true; // Keep message channel open for async response
          }

          case 'FILL_FIELDS': {
            const fillResult = fillFields(message.mappings);
            sendResponse({ type: 'FILL_FIELDS_RESULT', result: fillResult });
            break;
          }

          case 'INJECT_FILE': {
            try {
              const success = injectFile(message.fileName, message.mimeType, message.dataUrl);
              if (success) {
                console.log(`[JobFill] Injected file "${message.fileName}" into file input`);
                sendResponse({ type: 'INJECT_FILE_RESULT', success: true, message: `Uploaded "${message.fileName}" successfully.` });
              } else {
                sendResponse({ type: 'INJECT_FILE_RESULT', success: false, message: 'No file upload field found on this page.' });
              }
            } catch (err) {
              console.error('[JobFill] File injection failed:', err);
              sendResponse({
                type: 'INJECT_FILE_RESULT',
                success: false,
                message: err instanceof Error ? err.message : 'File injection failed.',
              });
            }
            break;
          }
        }

        // Return true to indicate async response
        return true;
      },
    );

    // Notify background that this page is ready for detection
    // The background will send DETECT_JOB_PAGE back and trigger PRESCAN if applicable
    chrome.runtime.sendMessage({ type: 'PAGE_READY', url: window.location.href });

    console.log('[JobFill] Content script loaded.');
  },
});
