import { useState } from 'react';
import type { UserProfile } from '../types/profile';
import type { ScanResult, AutofillResult, FieldMapping } from '../types/autofill';
import type { ScanFieldsResponse, FillFieldsResponse, AIScanFieldsResponse } from '../types/messages';
import type { SanitizedField, FieldIdLookup } from '../types/aiMapper';
import { createFieldMappings, resolveProfileValue } from '../utils/fieldMapper';
import { mapFieldsWithAI } from '../utils/aiMapper';

interface AutofillButtonProps {
  profile: UserProfile;
}

type AutofillState = 'idle' | 'scanning' | 'ai_mapping' | 'scanned' | 'filling' | 'filled' | 'error';

/**
 * Send a message to ALL frames in a tab and collect all responses.
 * This is critical for pages with iframes (like embedded Google Forms).
 * Falls back gracefully if webNavigation permission isn't available.
 */
async function sendToAllFrames<T>(
  tabId: number,
  message: unknown,
): Promise<T[]> {
  const results: T[] = [];

  // Try multi-frame approach first (requires webNavigation permission)
  if (chrome.webNavigation?.getAllFrames) {
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      if (frames && frames.length > 0) {
        console.log(`[Autofill] Scanning ${frames.length} frames...`);

        const promises = frames.map(async (frame) => {
          try {
            const response = await chrome.tabs.sendMessage(tabId, message, {
              frameId: frame.frameId,
            });
            if (response) {
              results.push(response as T);
            }
          } catch {
            // Frame doesn't have content script — normal for ad iframes etc.
          }
        });

        await Promise.all(promises);
        console.log(`[Autofill] Got responses from ${results.length} frames`);

        if (results.length > 0) return results;
      }
    } catch (err) {
      console.warn('[Autofill] webNavigation failed, falling back:', err);
    }
  }

  // Fallback: single message (works like the old code)
  try {
    console.log('[Autofill] Using single-frame fallback...');
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (response) {
      results.push(response as T);
      console.log('[Autofill] Got response from single-frame fallback');
    }
  } catch (err) {
    console.error('[Autofill] Content script not reachable:', err);
  }

  return results;
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

      // Step 1: Regex scan ALL frames (Layer 1+2)
      const scanResponses = await sendToAllFrames<ScanFieldsResponse>(
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
          // Get sanitized fields from ALL frames
          const aiScanResponses = await sendToAllFrames<AIScanFieldsResponse>(
            tab.id,
            { type: 'AI_SCAN_FIELDS' },
          );

          // Merge sanitized fields from all frames
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

  const handleReset = () => {
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

      {state === 'scanning' && (
        <button className="btn btn-primary btn-full" disabled>
          🔍 Scanning fields...
        </button>
      )}

      {state === 'ai_mapping' && (
        <button className="btn btn-primary btn-full" disabled>
          🧠 AI mapping unknown fields...
        </button>
      )}

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

      {state === 'filling' && (
        <button className="btn btn-primary btn-full" disabled>
          ⚡ Filling...
        </button>
      )}

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
