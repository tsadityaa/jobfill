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

/// <reference types="chrome" />

import { getElementBySelector, hasVisibleFormFields, scanPageFields, extractSanitizedFields } from '../utils/fieldDetector';
import { fillFields, fillQuestionAnswer } from '../utils/formFiller';
import { detectJobPage } from '../utils/jobPageDetector';
import { computeFormFingerprint } from '../utils/formFingerprint';
import type { ContentScriptRequest, ScanFieldsResponse, FillFieldsResponse, AIScanFieldsResponse, InjectFileResponse, DetectJobPageResponse, WaitForFormReadyResponse, PrescanResponse } from '../types/messages';
import type { ScanResult } from '../types/autofill';
import { applyChoiceDecisions, extractChoiceFormAnswers, scanChoiceControls } from '../utils/choiceControls';
import type { ChoiceApplyResponse, ChoiceScanResponse } from '../types/choice';

let lastPrescannedFingerprint: string | null = null;
const questionBorderOverlays = new Map<string, { target: HTMLElement; overlay: HTMLDivElement }>();

function refreshQuestionBorderPositions(): void {
  for (const [selector, item] of questionBorderOverlays) {
    if (!item.target.isConnected) {
      item.overlay.remove();
      questionBorderOverlays.delete(selector);
      continue;
    }
    const rect = item.target.getBoundingClientRect();
    item.overlay.style.width = `${rect.width}px`;
    item.overlay.style.height = `${rect.height}px`;
    item.overlay.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    item.overlay.style.borderRadius = getComputedStyle(item.target).borderRadius;
  }
}

window.addEventListener('scroll', refreshQuestionBorderPositions, true);
window.addEventListener('resize', refreshQuestionBorderPositions);

function setQuestionBorderPending(selector: string, pending: boolean): void {
  const current = questionBorderOverlays.get(selector);
  if (!pending) {
    current?.overlay.remove();
    questionBorderOverlays.delete(selector);
    return;
  }
  if (current) return;

  const target = getElementBySelector(selector);
  if (!(target instanceof HTMLElement)) return;

  const styleId = 'jobfill-question-border-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = '@property --jobfill-question-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; } @keyframes jobfill-question-rotate { to { --jobfill-question-angle: 360deg; } } .jobfill-question-border { position: fixed; top: 0; left: 0; box-sizing: border-box; padding: 2px; z-index: 2147483646; pointer-events: none; background: conic-gradient(from var(--jobfill-question-angle), transparent 0deg 265deg, #168bff 300deg, #a9ddff 330deg, transparent 355deg); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude; animation: jobfill-question-rotate 1.1s linear infinite; }';
    document.documentElement.appendChild(style);
  }

  const overlay = document.createElement('div');
  overlay.className = 'jobfill-question-border';
  overlay.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(overlay);
  questionBorderOverlays.set(selector, { target, overlay });
  refreshQuestionBorderPositions();
}

function observeFormStructureChanges(): void {
  if (window.self !== window.top || !document.documentElement) return;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  const observer = new MutationObserver(() => {
    if (!lastPrescannedFingerprint) return;
    revision++;
    const observedRevision = revision;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const fingerprint = await computeFormFingerprint();
      if (observedRevision !== revision || fingerprint === lastPrescannedFingerprint) return;

      lastPrescannedFingerprint = fingerprint;
      chrome.runtime.sendMessage({ type: 'FORM_STRUCTURE_CHANGED', fingerprint }).catch((err) => {
        console.warn('[JobFill] Failed to notify background about a changed form:', err);
      });
    }, 700);
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['id', 'name', 'type', 'class', 'style', 'hidden', 'aria-label', 'aria-labelledby', 'placeholder'],
  });
}

function injectFile(fileName: string, mimeType: string, dataUrl: string, selector?: string): boolean {
  const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  if (fileInputs.length === 0 && !selector) return false;

  let targetInput: HTMLInputElement;
  if (selector) {
    const element = getElementBySelector(selector);
    if (!(element instanceof HTMLInputElement) || element.type !== 'file') return false;
    targetInput = element;
  } else {
    targetInput = fileInputs[0];
  }

  // Convert base64 data URL back to a File object
  const [, b64data] = dataUrl.split(',');
  const binary = atob(b64data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const file = new File([bytes], fileName, { type: mimeType });
  const acceptedTypes = targetInput.accept.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (acceptedTypes.length > 0) {
    const extension = `.${fileName.split('.').pop()?.toLowerCase() ?? ''}`;
    const isAccepted = acceptedTypes.some((accepted) =>
      accepted === extension
      || accepted === mimeType.toLowerCase()
      || (accepted.endsWith('/*') && mimeType.toLowerCase().startsWith(accepted.slice(0, -1))),
    );
    if (!isAccepted) return false;
  }

  // Keep legacy manual upload behavior when no field selector is specified.
  const fileNameLower = fileName.toLowerCase();

  if (!selector) for (const input of fileInputs) {
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
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  runAt: 'document_idle',

  main() {
    observeFormStructureChanges();

    // Listen for messages from popup or background
    chrome.runtime.onMessage.addListener(
      (
        message: ContentScriptRequest,
        _sender,
        sendResponse: (response: ScanFieldsResponse | FillFieldsResponse | AIScanFieldsResponse | InjectFileResponse | DetectJobPageResponse | WaitForFormReadyResponse | PrescanResponse | ChoiceScanResponse | ChoiceApplyResponse | { type: 'QUESTION_ANSWER_FILLED'; success: boolean }) => void,
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
              lastPrescannedFingerprint = fingerprint;
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

          case 'CHOICE_SCAN': {
            scanChoiceControls().then((controls) => {
              sendResponse({ type: 'CHOICE_SCAN_RESULT', controls, formAnswers: extractChoiceFormAnswers() });
            }).catch((error) => {
              console.warn('[JobFill] Choice scan failed:', error);
              sendResponse({ type: 'CHOICE_SCAN_RESULT', controls: [], formAnswers: [] });
            });
            return true;
          }

          case 'CHOICE_APPLY': {
            applyChoiceDecisions(message.decisions).then((result) => {
              sendResponse({ type: 'CHOICE_APPLY_RESULT', ...result });
            }).catch((error) => {
              console.warn('[JobFill] Choice application failed:', error);
              sendResponse({ type: 'CHOICE_APPLY_RESULT', applied: [], unresolved: message.decisions.map((decision) => decision.controlId) });
            });
            return true;
          }

          case 'FILL_FIELDS': {
            const fillResult = fillFields(message.mappings);
            sendResponse({ type: 'FILL_FIELDS_RESULT', result: fillResult });
            break;
          }

          case 'SET_QUESTION_PENDING': {
            for (const selector of message.selectors) setQuestionBorderPending(selector, message.pending);
            sendResponse({ type: 'QUESTION_ANSWER_FILLED', success: true });
            break;
          }

          case 'FILL_QUESTION_ANSWER': {
            let success = false;
            try {
              const element = getElementBySelector(message.selector);
              if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                if (element.value.trim()) {
                  setQuestionBorderPending(message.selector, false);
                  sendResponse({ type: 'QUESTION_ANSWER_FILLED', success: true });
                  break;
                }
                success = fillQuestionAnswer(element, message.answer);
                if (success) setQuestionBorderPending(message.selector, false);
              }
            } catch {
              success = false;
            }
            sendResponse({ type: 'QUESTION_ANSWER_FILLED', success });
            break;
          }

          case 'INJECT_FILE': {
            try {
              const success = injectFile(message.fileName, message.mimeType, message.dataUrl, message.selector);
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
