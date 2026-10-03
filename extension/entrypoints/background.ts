// ============================================================
// Background Service Worker
// ============================================================
// Orchestrates the pre-scan pipeline:
//   1. Content script sends PAGE_READY on load
//   2. Background sends DETECT_JOB_PAGE → local scorer
//   3. If JOB_APPLICATION → send PRESCAN → get regex + sanitized fields + fingerprint
//   4. Check fingerprint cache — if hit, use cached AI mappings
//   5. If miss → call AI mapper for UNKNOWN fields only
//   6. Store full result in tab result cache (keyed by tabId)
//   7. Popup reads result instantly on Scan button click
// ============================================================

import { mapFieldsWithAI } from '../utils/aiMapper';
import { resolveProfileValue, createFieldMappings } from '../utils/fieldMapper';
import { cloudGetProfile } from '../utils/cloudStorage';
import { getCurrentUser } from '../utils/supabase';
import {
  getCachedMapping,
  setCachedMapping,
  setTabResult,
  clearTabResult,
} from '../utils/mappingCache';
import type { DetectJobPageResponse, PrescanResponse } from '../types/messages';
import type { FieldMapping } from '../types/autofill';
import type { SanitizedField, FieldIdLookup } from '../types/aiMapper';

/** In-memory guard: prevent concurrent pre-scans for the same tab */
const runningTabs = new Set<number>();

/**
 * Run the full pre-scan pipeline for a tab.
 * Errors are caught and stored as status:'error' — never crash the service worker.
 */
