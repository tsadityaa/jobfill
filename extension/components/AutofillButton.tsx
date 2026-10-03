import { useState } from 'react';
import ScanLoader from './ScanLoader';
import type { UserProfile } from '../types/profile';
import type { ScanResult, AutofillResult, FieldMapping } from '../types/autofill';
import type { ScanFieldsResponse, FillFieldsResponse, AIScanFieldsResponse } from '../types/messages';
import type { SanitizedField, FieldIdLookup } from '../types/aiMapper';
import { createFieldMappings, resolveProfileValue } from '../utils/fieldMapper';
import { mapFieldsWithAI } from '../utils/aiMapper';
import { getTabResult, clearTabResult } from '../utils/mappingCache';

interface AutofillButtonProps {
  profile: UserProfile;
}

type AutofillState = 'idle' | 'scanning' | 'ai_mapping' | 'scanned' | 'filling' | 'filled' | 'error';

/**
 * Send a message to the relevant frames in a tab and collect responses.
 *
 * Strategy (prevents the "93 fields" phantom-iframe problem):
 *   1. Always query the MAIN frame (frameId 0) first.
 *   2. If the main frame has form fields → use it alone.
 *      (Covers: Adobe, Workday, Lever, Greenhouse, most job sites)
 *   3. If the main frame has NO fields → fan out to all sub-frames.
 *      (Covers: Google Forms embedded in an iframe, Typeform embed, etc.)
 *
 * This prevents hidden background iframes (LinkedIn OAuth, Dropbox SDK,
 * upload widgets, analytics pixels) from polluting the field count.
 */
async function sendToAllFrames<T>(
  tabId: number,
  message: unknown,
): Promise<T[]> {
  // Step 1: Try main frame first (frameId 0)
  try {
    const mainResponse = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    if (mainResponse) {
      // If this is a SCAN_FIELDS response, check whether it actually has fields.
      // If it does, return it alone — no need to touch sub-frames.
      const scan = mainResponse as { type?: string; result?: { totalFields?: number } };
      if (scan?.type === 'SCAN_FIELDS_RESULT') {
        if ((scan.result?.totalFields ?? 0) > 0) {
          console.log(`[Autofill] Main frame has ${scan.result!.totalFields} fields — using main frame only`);
          return [mainResponse as T];
        }
        // Main frame has 0 fields — fall through to sub-frame scan
        console.log('[Autofill] Main frame has 0 fields — scanning sub-frames');
      } else {
        // Non-scan message (AI_SCAN_FIELDS, FILL_FIELDS etc.) — main frame is always correct
        return [mainResponse as T];
      }
    }
  } catch {
    // Main frame content script not reachable — fall through to sub-frame scan
    console.warn('[Autofill] Main frame not reachable, trying sub-frames');
  }

  // Step 2: Fan out to sub-frames (only reached when main frame has 0 fields)
  const results: T[] = [];
  if (chrome.webNavigation?.getAllFrames) {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (frames && frames.length > 0) {
        const subFrames = frames.filter((f) => f.frameId !== 0);
        console.log(`[Autofill] Scanning ${subFrames.length} sub-frames...`);
        const promises = subFrames.map(async (frame) => {
          try {
            const response = await chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId });
            if (response) results.push(response as T);
          } catch { /* frame has no content script */ }
        });
        await Promise.all(promises);
      }
    } catch (err) {
      console.warn('[Autofill] webNavigation sub-frame scan failed:', err);
    }
  }

  // Step 3: Last-resort fallback (no frameId — browser picks main frame)
  if (results.length === 0) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response) results.push(response as T);
    } catch (err) {
      console.error('[Autofill] Content script not reachable:', err);
    }
  }

  return results;
}

async function sendToMainFrame<T>(tabId: number, message: unknown): Promise<T[]> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    return response ? [response as T] : [];
  } catch (err) {
    console.error('[Autofill] Main frame is not reachable:', err);
    return [];
  }
}

