// ============================================================
// Field Mapper
// ============================================================
// Maps detected field types to actual profile values.
// Handles primary selection and compound fields.
// ============================================================

import type { UserProfile } from '../types/profile';
import { getPrimary } from '../types/profile';
import type { ProfileFieldKey, FieldMapping, DetectedField } from '../types/autofill';
import { resolveEducationValue } from './educationPicker';

/**
 * Resolve a profile field key to its actual value from the profile.
 */
export function resolveProfileValue(
  profile: UserProfile,
  fieldKey: ProfileFieldKey,
): string | undefined {
  const educationValue = resolveEducationValue(profile, fieldKey);
  if (educationValue !== undefined) return educationValue;

  switch (fieldKey) {
    // ---- Personal ----
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
    case 'personal.gender':
      return profile.personal.gender || undefined;

    // ---- Contact ----
    case 'contact.primaryPhoneNumber':
    case 'phones.primary':
      return getPrimary(profile.phones)?.value;
    case 'contact.primaryEmailAddress':
    case 'emails.primary':
      return getPrimary(profile.emails)?.value;
    case 'contact.personalEmailAddress':
    case 'emails.personal':
      return profile.emails.find((email) => email.label === 'Personal')?.value || getPrimary(profile.emails)?.value;
    case 'contact.universityEmailAddress':
    case 'emails.university':
      return profile.emails.find((email) => email.label === 'University')?.value;

    // ---- Address - Single Lines ----
    case 'address.primary.streetAddressLine1':
    case 'addresses.primary.line1':
      return getPrimary(profile.addresses)?.line1;
    case 'address.primary.streetAddressLine2':
    case 'addresses.primary.line2':
      return getPrimary(profile.addresses)?.line2;
    case 'address.primary.city':
    case 'addresses.primary.city':
      return getPrimary(profile.addresses)?.city;
    case 'address.primary.state':
    case 'addresses.primary.state':
      return getPrimary(profile.addresses)?.state;
    case 'address.primary.postalCode':
    case 'addresses.primary.postalCode':
      return getPrimary(profile.addresses)?.postalCode;
    case 'address.primary.country':
    case 'addresses.primary.country':
      return getPrimary(profile.addresses)?.country;
    case 'address.primary.fullAddress':
    case 'addresses.primary.full': {
      const addr = getPrimary(profile.addresses);
      if (!addr) return undefined;
      return [addr.line1, addr.line2, addr.city, addr.state, addr.postalCode, addr.country]
        .filter(Boolean)
        .join(', ');
    }

    // ---- Address - Compounds ----
    case 'address.primary.streetAddressLine1AndLine2': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.line1, addr?.line2].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.streetAddressAndCity': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.line1, addr?.city].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.streetAddressCityAndState': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.line1, addr?.city, addr?.state].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.streetAddressCityStateAndPostalCode': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.line1, addr?.city, addr?.state, addr?.postalCode].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.cityAndState':
    case 'addresses.primary.cityState': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.city, addr?.state].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.cityAndPostalCode': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.city, addr?.postalCode].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : undefined;
    }
    case 'address.primary.cityAndCountry': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.city, addr?.country].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.stateAndPostalCode': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.state, addr?.postalCode].filter(Boolean);
      return parts.length > 0 ? parts.join(' ') : undefined;
    }
    case 'address.primary.stateAndCountry': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.state, addr?.country].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.postalCodeAndCountry': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.postalCode, addr?.country].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.cityStateAndPostalCode': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.city, addr?.state, addr?.postalCode].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.cityStateAndCountry': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.city, addr?.state, addr?.country].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.cityPostalCodeAndCountry': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.city, addr?.postalCode, addr?.country].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.statePostalCodeAndCountry': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.state, addr?.postalCode, addr?.country].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }
    case 'address.primary.cityStatePostalCodeAndCountry': {
      const addr = getPrimary(profile.addresses);
      const parts = [addr?.city, addr?.state, addr?.postalCode, addr?.country].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : undefined;
    }

    // ---- Education (ug / pg / phd / highest / current / latest) ----
    // Handled by resolveEducationValue() before this switch.

    // ---- Secondary Education (12th & 10th) ----
    case 'education.twelfth.institutionName':
      return profile.secondaryEducation?.twelfth?.institution;
    case 'education.twelfth.percentage':
      return profile.secondaryEducation?.twelfth?.percentage;
    case 'education.twelfth.passingYear':
      return profile.secondaryEducation?.twelfth?.year;
    case 'education.twelfth.board':
      return profile.secondaryEducation?.twelfth?.board;
    case 'education.twelfth.stream':
      return profile.secondaryEducation?.twelfth?.stream;

    case 'education.tenth.institutionName':
      return profile.secondaryEducation?.tenth?.institution;
    case 'education.tenth.percentage':
      return profile.secondaryEducation?.tenth?.percentage;
    case 'education.tenth.passingYear':
      return profile.secondaryEducation?.tenth?.year;
    case 'education.tenth.board':
      return profile.secondaryEducation?.tenth?.board;

    // ---- Experience ----
    case 'experience.current.companyName':
    case 'experience.latest.company':
      return profile.experience[0]?.company;
    case 'experience.current.jobTitle':
    case 'experience.latest.title':
      return profile.experience[0]?.title;
    case 'experience.current.location':
    case 'experience.latest.location':
      return profile.experience[0]?.location;
    case 'experience.current.startDate':
    case 'experience.latest.startDate':
      return profile.experience[0]?.startDate;
    case 'experience.current.endDate':
    case 'experience.latest.endDate':
      return profile.experience[0]?.endDate;
    case 'experience.current.description':
    case 'experience.latest.description':
      return profile.experience[0]?.description;
    case 'experience.current.isCurrentlyEmployed':
      return profile.experience[0]?.current !== undefined ? (profile.experience[0].current ? 'Yes' : 'No') : undefined;

    // ---- Professional ----
    case 'professional.linkedinProfileUrl':
    case 'professional.linkedin':
      return profile.professional.linkedin;
    case 'professional.githubProfileUrl':
    case 'professional.github':
      return profile.professional.github;
    case 'professional.portfolioUrl':
    case 'professional.portfolio':
      return profile.professional.portfolio;
    case 'professional.skills':
      return profile.professional.skills.length > 0
        ? profile.professional.skills.join(', ')
        : undefined;

    // ---- Application ----
    case 'application.expectedJoiningDate': {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

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
