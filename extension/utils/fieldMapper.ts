// ============================================================
// Field Mapper
// ============================================================
// Maps detected field types to actual profile values.
// Handles primary selection and compound fields.
// ============================================================

import type { UserProfile } from '../types/profile';
import { getPrimary } from '../types/profile';
import type { ProfileFieldKey, FieldMapping, DetectedField } from '../types/autofill';

/**
 * Resolve a profile field key to its actual value from the profile.
 */
export function resolveProfileValue(
  profile: UserProfile,
  fieldKey: ProfileFieldKey,
): string | undefined {
  switch (fieldKey) {
    // Personal
    case 'personal.firstName':
      return profile.personal.firstName || undefined;
    case 'personal.middleName':
      return profile.personal.middleName || undefined;
    case 'personal.lastName':
      return profile.personal.lastName || undefined;
    case 'personal.fullName': {
      const parts = [
        profile.personal.firstName,
        profile.personal.middleName,
        profile.personal.lastName,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : undefined;
    }
    case 'personal.dateOfBirth':
      return profile.personal.dateOfBirth || undefined;

    // Contact
    case 'phones.primary':
      return getPrimary(profile.phones)?.value;
    case 'emails.primary':
      return getPrimary(profile.emails)?.value;

    // Address
    case 'addresses.primary.line1':
      return getPrimary(profile.addresses)?.line1;
    case 'addresses.primary.line2':
      return getPrimary(profile.addresses)?.line2;
    case 'addresses.primary.city':
      return getPrimary(profile.addresses)?.city;
    case 'addresses.primary.state':
      return getPrimary(profile.addresses)?.state;
    case 'addresses.primary.postalCode':
      return getPrimary(profile.addresses)?.postalCode;
    case 'addresses.primary.country':
      return getPrimary(profile.addresses)?.country;
    case 'addresses.primary.full': {
      const addr = getPrimary(profile.addresses);
      if (!addr) return undefined;
      return [addr.line1, addr.line2, addr.city, addr.state, addr.postalCode, addr.country]
        .filter(Boolean)
        .join(', ');
    }

    // Education
    case 'education.latest.institution':
      return profile.education[0]?.institution;
    case 'education.latest.degree':
      return profile.education[0]?.degree;
    case 'education.latest.field':
      return profile.education[0]?.field;
    case 'education.latest.gpa':
      return profile.education[0]?.gpa;
    case 'education.latest.startDate':
      return profile.education[0]?.startDate;
    case 'education.latest.endDate':
      return profile.education[0]?.endDate;

    // Experience
    case 'experience.latest.company':
      return profile.experience[0]?.company;
    case 'experience.latest.title':
      return profile.experience[0]?.title;
    case 'experience.latest.startDate':
      return profile.experience[0]?.startDate;
    case 'experience.latest.endDate':
      return profile.experience[0]?.endDate;
    case 'experience.latest.description':
      return profile.experience[0]?.description;

    // Professional
    case 'professional.linkedin':
      return profile.professional.linkedin;
    case 'professional.github':
      return profile.professional.github;
    case 'professional.portfolio':
      return profile.professional.portfolio;
    case 'professional.skills':
      return profile.professional.skills.length > 0
        ? profile.professional.skills.join(', ')
        : undefined;

    default:
      return undefined;
  }
}

/**
 * Create field mappings from detected fields and the user's profile.
 * Only creates mappings for fields that:
 * 1. Have a matched profile field
 * 2. Have a profile value available
 * 3. Are categorized as SAFE_AUTO
 */
export function createFieldMappings(
  fields: DetectedField[],
  profile: UserProfile,
): FieldMapping[] {
  const mappings: FieldMapping[] = [];

  for (const field of fields) {
    if (field.category !== 'SAFE_AUTO' || !field.profileField) continue;

    const value = resolveProfileValue(profile, field.profileField);
    if (!value) continue;

    mappings.push({
      selector: field.selector,
      profileField: field.profileField,
      value,
      confidence: field.confidence,
    });
  }

  return mappings;
}
