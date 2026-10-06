// ============================================================
// Autofill Type System
// ============================================================

/**
 * Category of a detected form field.
 * SAFE_AUTO — can be filled automatically from the profile.
 * APPLICATION_QUESTION — free-response question handled by the answer pipeline.
 * FILE_UPLOAD — document input handled by the file-upload pipeline.
 * USER_DECISION_REQUIRED — sensitive/legal question, must not auto-fill.
 * UNKNOWN — could not be mapped to any profile field.
 */
export type FieldCategory = 'SAFE_AUTO' | 'APPLICATION_QUESTION' | 'FILE_UPLOAD' | 'USER_DECISION_REQUIRED' | 'UNKNOWN';

/**
 * The profile field that a form input maps to.
 * Uses dot notation to reference nested profile values.
 */
export type ProfileFieldKey =
  | 'personal.firstName'
  | 'personal.middleName'
  | 'personal.lastName'
  | 'personal.fullName'
  | 'personal.dateOfBirth'
  | 'phones.primary'
  | 'emails.primary'
  | 'emails.personal'
  | 'emails.university'
  | 'addresses.primary.line1'
  | 'addresses.primary.line2'
  | 'addresses.primary.city'
  | 'addresses.primary.cityState'
  | 'addresses.primary.state'
  | 'addresses.primary.postalCode'
  | 'addresses.primary.country'
  | 'addresses.primary.full'
  | 'education.latest.institution'
  | 'education.latest.registrationNo'
  | 'education.latest.degree'
  | 'education.latest.field'
  | 'education.latest.gpa'
  | 'education.latest.startDate'
  | 'education.latest.endDate'
  | 'experience.latest.company'
  | 'experience.latest.title'
  | 'experience.latest.location'
  | 'experience.latest.startDate'
  | 'experience.latest.endDate'
  | 'experience.latest.description'
  | 'professional.linkedin'
  | 'professional.github'
  | 'professional.portfolio'
  | 'professional.skills';

/**
 * Represents a form field detected on a webpage.
 */
export interface DetectedField {
  /** CSS selector or XPath to re-locate the element */
  selector: string;
  /** The element's tag name */
  tagName: string;
  /** Input type attribute (text, email, tel, etc.) */
  inputType: string;
  /** Collected attribute values used for matching */
  attributes: {
    name?: string;
    id?: string;
    autocomplete?: string;
    placeholder?: string;
    ariaLabel?: string;
    labelText?: string;
    helpText?: string;
    maxLength?: number;
    accept?: string;
  };
  /** Matched profile field key, if any */
  profileField: ProfileFieldKey | null;
  /** Confidence of the match (0-1) */
  confidence: number;
  /** Category of the field */
  category: FieldCategory;
  /** Current value of the field (before fill) */
  currentValue: string;
}

/**
 * A mapping from a detected field to a profile value.
 */
export interface FieldMapping {
  selector: string;
  profileField: ProfileFieldKey;
  value: string;
  confidence: number;
}

/**
 * Result of filling a single field.
 */
export interface AutofillFieldResult {
  selector: string;
  profileField: ProfileFieldKey | null;
  status: 'filled' | 'skipped_sensitive' | 'skipped_unknown' | 'skipped_existing' | 'error';
  message?: string;
}

/**
 * Aggregate result of an autofill operation.
 */
export interface AutofillResult {
  totalFields: number;
  filledFields: number;
  skippedSensitive: number;
  skippedUnknown: number;
  skippedExisting: number;
  errors: number;
  fields: AutofillFieldResult[];
}

/**
 * Result of scanning a page for fillable fields.
 */
export interface ScanResult {
  url: string;
  totalFields: number;
  mappedFields: number;
  sensitiveFields: number;
  unknownFields: number;
  fields: DetectedField[];
}
