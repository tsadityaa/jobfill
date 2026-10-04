import { useEffect, useState } from 'react';
import ScanLoader from './ScanLoader';
import type { UserProfile } from '../types/profile';
import type { ScanResult, AutofillResult, FieldMapping } from '../types/autofill';
import type { ScanFieldsResponse, FillFieldsResponse, AIScanFieldsResponse } from '../types/messages';
import type { SanitizedField, FieldIdLookup } from '../types/aiMapper';
import type { QuestionTask } from '../types/questionTask';
import { createFieldMappings, resolveProfileValue } from '../utils/fieldMapper';
import { mapFieldsWithAI } from '../utils/aiMapper';
import { getTabResult, clearTabResult, GOOGLE_FORM_MAPPING_VERSION } from '../utils/mappingCache';
import { getQuestionState } from '../utils/questionTaskStore';

interface AutofillButtonProps {
  profile: UserProfile;
}

type AutofillState = 'idle' | 'scanning' | 'filling' | 'filled' | 'error';

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
  const results: T[] = [];
  // Step 1: Try main frame first (frameId 0)
  try {
    const mainResponse = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
    if (mainResponse) {
      const response = mainResponse as {
        type?: string;
        result?: { totalFields?: number; filledFields?: number };
        sanitizedFields?: unknown[];
      };
      if (response.type === 'SCAN_FIELDS_RESULT') {
        if ((response.result?.totalFields ?? 0) > 0) return [mainResponse as T];
        console.log('[Autofill] Main frame has no fields — scanning sub-frames');
      } else if (response.type === 'AI_SCAN_FIELDS_RESULT') {
        if ((response.sanitizedFields?.length ?? 0) > 0) return [mainResponse as T];
        console.log('[Autofill] Main frame has no AI fields — scanning sub-frames');
      } else if (response.type === 'FILL_FIELDS_RESULT') {
        if ((response.result?.filledFields ?? 0) > 0) return [mainResponse as T];
      } else {
        return [mainResponse as T];
      }
    }
  } catch {
    // Main frame content script not reachable — fall through to sub-frame scan
    console.warn('[Autofill] Main frame not reachable, trying sub-frames');
  }

  // Step 2: Fan out to sub-frames (only reached when main frame has 0 fields)
  if (chrome.webNavigation?.getAllFrames) {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (frames && frames.length > 0) {
        const subFrames = frames.filter((f) => f.frameId !== 0);
        console.log(`[Autofill] Scanning ${subFrames.length} sub-frames...`);
        const promises = subFrames.map(async (frame) => {
          try {
            const response = await chrome.tabs.sendMessage(tabId, message, { frameId: frame.frameId });
            if (!response) return;
            const frameResponse = response as {
              type?: string;
              result?: { totalFields?: number; filledFields?: number };
              sanitizedFields?: unknown[];
            };
            if (
              (frameResponse.type === 'SCAN_FIELDS_RESULT' && (frameResponse.result?.totalFields ?? 0) > 0)
              || (frameResponse.type === 'AI_SCAN_FIELDS_RESULT' && (frameResponse.sanitizedFields?.length ?? 0) > 0)
              || (frameResponse.type === 'FILL_FIELDS_RESULT' && (frameResponse.result?.filledFields ?? 0) > 0)
            ) {
              results.push(response as T);
            }
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

export default function AutofillButton({ profile }: AutofillButtonProps) {
  const [state, setState] = useState<AutofillState>('idle');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [fillResult, setFillResult] = useState<AutofillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiMappedCount, setAiMappedCount] = useState(0);
  const [mappingPending, setMappingPending] = useState(false);
  const [questionTasks, setQuestionTasks] = useState<QuestionTask[]>([]);
  const [questionStateObserved, setQuestionStateObserved] = useState(false);
  const [questionWatchTabId, setQuestionWatchTabId] = useState<number | null>(null);

  useEffect(() => {
    if (questionWatchTabId === null) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;

    const pollQuestionTasks = async () => {
      const questionState = await getQuestionState(questionWatchTabId);
      if (!active) return;
      setQuestionStateObserved(Boolean(questionState));
      const tasks = questionState?.tasks ?? [];
      setQuestionTasks(tasks);
      if (tasks.length > 0 && tasks.some((task) => task.status === 'RETRIEVING' || task.status === 'GENERATING' || task.status === 'FILLING' || task.status === 'READY_TO_FILL')) {
        timeout = setTimeout(() => void pollQuestionTasks(), 300);
      }
    };

    void pollQuestionTasks();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [questionWatchTabId]);

  useEffect(() => {
    const handleFormStructureUpdated = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const notice = message as { type?: string; tabId?: number };
      if (notice.type !== 'FORM_STRUCTURE_UPDATED') return;

      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (tab?.id !== notice.tabId) return;
        setState('idle');
        setScanResult(null);
        setFillResult(null);
        setError(null);
        setAiMappedCount(0);
        setMappingPending(false);
        setQuestionTasks([]);
        setQuestionStateObserved(false);
        setQuestionWatchTabId(null);
      });
    };

    chrome.runtime.onMessage.addListener(handleFormStructureUpdated);
    return () => chrome.runtime.onMessage.removeListener(handleFormStructureUpdated);
  }, []);

  const fillPreparedWork = async (tabId: number, result: ScanResult, mappings: FieldMapping[], mappingIsPending: boolean) => {
    setScanResult(result);
    setAiMappedCount(mappings.length);
    setMappingPending(mappingIsPending);
    setQuestionTasks([]);
    setQuestionStateObserved(false);
    setQuestionWatchTabId(tabId);
    setState('filling');

    void chrome.runtime.sendMessage({ type: 'TRIGGER_AUTOFILL', tabId, profileMappingPending: mappingIsPending });
    const regexMappings = createFieldMappings(result.fields, profile);
    const regexSelectors = new Set(regexMappings.map((mapping) => mapping.selector));
    const combinedMappings = [
      ...regexMappings,
      ...mappings.filter((mapping) => !regexSelectors.has(mapping.selector)),
    ];
    const fillResponses = combinedMappings.length > 0
      ? await sendToAllFrames<FillFieldsResponse>(tabId, { type: 'FILL_FIELDS', mappings: combinedMappings })
      : [];
    const fillSummary = fillResponses.reduce((summary, response) => {
      const result = response?.result;
      if (!result) return summary;
      return {
        filledFields: summary.filledFields + result.filledFields,
        skippedSensitive: summary.skippedSensitive + result.skippedSensitive,
        skippedUnknown: summary.skippedUnknown + result.skippedUnknown,
        skippedExisting: summary.skippedExisting + result.skippedExisting,
        errors: summary.errors + result.errors,
      };
    }, { filledFields: 0, skippedSensitive: 0, skippedUnknown: 0, skippedExisting: 0, errors: 0 });

    setFillResult({
      totalFields: combinedMappings.length,
      ...fillSummary,
      fields: [],
    });
    setState('filled');
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: result.mappedFields });

    if (mappingIsPending) {
      void (async () => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          const latest = await getTabResult(tabId);
          if (!latest || latest.status === 'error') break;
          if (latest.status !== 'done') continue;
          const resolved = latest.aiMappings
            .map((mapping) => ({
              ...mapping,
              value: mapping.value || resolveProfileValue(profile, mapping.profileField) || '',
            }))
            .filter((mapping) => mapping.value.length > 0);
          setAiMappedCount(resolved.length);
          setScanResult(latest.scanResult ?? result);
          break;
        }
        setMappingPending(false);
      })();
    }
  };

  const handleScan = async () => {
    setState('scanning');
    setError(null);
    setScanResult(null);
    setFillResult(null);
    setAiMappedCount(0);
    setMappingPending(false);
    setQuestionTasks([]);
    setQuestionStateObserved(false);
    setQuestionWatchTabId(null);

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
          if (r && (r.status !== 'running' || r.scanResult)) return r;
          if (Date.now() >= deadline) return r;
          await new Promise((res) => setTimeout(res, 150));
        }
      };

      let cached = await getTabResult(tab.id);

      let isGoogleFormsTab = /^https:\/\/docs\.google\.com\/forms\//i.test(tab.url ?? '')
        || /^https:\/\/docs\.google\.com\/forms\//i.test(cached?.scanResult?.url ?? '');
      if (!isGoogleFormsTab && /^https:\/\/sites\.google\.com\//i.test(tab.url ?? '')) {
        try {
          const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
          isGoogleFormsTab = (frames ?? []).some((frame) => /^https:\/\/docs\.google\.com\/forms\//i.test(frame.url));
        } catch {
          // The normal scan path remains available if frame metadata is unavailable.
        }
      }
      if (
        isGoogleFormsTab
        && cached
        && cached.googleFormMappingVersion !== GOOGLE_FORM_MAPPING_VERSION
      ) {
        await clearTabResult(tab.id);
        cached = null;
      }

      if (cached === null || cached.status === 'running') {
        console.log('[AutofillButton] Requesting background pre-scan...');
        await chrome.runtime.sendMessage({ type: 'REQUEST_PRESCAN', tabId: tab.id });
        cached = await waitForCache(30000);
      }

      if (cached?.scanResult && cached.scanResult.totalFields > 0) {
        const questionSelectors = new Set(cached.scanResult.fields
          .filter((field) => field.category === 'APPLICATION_QUESTION')
          .map((field) => field.selector));
        const resolvedCachedMappings = cached.aiMappings
          .filter((mapping) => !questionSelectors.has(mapping.selector))
          .map((mapping) => ({
            ...mapping,
            value: mapping.value || resolveProfileValue(profile, mapping.profileField) || '',
          }))
          .filter((mapping) => mapping.value.length > 0);
        const mappingsBySelector = new Map(resolvedCachedMappings.map((mapping) => [mapping.selector, mapping]));
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

        const mappingIsPending = cached.status === 'running'
          && !cached.aiMappingComplete
          && cachedScanResult.unknownFields > 0;
        await fillPreparedWork(tab.id, cachedScanResult, resolvedCachedMappings, mappingIsPending);
        return;
      }

      setState('scanning');

      // ---- Slow path: full on-demand scan (non-job pages or cache miss) ----
      console.log('[AutofillButton] No cache — running full scan pipeline');

      // Step 1: Regex scan the main frame (Layer 1+2)
      const scanResponses = await sendToAllFrames<ScanFieldsResponse>(
        tab.id,
        { type: 'SCAN_FIELDS' },
      );

      // Merge results from all frames
      const validResponses = scanResponses.filter((r) => r?.type === 'SCAN_FIELDS_RESULT' && r.result.totalFields > 0);

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
      let resolvedAiMappings: FieldMapping[] = [];

      // Step 2: If there are UNKNOWN fields, try AI mapping (Layer 3)
      if (unknownFields.length > 0) {
        try {
          // Get sanitized fields from the main frame
          const aiScanResponses = await sendToAllFrames<AIScanFieldsResponse>(
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

            // Recalculate counts
            mergedResult.mappedFields = mergedResult.fields.filter((f) => f.category === 'SAFE_AUTO').length;
            mergedResult.unknownFields = mergedResult.fields.filter((f) => f.category === 'UNKNOWN').length;
          }
        } catch (aiErr) {
          // AI failure is non-fatal — we still have regex results
          console.warn('[AI Mapper] AI mapping failed, continuing with regex results:', aiErr);
        }
      }

      await fillPreparedWork(tab.id, mergedResult, resolvedAiMappings, false);
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
    setMappingPending(false);
    setQuestionTasks([]);
    setQuestionStateObserved(false);
    setQuestionWatchTabId(null);
  };

  return (
    <div className="autofill-footer">
      {/* Fill Results */}
      {state === 'filled' && fillResult && (
        <div className="autofill-result animate-fade-in">
          {scanResult && (
            <>
              <div className="autofill-result-row">
                <span className="label">Fields detected</span>
                <span className="value">{scanResult.totalFields}</span>
              </div>
              <div className="autofill-result-row">
                <span className="label">Profile matches</span>
                <span className="value success">{scanResult.mappedFields}</span>
              </div>
              {aiMappedCount > 0 && (
                <div className="autofill-result-row">
                  <span className="label">AI mapped</span>
                  <span className="value" style={{ color: 'var(--color-pc-accent-start)' }}>{aiMappedCount}</span>
                </div>
              )}
            </>
          )}
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

      {mappingPending && (
        <div className="autofill-result animate-fade-in" aria-live="polite">
          <div className="autofill-result-row">
            <span className="label">AI mapping</span>
            <span className="value" style={{ color: 'var(--color-pc-accent-start)' }}>
              <span aria-hidden="true" style={{ display: 'inline-block', animation: 'spin 0.65s linear infinite' }}>⟳</span> Running
            </span>
          </div>
        </div>
      )}

      {questionStateObserved && (
        <div className="autofill-result animate-fade-in" aria-live="polite">
          {questionTasks.length === 0 ? (
            <div className="autofill-result-row">
              <span className="label">Text answers</span>
              <span className="value" style={{ color: 'var(--color-pc-text-muted)' }}>No question fields detected</span>
            </div>
          ) : (
            <>
              {questionTasks.some((task) => ['RETRIEVING', 'GENERATING', 'FILLING', 'READY_TO_FILL'].includes(task.status)) && (
                <div className="autofill-result-row">
                  <span className="label">Text answers</span>
                  <span className="value" style={{ color: '#3b82f6' }}>
                    <span aria-hidden="true" style={{ display: 'inline-block', animation: 'spin 0.65s linear infinite' }}>⟳</span> Working
                  </span>
                </div>
              )}
              {questionTasks.filter((task) => task.status === 'FILLED').length > 0 && (
                <div className="autofill-result-row">
                  <span className="label">Answers filled</span>
                  <span className="value success">✓ {questionTasks.filter((task) => task.status === 'FILLED').length}</span>
                </div>
              )}
              {questionTasks.some((task) => task.status === 'ERROR') && (
                <div className="autofill-result-row">
                  <span className="label">Answer issue</span>
                  <span className="value error">{questionTasks.filter((task) => task.status === 'ERROR').length} unavailable</span>
                </div>
              )}
              {questionTasks.find((task) => task.status === 'ERROR')?.error && (
                <div style={{ fontSize: '0.72rem', color: 'var(--color-pc-error)', paddingTop: '4px' }}>
                  {questionTasks.find((task) => task.status === 'ERROR')?.error}
                </div>
              )}
            </>
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
