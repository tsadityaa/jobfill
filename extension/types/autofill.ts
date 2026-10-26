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
  // Personal
  | 'personal.firstName'
  | 'personal.middleName'
  | 'personal.lastName'
  | 'personal.fullName'
  | 'personal.dateOfBirth'
  | 'personal.gender'

  // Contact
  | 'contact.primaryPhoneNumber'
  | 'contact.primaryEmailAddress'
  | 'contact.personalEmailAddress'
  | 'contact.universityEmailAddress'

  // Address
  | 'address.primary.streetAddressLine1'
  | 'address.primary.streetAddressLine2'
  | 'address.primary.city'
  | 'address.primary.state'
  | 'address.primary.postalCode'
  | 'address.primary.country'
  | 'address.primary.fullAddress'

  // Compound Address
  | 'address.primary.streetAddressLine1AndLine2'
  | 'address.primary.streetAddressAndCity'
  | 'address.primary.streetAddressCityAndState'
  | 'address.primary.streetAddressCityStateAndPostalCode'
  | 'address.primary.cityAndState'
  | 'address.primary.cityAndPostalCode'
  | 'address.primary.cityAndCountry'
  | 'address.primary.stateAndPostalCode'
  | 'address.primary.stateAndCountry'
  | 'address.primary.postalCodeAndCountry'
  | 'address.primary.cityStateAndPostalCode'
  | 'address.primary.cityStateAndCountry'
  | 'address.primary.cityPostalCodeAndCountry'
  | 'address.primary.statePostalCodeAndCountry'
  | 'address.primary.cityStatePostalCodeAndCountry'

  // Education
  | 'education.current.institutionName'
  | 'education.current.registrationNumber'
  | 'education.current.degree'
  | 'education.current.fieldOfStudy'
  | 'education.current.startDate'
  | 'education.current.endDate'
  | 'education.current.gpaOrPercentage'
  | 'education.current.isCurrentlyStudying'
  // Education by level: UG / PG / PhD / highest (picked by degree text)
  | `education.${'ug' | 'pg' | 'phd' | 'highest'}.${'institutionName' | 'degree' | 'fieldOfStudy' | 'startDate' | 'endDate' | 'gpaOrPercentage'}`
  // Secondary Education (12th & 10th)
  | 'education.twelfth.institutionName'
  | 'education.twelfth.percentage'
  | 'education.twelfth.passingYear'
  | 'education.twelfth.board'
  | 'education.twelfth.stream'
  | 'education.tenth.institutionName'
  | 'education.tenth.percentage'
  | 'education.tenth.passingYear'
  | 'education.tenth.board'

  // Experience
  | 'experience.current.companyName'
  | 'experience.current.jobTitle'
  | 'experience.current.location'
  | 'experience.current.startDate'
  | 'experience.current.endDate'
  | 'experience.current.description'
  | 'experience.current.isCurrentlyEmployed'

  // Professional
  | 'professional.linkedinProfileUrl'
  | 'professional.githubProfileUrl'
  | 'professional.portfolioUrl'
  | 'professional.skills'

  // Application
  | 'application.expectedJoiningDate'

  // Legacy aliases (for backward compatibility)
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
  | 'professional.portfolio';

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