export default function AutofillButton({ profile }: AutofillButtonProps) {
  const [state, setState] = useState<AutofillState>('idle');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [fillResult, setFillResult] = useState<AutofillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiMappedCount, setAiMappedCount] = useState(0);
  const [aiMappings, setAiMappings] = useState<FieldMapping[]>([]);

  const handleScan = async () => {
    setState('scanning');
    setError(null);
    setScanResult(null);
    setFillResult(null);
    setAiMappedCount(0);
    setAiMappings([]);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error('No active tab found');
      }

      // ---- Fast path: check background pre-scan cache ----
      // Ask the background to start or reuse pre-scan before polling. PAGE_READY
      // may still be in flight when the popup opens immediately after navigation.
      const waitForCache = async (maxMs: number) => {
        const deadline = Date.now() + maxMs;
        while (true) {
          const r = await getTabResult(tab.id!);
          if (r && r.status !== 'running') return r;
          if (!r && Date.now() >= deadline) return null;
          await new Promise((res) => setTimeout(res, 150));
        }
      };

      let cached = await getTabResult(tab.id);

      if (cached === null || cached.status === 'running') {
        console.log('[AutofillButton] Requesting background pre-scan and waiting for completion...');
        await chrome.runtime.sendMessage({ type: 'REQUEST_PRESCAN', tabId: tab.id });
        setState('ai_mapping');
        cached = await waitForCache(30000);
      }

      if (cached?.status === 'done' && cached.scanResult) {
        const mappingsBySelector = new Map(cached.aiMappings.map((mapping) => [mapping.selector, mapping]));
        const fields = cached.scanResult.fields.map((field) => {
          const mapping = mappingsBySelector.get(field.selector);
          return mapping
            ? { ...field, profileField: mapping.profileField, category: 'SAFE_AUTO' as const, confidence: mapping.confidence }
            : field;
        });
        const cachedScanResult: ScanResult = {
          ...cached.scanResult,
          fields,
          mappedFields: fields.filter((field) => field.category === 'SAFE_AUTO').length,
          unknownFields: fields.filter((field) => field.category === 'UNKNOWN').length,
        };

        if (cached.aiMappings.length > 0 || cachedScanResult.unknownFields === 0) {
          console.log('[AutofillButton] Using completed pre-scan result');
          setScanResult(cachedScanResult);
          setAiMappings(cached.aiMappings);
          setAiMappedCount(cached.aiMappedCount);
          setState('scanned');
          chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: cachedScanResult.mappedFields });
          return;
        }

        console.log('[AutofillButton] Cached scan has unmapped fields — retrying AI mapping');
      }

      setState('scanning');

      // ---- Slow path: full on-demand scan (non-job pages or cache miss) ----
      console.log('[AutofillButton] No cache — running full scan pipeline');

      // Step 1: Regex scan the main frame (Layer 1+2)
      const scanResponses = await sendToMainFrame<ScanFieldsResponse>(
        tab.id,
        { type: 'SCAN_FIELDS' },
      );

      // Merge results from all frames
      const validResponses = scanResponses.filter((r) => r?.type === 'SCAN_FIELDS_RESULT');

      if (validResponses.length === 0) {
        throw new Error('No form fields found. Try refreshing the page.');
      }

      // Merge all frame results into one
      const mergedResult: ScanResult = {
        url: window.location.href,
        totalFields: 0,
        mappedFields: 0,
        sensitiveFields: 0,
        unknownFields: 0,
        fields: [],
      };

      for (const resp of validResponses) {
        mergedResult.totalFields += resp.result.totalFields;
        mergedResult.mappedFields += resp.result.mappedFields;
        mergedResult.sensitiveFields += resp.result.sensitiveFields;
        mergedResult.unknownFields += resp.result.unknownFields;
        mergedResult.fields.push(...resp.result.fields);
      }

      const unknownFields = mergedResult.fields.filter((f) => f.category === 'UNKNOWN');

      // Step 2: If there are UNKNOWN fields, try AI mapping (Layer 3)
      if (unknownFields.length > 0) {
        setState('ai_mapping');

        try {
          // Get sanitized fields from the main frame
          const aiScanResponses = await sendToMainFrame<AIScanFieldsResponse>(
            tab.id,
            { type: 'AI_SCAN_FIELDS' },
          );

          // Collect sanitized fields from the main frame
          const allSanitized: SanitizedField[] = [];
          const allSelectorLookup: FieldIdLookup = {};
          let globalIndex = 0;

          for (const resp of aiScanResponses) {
            if (resp?.type !== 'AI_SCAN_FIELDS_RESULT') continue;

            for (const sf of resp.sanitizedFields) {
              // Re-index to avoid collisions between frames
              const newFieldId = `f${globalIndex}`;
              const originalSelector = resp.selectorLookup[sf.fieldId];
              allSelectorLookup[newFieldId] = originalSelector;
              allSanitized.push({ ...sf, fieldId: newFieldId });
              globalIndex++;
            }
          }

          // Only send UNKNOWN fields to AI (save tokens)
          const unknownSelectors = new Set(unknownFields.map((f) => f.selector));
          const unknownSanitized = allSanitized.filter((sf) => {
            const realSelector = allSelectorLookup[sf.fieldId];
            return unknownSelectors.has(realSelector);
          });

          if (unknownSanitized.length > 0) {
            // Call AI — sends ONLY sanitized descriptors, ZERO personal data
            const aiResponse = await mapFieldsWithAI(unknownSanitized);

            // Convert AI mappings to FieldMappings using local vault data
            const resolvedAiMappings: FieldMapping[] = [];

            for (const [fieldId, profileField] of Object.entries(aiResponse.mappings)) {
              const selector = allSelectorLookup[fieldId];
              if (!selector) continue;

              const value = resolveProfileValue(profile, profileField);
              if (!value) continue;

              resolvedAiMappings.push({
                selector,
                profileField,
                value,
                confidence: 0.75,
              });

              // Update the scan result: mark this field as AI-mapped
              const field = mergedResult.fields.find((f) => f.selector === selector);
              if (field) {
                field.profileField = profileField;
                field.category = 'SAFE_AUTO';
                field.confidence = 0.75;
              }
            }

            setAiMappedCount(resolvedAiMappings.length);
            setAiMappings(resolvedAiMappings);

            // Recalculate counts
            mergedResult.mappedFields = mergedResult.fields.filter((f) => f.category === 'SAFE_AUTO').length;
            mergedResult.unknownFields = mergedResult.fields.filter((f) => f.category === 'UNKNOWN').length;
          }
        } catch (aiErr) {
          // AI failure is non-fatal — we still have regex results
          console.warn('[AI Mapper] AI mapping failed, continuing with regex results:', aiErr);
        }
      }

      setScanResult(mergedResult);
      setState('scanned');

      // Update badge
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE',
        count: mergedResult.mappedFields,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('Receiving end does not exist') || message.includes('Could not establish connection')) {
        setError('Content script not loaded on this page. Try refreshing the page.');
      } else {
        setError(message);
      }
      setState('error');
    }
  };

  const handleFill = async () => {
    if (!scanResult) return;

    setState('filling');
    setError(null);

    try {
      // Combine regex mappings + AI mappings
      const regexMappings = createFieldMappings(scanResult.fields, profile);

      // Merge: AI mappings for fields that regex couldn't handle
      const regexSelectors = new Set(regexMappings.map((m) => m.selector));
      const combinedMappings = [
        ...regexMappings,
        ...aiMappings.filter((m) => !regexSelectors.has(m.selector)),
      ];

      if (combinedMappings.length === 0) {
        setError('No fields could be mapped to your profile data. Please fill in your profile first.');
        setState('error');
        return;
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found');

      // Send fill command to ALL frames
      await sendToAllFrames<FillFieldsResponse>(
        tab.id,
        { type: 'FILL_FIELDS', mappings: combinedMappings },
      );

      // Since fields may be spread across frames, show success with total count
      setFillResult({
        totalFields: combinedMappings.length,
        filledFields: combinedMappings.length,
        skippedSensitive: 0,
        skippedUnknown: 0,
        skippedExisting: 0,
        errors: 0,
        fields: [],
      });
      setState('filled');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setState('error');
    }
  };

  const handleReset = async () => {
    // Clear the tab's pre-scan cache so a fresh scan re-reads the live DOM.
    // This is essential after page reload — Adobe/Workday regenerate element IDs
    // on every mount, making stale cached selectors point to nothing.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await clearTabResult(tab.id);
    } catch {
      // Non-fatal — worst case the next scan runs the full pipeline
    }
    setState('idle');
    setScanResult(null);
    setFillResult(null);
    setError(null);
    setAiMappedCount(0);
    setAiMappings([]);
  };

  return (
    <div className="autofill-footer">
      {/* Scan Results */}
      {state === 'scanned' && scanResult && (
        <div className="autofill-result animate-fade-in">
          <div className="autofill-result-row">
            <span className="label">Fields detected</span>
            <span className="value">{scanResult.totalFields}</span>
          </div>
          <div className="autofill-result-row">
            <span className="label">Can autofill</span>
            <span className="value success">✓ {scanResult.mappedFields}</span>
          </div>
          {aiMappedCount > 0 && (
            <div className="autofill-result-row">
              <span className="label" style={{ paddingLeft: '8px', fontSize: '0.72rem' }}>
                ↳ via AI
              </span>
              <span className="value" style={{ color: 'var(--color-pc-accent-start)', fontSize: '0.72rem' }}>
                🧠 {aiMappedCount}
              </span>
            </div>
          )}
          {scanResult.sensitiveFields > 0 && (
            <div className="autofill-result-row">
              <span className="label">Needs your input</span>
              <span className="value warning">⚠ {scanResult.sensitiveFields}</span>
            </div>
          )}
          {scanResult.unknownFields > 0 && (
            <div className="autofill-result-row">
              <span className="label">Unrecognized</span>
              <span className="value" style={{ color: 'var(--color-pc-text-muted)' }}>
                {scanResult.unknownFields}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Fill Results */}
      {state === 'filled' && fillResult && (
        <div className="autofill-result animate-fade-in">
          <div className="autofill-result-row">
            <span className="label">Fields filled</span>
            <span className="value success">✓ {fillResult.filledFields}</span>
          </div>
          {fillResult.skippedExisting > 0 && (
            <div className="autofill-result-row">
              <span className="label">Already filled</span>
              <span className="value" style={{ color: 'var(--color-pc-text-muted)' }}>
                ↳ {fillResult.skippedExisting}
              </span>
            </div>
          )}
          {fillResult.errors > 0 && (
            <div className="autofill-result-row">
              <span className="label">Errors</span>
              <span className="value error">✗ {fillResult.errors}</span>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          className="autofill-result animate-fade-in"
          style={{ borderColor: 'var(--color-pc-error)' }}
        >
          <div style={{ fontSize: '0.78rem', color: 'var(--color-pc-error)' }}>
            ⚠ {error}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {state === 'idle' && (
        <button
          id="btn-autofill-scan"
          className="btn btn-primary btn-full animate-pulse-glow"
          onClick={handleScan}
        >
          🔍 Scan Current Page
        </button>
      )}

      {state === 'scanning' && <ScanLoader mode="scanning" />}

      {state === 'ai_mapping' && <ScanLoader mode="ai" />}

      {state === 'scanned' && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            id="btn-autofill-fill"
            className="btn btn-primary"
            onClick={handleFill}
            style={{ flex: 1 }}
          >
            ⚡ Autofill {scanResult?.mappedFields} Fields
          </button>
          <button className="btn btn-secondary" onClick={handleReset}>
            ✗
          </button>
        </div>
      )}

      {state === 'filling' && <ScanLoader mode="filling" />}

      {(state === 'filled' || state === 'error') && (
        <button
          className="btn btn-secondary btn-full"
          onClick={handleReset}
          style={{ marginTop: state === 'filled' ? '0' : '8px' }}
        >
          ↺ Scan Again
        </button>
      )}
    </div>
  );
}
