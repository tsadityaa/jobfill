// ============================================================
// Form Filler
// ============================================================
// Fills form fields with mapped values, dispatching appropriate
// events so React/Angular/Vue forms detect the changes.
// ============================================================

import type { FieldMapping, AutofillResult, AutofillFieldResult } from '../types/autofill';

/**
 * Dispatch native DOM events that frameworks listen to.
 * This ensures React, Angular, Vue, etc. detect the value change.
 */
function dispatchInputEvents(el: HTMLElement): void {
  // Focus
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

  // Input + Change
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  // Blur
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

/**
 * Set the value of a native input using the native setter.
 * This is required for React controlled components.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )?.set;

  if (el instanceof HTMLTextAreaElement && nativeTextareaValueSetter) {
    nativeTextareaValueSetter.call(el, value);
  } else if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
}

/**
 * Fill a <select> element by matching option text or value.
 */
function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const normalizedValue = value.toLowerCase().trim();

  for (const option of el.options) {
    const optText = option.textContent?.toLowerCase().trim() ?? '';
    const optValue = option.value.toLowerCase().trim();

    if (optText === normalizedValue || optValue === normalizedValue) {
      el.value = option.value;
      dispatchInputEvents(el);
      return true;
    }
  }

  // Fuzzy match: check if option text contains the value or vice versa
  for (const option of el.options) {
    const optText = option.textContent?.toLowerCase().trim() ?? '';
    if (optText.includes(normalizedValue) || normalizedValue.includes(optText)) {
      el.value = option.value;
      dispatchInputEvents(el);
      return true;
    }
  }

  return false;
}

/**
 * Fill all mapped fields on the page.
 */
export function fillFields(mappings: FieldMapping[]): AutofillResult {
  const results: AutofillFieldResult[] = [];
  let filledCount = 0;
  let errorCount = 0;
  let skippedExisting = 0;

  for (const mapping of mappings) {
    try {
      const el = document.querySelector(mapping.selector);
      if (!el) {
        results.push({
          selector: mapping.selector,
          profileField: mapping.profileField,
          status: 'error',
          message: 'Element not found',
        });
        errorCount++;
        continue;
      }

      // Skip fields that already have values
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (el.value.trim() !== '') {
          results.push({
            selector: mapping.selector,
            profileField: mapping.profileField,
            status: 'skipped_existing',
            message: 'Field already has a value',
          });
          skippedExisting++;
          continue;
        }

        setNativeValue(el, mapping.value);
        dispatchInputEvents(el);

        // Visual feedback
        el.style.outline = '2px solid #22c55e';
        el.style.outlineOffset = '-2px';
        setTimeout(() => {
          el.style.outline = '';
          el.style.outlineOffset = '';
        }, 2000);

        results.push({
          selector: mapping.selector,
          profileField: mapping.profileField,
          status: 'filled',
        });
        filledCount++;
      } else if (el instanceof HTMLSelectElement) {
        if (fillSelect(el, mapping.value)) {
          results.push({
            selector: mapping.selector,
            profileField: mapping.profileField,
            status: 'filled',
          });
          filledCount++;
        } else {
          results.push({
            selector: mapping.selector,
            profileField: mapping.profileField,
            status: 'error',
            message: `No matching option for "${mapping.value}"`,
          });
          errorCount++;
        }
      }
    } catch (err) {
      results.push({
        selector: mapping.selector,
        profileField: mapping.profileField,
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
      errorCount++;
    }
  }

  return {
    totalFields: mappings.length,
    filledFields: filledCount,
    skippedSensitive: 0, // Already filtered out before reaching this function
    skippedUnknown: 0,
    skippedExisting,
    errors: errorCount,
    fields: results,
  };
}
