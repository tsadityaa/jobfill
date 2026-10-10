// ============================================================
// AI Mapper Type Definitions
// ============================================================
// Types for the secure AI-powered field mapping system.
// The AI only receives sanitized field descriptors — NEVER
// personal data, field values, or page content.
// ============================================================

import type { ProfileFieldKey } from './autofill';

/**
 * Sanitized field descriptor sent to the AI.
 * Deliberately excludes: value, textContent, surrounding DOM text.
 */
export interface SanitizedField {
  /** Opaque ID ("f0", "f1", ...) — no connection to real selectors */
  fieldId: string;
  /** HTML tag: "input", "select", "textarea" */
  tag: string;
  /** Input type: "text", "tel", "email", "date", "select", "textarea" */
  type: string;
  /** Visible label text (from <label>, aria-label, etc.) */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** HTML name attribute (may be obscure like "entry.123456") */
  name?: string;
  /** autocomplete attribute */
  autocomplete?: string;
  /** aria-label attribute */
  ariaLabel?: string;
  /** For <select>: visible option labels (NOT values) */
  options?: string[];
}

export interface GoogleFormLabelField {
  fieldId: string;
  label: string;
}

/**
 * Local-only lookup that maps opaque fieldIds back to real CSS selectors.
 * This NEVER leaves the browser.
 */
export interface FieldIdLookup {
  [fieldId: string]: string; // fieldId → CSS selector
}

/**
 * Request payload sent to the AI API.
 * Contains ZERO personal data.
 */
export interface AIMappingRequest {
  fields: SanitizedField[];
  intentKeys: string[];
}

/**
 * Response from the AI API.
 * Just field-to-intent mappings, nothing else.
 */
export interface AIMappingResponse {
  mappings: Record<string, ProfileFieldKey>;
  completed?: boolean;
}

/**
 * All available profile field keys that the AI can map to.
 * This list is sent to the AI so it knows what options it has.
 */
export const ALL_INTENT_KEYS: ProfileFieldKey[] = [
  'personal.firstName',
  'personal.middleName',
  'personal.lastName',
  'personal.fullName',
  'personal.dateOfBirth',
  'phones.primary',
  'emails.primary',
  'addresses.primary.line1',
  'addresses.primary.line2',
  'addresses.primary.city',
  'addresses.primary.state',
  'addresses.primary.postalCode',
  'addresses.primary.country',
  'addresses.primary.full',
  'education.latest.institution',
  'education.latest.degree',
  'education.latest.field',
  'education.latest.gpa',
  'education.latest.startDate',
  'education.latest.endDate',
  'experience.latest.company',
  'experience.latest.title',
  'experience.latest.location',
  'experience.latest.startDate',
  'experience.latest.endDate',
  'experience.latest.description',
  'professional.linkedin',
  'professional.github',
  'professional.portfolio',
  'professional.skills',
];