async function runPrescanPipeline(tabId: number): Promise<void> {
  if (runningTabs.has(tabId)) return; // already in progress
  runningTabs.add(tabId);

  try {
    // Mark as running so popup knows to wait if it arrives early
    await setTabResult({
      tabId,
      scanResult: null,
      aiMappings: [],
      aiMappedCount: 0,
      status: 'running',
      fingerprint: null,
    });

    // Step 1: Detect job page (local, zero AI)
    // MUST use frameId:0 — sending without frameId lets Chrome pick whichever
    // frame responds first, which could be a background LinkedIn/OAuth iframe
    // that scores NOT_JOB and causes a false negative.
    let detectResp: DetectJobPageResponse;
    try {
      detectResp = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_JOB_PAGE' }, { frameId: 0 }) as DetectJobPageResponse;
    } catch {
      // Content script not reachable on main frame — silent exit
      await clearTabResult(tabId);
      return;
    }

    // Treat both JOB_APPLICATION and POSSIBLE_JOB as worth pre-scanning.
    // POSSIBLE_JOB (score 5-9) covers pages like careers.adobe.com/apply
    // that have a strong URL signal but not yet many DOM signals at load time.
    if (detectResp?.classification === 'NOT_JOB') {
      console.log(`[JobFill BG] Tab ${tabId}: not a job page (score too low), skipping pre-scan`);
      await setTabResult({
        tabId,
        scanResult: null,
        aiMappings: [],
        aiMappedCount: 0,
        status: 'not_job',
        fingerprint: null,
      });
      return;
    }

    console.log(`[JobFill BG] Tab ${tabId}: job page detected (${detectResp?.classification}) — starting pre-scan`);

    // Step 2: Pre-scan (regex + sanitized fields + fingerprint)
    // Always target the main frame — avoids picking up hidden iframe fields.
    let prescanResp: PrescanResponse;
    try {
      prescanResp = await chrome.tabs.sendMessage(tabId, { type: 'PRESCAN' }, { frameId: 0 }) as PrescanResponse;
    } catch (err) {
      console.warn(`[JobFill BG] Tab ${tabId}: PRESCAN failed`, err);
      await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
      return;
    }

    const { scanResult, sanitizedFields, selectorLookup, fingerprint } = prescanResp;

    // Step 3: Check fingerprint cache for AI mappings
    const cached = await getCachedMapping(fingerprint);
    if (cached) {
      console.log(`[JobFill BG] Tab ${tabId}: fingerprint cache HIT (${fingerprint.slice(0, 8)}...) — no AI needed`);
      await setTabResult({
        tabId,
        scanResult,
        aiMappings: cached.aiMappings,
        aiMappedCount: cached.aiMappedCount,
        status: 'done',
        fingerprint,
      });
      return;
    }

    // Step 4: Load profile to resolve values (needed for AI mapping resolution)
    let profile;
    try {
      const user = await getCurrentUser();
      if (!user) throw new Error('not authenticated');
      profile = await cloudGetProfile();
    } catch {
      // No profile — store regex-only result and exit
      console.warn(`[JobFill BG] Tab ${tabId}: profile not available, storing regex-only result`);
      await setTabResult({ tabId, scanResult, aiMappings: [], aiMappedCount: 0, status: 'done', fingerprint });
      return;
    }

    // Step 5: Only send UNKNOWN fields to AI (key token saver)
    const unknownFields = scanResult.fields.filter((f) => f.category === 'UNKNOWN');
    let aiMappings: FieldMapping[] = [];
    let aiMappedCount = 0;

    if (unknownFields.length > 0) {
      const unknownSelectors = new Set(unknownFields.map((f) => f.selector));

      // Re-index to only the unknown subset
      const unknownSanitized: SanitizedField[] = [];
      const unknownLookup: FieldIdLookup = {};
      let idx = 0;

      for (const sf of sanitizedFields) {
        const realSelector = selectorLookup[sf.fieldId];
        if (unknownSelectors.has(realSelector)) {
          const newId = `f${idx}`;
          unknownLookup[newId] = realSelector;
          unknownSanitized.push({ ...sf, fieldId: newId });
          idx++;
        }
      }

      if (unknownSanitized.length > 0) {
        console.log(`[JobFill BG] Tab ${tabId}: sending ${unknownSanitized.length}/${scanResult.totalFields} UNKNOWN fields to AI`);
        try {
          const aiResponse = await mapFieldsWithAI(unknownSanitized);

          for (const [fieldId, profileField] of Object.entries(aiResponse.mappings)) {
            const selector = unknownLookup[fieldId];
            if (!selector) continue;
            const value = resolveProfileValue(profile, profileField);
            if (!value) continue;

            aiMappings.push({ selector, profileField, value, confidence: 0.75 });

            // Update scan result so counts are correct
            const field = scanResult.fields.find((f) => f.selector === selector);
            if (field) {
              field.profileField = profileField;
              field.category = 'SAFE_AUTO';
              field.confidence = 0.75;
            }
          }

          aiMappedCount = aiMappings.length;

          // Recalculate merged counts
          scanResult.mappedFields = scanResult.fields.filter((f) => f.category === 'SAFE_AUTO').length;
          scanResult.unknownFields = scanResult.fields.filter((f) => f.category === 'UNKNOWN').length;
        } catch (aiErr) {
          console.warn(`[JobFill BG] Tab ${tabId}: AI mapping failed, using regex-only result`, aiErr);
        }
      }
    } else {
      // All fields mapped by regex — also add regex-mapped values
      aiMappings = createFieldMappings(scanResult.fields, profile);
    }

    // Step 6: Cache the AI result by fingerprint so future visits are instant
    if (aiMappings.length > 0) {
      await setCachedMapping({
        fingerprint,
        aiMappings,
        aiMappedCount,
        cachedAt: new Date().toISOString(),
      });
    }

    // Step 7: Store final result for popup pickup
    await setTabResult({ tabId, scanResult, aiMappings, aiMappedCount, status: 'done', fingerprint });
    console.log(`[JobFill BG] Tab ${tabId}: pre-scan complete. ${scanResult.mappedFields} fields ready.`);

    // Update badge
    if (scanResult.mappedFields > 0) {
      chrome.action.setBadgeText({ text: String(scanResult.mappedFields), tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6', tabId });
    }
  } catch (err) {
    console.error(`[JobFill BG] Tab ${tabId}: pipeline error`, err);
    await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
  } finally {
    runningTabs.delete(tabId);
  }
}

export default defineBackground(() => {
  console.log('[JobFill] Background service worker started.');

  // Clear badge on tab switch
  chrome.tabs.onActivated.addListener(async () => {
    await chrome.action.setBadgeText({ text: '' });
  });

  // Clear cached result when user navigates away (new URL = new form)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      await clearTabResult(tabId);
      runningTabs.delete(tabId);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, _sendResponse) => {
    if (message.type === 'REQUEST_PRESCAN') {
      const tabId = message.tabId;
      if (Number.isInteger(tabId)) runPrescanPipeline(tabId);
      return false;
    }

    // Content script notifies us it's loaded and ready
    if (message.type === 'PAGE_READY') {
      const tabId = sender.tab?.id;
      if (tabId == null) return false;

      // Kick off background pre-scan pipeline (fire-and-forget — errors handled internally)
      runPrescanPipeline(tabId);
      return false;
    }

    if (message.type === 'UPDATE_BADGE') {
      chrome.action.setBadgeText({ text: message.count > 0 ? String(message.count) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
    }

    return false;
  });
});
