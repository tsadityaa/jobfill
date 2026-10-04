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

/// <reference types="chrome" />

import { mapFieldsWithAI } from '../utils/aiMapper';
import { ALL_INTENT_KEYS } from '../types/aiMapper';
import { resolveProfileValue } from '../utils/fieldMapper';
import { cloudGetProfile } from '../utils/cloudStorage';
import {
  getCachedMapping,
  setCachedMapping,
  setTabResult,
  getTabResult,
  clearTabResult,
  GOOGLE_FORM_MAPPING_VERSION,
} from '../utils/mappingCache';
import type { DetectJobPageResponse, PrescanResponse, WaitForFormReadyResponse } from '../types/messages';
import type { FieldMapping } from '../types/autofill';
import type { ProfileFieldKey } from '../types/autofill';
import type { SanitizedField, FieldIdLookup, GoogleFormLabelField } from '../types/aiMapper';

/** In-memory guard: prevent concurrent pre-scans for the same tab */
const runningTabs = new Set<number>();
const pendingPrescanTabs = new Set<number>();
const pendingGoogleFormFrames = new Map<number, number>();
const GOOGLE_FORM_INTENT_KEYS: ProfileFieldKey[] = [
  ...ALL_INTENT_KEYS,
  'education.latest.registrationNo',
  'addresses.primary.cityState',
];
const GOOGLE_FORM_INTENT_DESCRIPTIONS: Partial<Record<ProfileFieldKey, string>> = {
  'education.latest.registrationNo': 'A student identifier recorded with education, such as an academic registration, enrollment, or roll identifier assigned by a school, college, or university.',
  'addresses.primary.cityState': 'The primary address city and state combined into a single text value.',
};

function isGoogleFormsUrl(url: string): boolean {
  return /^https:\/\/docs\.google\.com\/forms\//i.test(url);
}

function getGoogleFormAICandidates(
  fields: SanitizedField[],
  selectorLookup: FieldIdLookup,
  unknownSelectors: Set<string>,
): { fields: GoogleFormLabelField[]; intentKeys: ProfileFieldKey[] } {
  const candidates: GoogleFormLabelField[] = [];

  for (const field of fields) {
    const selector = selectorLookup[field.fieldId];
    if (!selector || !unknownSelectors.has(selector)) continue;

    const label = (field.label ?? field.ariaLabel ?? field.placeholder ?? '')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) continue;
    candidates.push({ fieldId: field.fieldId, label });
  }

  return { fields: candidates, intentKeys: GOOGLE_FORM_INTENT_KEYS };
}

async function findGoogleFormsFrameId(tabId: number): Promise<number | null> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const formFrame = frames?.find((frame) => isGoogleFormsUrl(frame.url));
    return formFrame?.frameId ?? null;
  } catch {
    return null;
  }
}

async function getTabFrameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames && frames.length > 0) {
      const frameIds: number[] = [];
      for (const frame of frames as Array<{ frameId: number }>) {
        if (!frameIds.includes(frame.frameId)) frameIds.push(frame.frameId);
      }
      return frameIds.sort((a, b) => {
        if (a === 0) return -1;
        if (b === 0) return 1;
        return a - b;
      });
    }
  } catch {
    // Some tabs/pages may not expose webNavigation frame metadata; keep it simple.
  }
  return [0];
}

async function detectJobFrame(tabId: number): Promise<{ frameId: number; response: DetectJobPageResponse } | null> {
  const frameIds = await getTabFrameIds(tabId);
  let best: { frameId: number; response: DetectJobPageResponse } | null = null;

  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_JOB_PAGE' }, { frameId }) as DetectJobPageResponse;
      if (!response) continue;
      if (response.classification === 'NOT_JOB') continue;
      if (!best || response.score > best.response.score) {
        best = { frameId, response };
      }
    } catch {
      // Frame may not have the content script yet or may be a blank shell.
    }
  }

  if (best) return best;

  // Final fallback: main frame only. This preserves the original not-job logic.
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_JOB_PAGE' }, { frameId: 0 }) as DetectJobPageResponse;
    if (response && response.classification !== 'NOT_JOB') {
      return { frameId: 0, response };
    }
  } catch {
    // No main content script available.
  }

  return null;
}

/**
 * Run the full pre-scan pipeline for a tab.
 * Errors are caught and stored as status:'error' — never crash the service worker.
 */
