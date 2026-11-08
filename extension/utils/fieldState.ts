import type { DetectedField } from '../types/autofill';

// Controls whose "value" is not user-typed text, or that have their own pipelines
// (choice / dropdown / file upload) with their own filled-state tracking.
const NON_TEXT = new Set(['select', 'checkbox', 'radio', 'file']);

/**
 * True when a text field already holds a value (typed by the user, filled by a previous
 * scan, or restored by the page). Such fields must not be sent to the LLM again.
 */
export function isAlreadyFilled(
  field: Pick<DetectedField, 'tagName' | 'inputType' | 'currentValue'>,
): boolean {
  if (NON_TEXT.has(field.tagName) || NON_TEXT.has(field.inputType)) return false;
  return field.currentValue.trim().length > 0;
}
