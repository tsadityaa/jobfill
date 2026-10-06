import type { DetectedField } from '../types/autofill';

const QUESTION_SIGNAL = /\b(?:why|describe|explain|tell\s+us\s+about|what|how|please\s+provide|share|elaborate)\b|\?/i;
const TEXT_INPUT_TYPES = new Set(['text', 'textarea', 'search']);

export function getApplicationQuestionText(field: Pick<DetectedField, 'attributes'>): string {
  return [
    field.attributes.labelText,
    field.attributes.ariaLabel,
    field.attributes.placeholder,
    field.attributes.helpText,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

export function isApplicationQuestionCandidate(
  field: Pick<DetectedField, 'tagName' | 'inputType' | 'attributes'>,
): boolean {
  const isTextarea = field.tagName.toLowerCase() === 'textarea' || field.inputType.toLowerCase() === 'textarea';
  if (isTextarea) return true;
  if (!TEXT_INPUT_TYPES.has(field.inputType.toLowerCase())) return false;

  const question = getApplicationQuestionText(field);
  if (!question) return false;

  return QUESTION_SIGNAL.test(question);
}

export function detectApplicationQuestions(fields: DetectedField[]): Array<{ field: DetectedField; question: string }> {
  return fields.flatMap((field) => {
    if (field.category !== 'APPLICATION_QUESTION' || field.currentValue.trim()) return [];
    return [{ field, question: getApplicationQuestionText(field) }];
  });
}