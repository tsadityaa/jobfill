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
  'personal.gender',

  'contact.primaryPhoneNumber',
  'contact.primaryEmailAddress',
  'contact.personalEmailAddress',
  'contact.universityEmailAddress',

  'address.primary.streetAddressLine1',
  'address.primary.streetAddressLine2',
  'address.primary.city',
  'address.primary.state',
  'address.primary.postalCode',
  'address.primary.country',
  'address.primary.fullAddress',

  'address.primary.streetAddressLine1AndLine2',
  'address.primary.streetAddressAndCity',
  'address.primary.streetAddressCityAndState',
  'address.primary.streetAddressCityStateAndPostalCode',

  'address.primary.cityAndState',
  'address.primary.cityAndPostalCode',
  'address.primary.cityAndCountry',
  'address.primary.stateAndPostalCode',
  'address.primary.stateAndCountry',
  'address.primary.postalCodeAndCountry',

  'address.primary.cityStateAndPostalCode',
  'address.primary.cityStateAndCountry',
  'address.primary.cityPostalCodeAndCountry',
  'address.primary.statePostalCodeAndCountry',
  'address.primary.cityStatePostalCodeAndCountry',

  'education.current.institutionName',
  'education.current.registrationNumber',
  'education.current.degree',
  'education.current.fieldOfStudy',
  'education.current.startDate',
  'education.current.endDate',
  'education.current.gpaOrPercentage',
  'education.current.isCurrentlyStudying',
  ...(['ug', 'pg', 'phd', 'highest'] as const).flatMap((level) =>
    (['institutionName', 'degree', 'fieldOfStudy', 'startDate', 'endDate', 'gpaOrPercentage'] as const)
      .map((field) => `education.${level}.${field}` as const)),
  'education.twelfth.institutionName',
  'education.twelfth.percentage',
  'education.twelfth.passingYear',
  'education.twelfth.board',
  'education.twelfth.stream',
  'education.tenth.institutionName',
  'education.tenth.percentage',
  'education.tenth.passingYear',
  'education.tenth.board',

  'experience.current.companyName',
  'experience.current.jobTitle',
  'experience.current.location',
  'experience.current.startDate',
  'experience.current.endDate',
  'experience.current.description',
  'experience.current.isCurrentlyEmployed',

  'professional.linkedinProfileUrl',
  'professional.githubProfileUrl',
  'professional.portfolioUrl',
  'professional.skills',

  'application.expectedJoiningDate',
];
