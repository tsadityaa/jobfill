// ============================================================
// Profile Type System
// ============================================================
// Array-based fields (phones, emails, addresses, education,
// experience) — never overwrite, always append/edit/remove.
// Each array item has a unique `id` and optional `primary` flag.
// ============================================================

export interface UserProfile {
  personal: PersonalInfo;
  phones: PhoneNumber[];
  emails: EmailAddress[];
  addresses: Address[];
  education: Education[];
  experience: Experience[];
  professional: ProfessionalInfo;
}

// ---- Personal ----

export interface PersonalInfo {
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth?: string; // ISO 8601 date string (YYYY-MM-DD)
}

// ---- Contact ----

export interface PhoneNumber {
  id: string;
  value: string;
  label: 'Personal' | 'Work' | 'Home' | 'Other';
  primary: boolean;
}

export interface EmailAddress {
  id: string;
  value: string;
  label: 'Personal' | 'Work' | 'University' | 'Other';
  primary: boolean;
}

// ---- Address ----

export interface Address {
  id: string;
  label: 'Permanent' | 'Current' | 'Work' | 'Other';
  primary: boolean;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

// ---- Education ----

export interface Education {
  id: string;
  institution: string;
  degree: string;
  field: string;
  startDate?: string;
  endDate?: string;
  current: boolean;
  gpa?: string;
  description?: string;
}

// ---- Experience ----

export interface Experience {
  id: string;
  company: string;
  title: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  current: boolean;
  description?: string;
}

// ---- Professional ----

export interface ProfessionalInfo {
  linkedin?: string;
  github?: string;
  portfolio?: string;
  skills: string[];
}

// ---- Helpers ----

export function createEmptyProfile(): UserProfile {
  return {
    personal: {
      firstName: '',
      lastName: '',
    },
    phones: [],
    emails: [],
    addresses: [],
    education: [],
    experience: [],
    professional: {
      skills: [],
    },
  };
}

export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get the primary item from an array, or the first item if none is primary.
 */
export function getPrimary<T extends { primary: boolean }>(
  items: T[],
): T | undefined {
  return items.find((item) => item.primary) ?? items[0];
}
