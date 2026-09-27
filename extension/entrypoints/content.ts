// ============================================================
// Content Script
// ============================================================
// Runs on all web pages. Listens for messages from popup/background
// to scan forms and fill fields.
// ============================================================

import { scanPageFields, extractSanitizedFields } from '../utils/fieldDetector';
import { fillFields } from '../utils/formFiller';
import type { ContentScriptRequest, ScanFieldsResponse, FillFieldsResponse, AIScanFieldsResponse } from '../types/messages';
import type { ScanResult } from '../types/autofill';

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
        sendResponse: (response: ScanFieldsResponse | FillFieldsResponse | AIScanFieldsResponse) => void,
      ) => {
        switch (message.type) {
          case 'SCAN_FIELDS': {
            const fields = scanPageFields();
            console.log(`[Personal Copilot] Scanned ${window.location.href}: found ${fields.length} fields`);
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

          case 'FILL_FIELDS': {
            const fillResult = fillFields(message.mappings);
            sendResponse({ type: 'FILL_FIELDS_RESULT', result: fillResult });
            break;
          }
        }

        // Return true to indicate async response
        return true;
      },
    );

    console.log('[Personal Copilot] Content script loaded.');
  },
});