async function runPrescanPipeline(tabId: number, googleFormsFrameId?: number): Promise<void> {
  if (runningTabs.has(tabId)) {
    pendingPrescanTabs.add(tabId);
    return;
  }
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

    // Step 1: Detect job page on the relevant frame, not just the top-level shell.
    // Some ATS portals render the real application form inside a sub-frame, which
    // means main-frame detection can incorrectly classify the page as NOT_JOB.
    let frameId = googleFormsFrameId;
    if (frameId === undefined) {
      let detectedFrame: { frameId: number; response: DetectJobPageResponse } | null;
      try {
        detectedFrame = await detectJobFrame(tabId);
      } catch {
        await clearTabResult(tabId);
        return;
      }

      if (!detectedFrame || detectedFrame.response.classification === 'NOT_JOB') {
        console.log(`[JobFill BG] Tab ${tabId}: not a job page (no qualifying frame found), skipping pre-scan`);
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
      frameId = detectedFrame.frameId;
      console.log(`[JobFill BG] Tab ${tabId}: job page detected (${detectedFrame.response.classification}) on frame ${frameId} — starting pre-scan`);
    } else {
      console.log(`[JobFill BG] Tab ${tabId}: using Google Forms frame ${frameId} — starting fast pre-scan`);
    }

    // Workday and other SPA forms can hydrate after document_idle. Wait for
    // visible controls and a short DOM quiet period before taking the one snapshot.
    let readiness: WaitForFormReadyResponse;
    try {
      readiness = await chrome.tabs.sendMessage(
        tabId,
        { type: 'WAIT_FOR_FORM_READY' },
        { frameId },
      ) as WaitForFormReadyResponse;
    } catch (err) {
      console.warn(`[JobFill BG] Tab ${tabId}: form readiness check failed on frame ${frameId}`, err);
      await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
      return;
    }

    if (!readiness?.ready) {
      console.warn(`[JobFill BG] Tab ${tabId}: no visible form became ready before timeout in frame ${frameId}`);
      await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
      return;
    }

    // Step 2: Pre-scan the relevant frame that actually holds the form.
    let prescanResp: PrescanResponse;
    try {
      prescanResp = await chrome.tabs.sendMessage(tabId, { type: 'PRESCAN' }, { frameId }) as PrescanResponse;
    } catch (err) {
      console.warn(`[JobFill BG] Tab ${tabId}: PRESCAN failed on frame ${frameId}`, err);
      await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
      return;
    }

    const { scanResult, sanitizedFields, selectorLookup, fingerprint } = prescanResp;
    const isGoogleForm = isGoogleFormsUrl(scanResult.url);

    // Step 3: Check fingerprint cache for AI mappings
    const cached = await getCachedMapping(fingerprint);
    if (cached && (!isGoogleForm || (cached.googleFormMappingVersion === GOOGLE_FORM_MAPPING_VERSION && cached.aiMappingComplete))) {
      console.log(`[JobFill BG] Tab ${tabId}: fingerprint cache HIT (${fingerprint.slice(0, 8)}...) — no AI needed`);
      await setTabResult({
        tabId,
        scanResult,
        aiMappings: cached.aiMappings,
        aiMappedCount: cached.aiMappedCount,
        aiMappingComplete: true,
        googleFormMappingVersion: isGoogleForm ? GOOGLE_FORM_MAPPING_VERSION : undefined,
        status: 'done',
        fingerprint,
      });
      return;
    }

    if (isGoogleForm) {
      for (const field of scanResult.fields) {
        const normalizedLabel = (field.attributes.labelText ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        if (/^(reg|registration|roll) no(?:mber)?$/.test(normalizedLabel) || normalizedLabel === 'name') {
          field.profileField = null;
          field.category = 'UNKNOWN';
          field.confidence = 0;
        }
      }

      const unknownSelectors = new Set(
        scanResult.fields.filter((field) => field.category === 'UNKNOWN').map((field) => field.selector),
      );
      const aiCandidates = getGoogleFormAICandidates(sanitizedFields, selectorLookup, unknownSelectors);
      let aiMappings: FieldMapping[] = [];
      let aiMappedCount = 0;

      if (aiCandidates.fields.length > 0 && aiCandidates.intentKeys.length > 0) {
        try {
          const aiResponse = await mapFieldsWithAI(aiCandidates.fields, {
            googleForm: true,
            allowedIntentKeys: aiCandidates.intentKeys,
            intentDescriptions: GOOGLE_FORM_INTENT_DESCRIPTIONS,
            timeoutMs: 4000,
          });

          for (const [fieldId, profileField] of Object.entries(aiResponse.mappings)) {
            const selector = selectorLookup[fieldId];
            if (!selector) continue;

            aiMappings.push({ selector, profileField, value: '', confidence: 0.75 });
          }

          aiMappedCount = aiMappings.length;
        } catch (error) {
          console.warn(`[JobFill BG] Tab ${tabId}: Google Forms AI mapping failed; keeping local matches`, error);
        }
      }

      await setCachedMapping({
        fingerprint,
        aiMappings,
        aiMappedCount,
        googleFormMappingVersion: GOOGLE_FORM_MAPPING_VERSION,
        aiMappingComplete: true,
        cachedAt: new Date().toISOString(),
      });

      await setTabResult({
        tabId,
        scanResult,
        aiMappings,
        aiMappedCount,
        aiMappingComplete: true,
        googleFormMappingVersion: GOOGLE_FORM_MAPPING_VERSION,
        status: 'done',
        fingerprint,
      });
      if (scanResult.mappedFields > 0) {
        chrome.action.setBadgeText({ text: String(scanResult.mappedFields), tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6', tabId });
      }
      console.log(`[JobFill BG] Tab ${tabId}: Google Forms mapping complete. ${scanResult.mappedFields} fields ready; ${aiMappedCount} mapped by AI.`);
      return;
    }

    // Step 4: Only send UNKNOWN fields to AI; recognized forms need no profile fetch here.
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
          const mappedIntents = Object.entries(aiResponse.mappings);

          if (mappedIntents.length > 0) {
            const profile = await cloudGetProfile();

            for (const [fieldId, profileField] of mappedIntents) {
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
          }

          aiMappedCount = aiMappings.length;

          // Recalculate merged counts
          scanResult.mappedFields = scanResult.fields.filter((f) => f.category === 'SAFE_AUTO').length;
          scanResult.unknownFields = scanResult.fields.filter((f) => f.category === 'UNKNOWN').length;
        } catch (aiErr) {
          console.warn(`[JobFill BG] Tab ${tabId}: AI mapping failed, using regex-only result`, aiErr);
        }
      }
    }

    // Step 5: Cache AI results by fingerprint so future visits are instant
    if (aiMappings.length > 0) {
      await setCachedMapping({
        fingerprint,
        aiMappings,
        aiMappedCount,
        cachedAt: new Date().toISOString(),
      });
    }

    // Step 6: Store final result for popup pickup
    await setTabResult({ tabId, scanResult, aiMappings, aiMappedCount, aiMappingComplete: true, status: 'done', fingerprint });
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
    if (pendingPrescanTabs.delete(tabId)) {
      void runPrescanPipeline(tabId);
    } else if (pendingGoogleFormFrames.has(tabId)) {
      const pendingFrameId = pendingGoogleFormFrames.get(tabId)!;
      pendingGoogleFormFrames.delete(tabId);
      void getTabResult(tabId).then((result) => {
        if (!result || result.status === 'not_job' || result.status === 'error' || !result.scanResult?.totalFields) {
          void runPrescanPipeline(tabId, pendingFrameId);
        }
      });
    }
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
      if (Number.isInteger(tabId) && !runningTabs.has(tabId)) {
        void findGoogleFormsFrameId(tabId).then((frameId) => {
          if (!runningTabs.has(tabId)) void runPrescanPipeline(tabId, frameId ?? undefined);
        });
      }
      return false;
    }

    // Content script notifies us it's loaded and ready
    if (message.type === 'PAGE_READY') {
      const tabId = sender.tab?.id;
      if (tabId == null) return false;

      const frameId = sender.frameId ?? 0;
      const frameUrl = sender.url ?? (typeof message.url === 'string' ? message.url : '');
      const isGoogleFormsFrame = isGoogleFormsUrl(frameUrl);
      const isGoogleSitesShell = frameId === 0 && /^https:\/\/sites\.google\.com\//i.test(frameUrl);
      if (isGoogleSitesShell) return false;
      if (frameId !== 0 && !isGoogleFormsFrame) return false;
      if (runningTabs.has(tabId)) {
        if (isGoogleFormsFrame) pendingGoogleFormFrames.set(tabId, frameId);
        return false;
      }

      if (isGoogleFormsFrame) {
        void getTabResult(tabId).then((result) => {
          if (runningTabs.has(tabId)) {
            pendingGoogleFormFrames.set(tabId, frameId);
          } else if (!result || result.status === 'not_job' || result.status === 'error' || !result.scanResult?.totalFields) {
            void runPrescanPipeline(tabId, frameId);
          }
        });
        return false;
      }

      // Kick off background pre-scan pipeline (fire-and-forget — errors handled internally)
      runPrescanPipeline(tabId);
      return false;
    }

    if (message.type === 'FORM_STRUCTURE_CHANGED') {
      const tabId = sender.tab?.id;
      if (tabId == null || sender.frameId !== 0) return false;

      void clearTabResult(tabId).then(async () => {
        await chrome.runtime.sendMessage({ type: 'FORM_STRUCTURE_UPDATED', tabId }).catch((err) => {
          console.warn(`[JobFill BG] Tab ${tabId}: popup update notification failed`, err);
        });
        await runPrescanPipeline(tabId);
      });
      return false;
    }

    if (message.type === 'UPDATE_BADGE') {
      chrome.action.setBadgeText({ text: message.count > 0 ? String(message.count) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
    }

    return false;
  });
});
