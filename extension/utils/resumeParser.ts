// ============================================================
// Resume Parser — AI-powered profile extraction from resume text
// ============================================================
// Sends raw resume text to OpenRouter and receives a structured
// UserProfile-compatible JSON back.
// ============================================================

import type { UserProfile } from '../types/profile';
import { createEmptyProfile, generateId } from '../types/profile';
import { isBackendConfigured, requestOpenRouter } from './backendClient';

const RESUME_PARSE_PROMPT = `You are a precise resume/CV parser. Extract structured profile data from the provided resume text.

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):

{
  "personal": {
    "firstName": "string",
    "middleName": "string or empty",
    "lastName": "string",
    "gender": "string or empty",
    "dateOfBirth": "YYYY-MM-DD or empty"
  },
  "phones": [
    { "value": "string", "label": "Personal", "primary": true }
  ],
  "emails": [
    { "value": "string", "label": "Personal", "primary": true }
  ],
  "addresses": [
    { "label": "Current", "primary": true, "line1": "string", "line2": "", "city": "string", "state": "string", "postalCode": "string", "country": "string" }
  ],
  "education": [
    {
      "institution": "string",
      "registrationNo": "string or empty",
      "degree": "string (e.g. B.Tech, M.Sc, MBA)",
      "field": "string (e.g. Computer Science)",
      "startDate": "MM/DD/YYYY or empty",
      "endDate": "MM/DD/YYYY or empty",
      "current": true/false,
      "gpa": "string or empty",
      "description": "string or empty"
    }
  ],
  "experience": [
    {
      "company": "string",
      "title": "string",
      "location": "string or empty",
      "startDate": "MM/DD/YYYY or empty",
      "endDate": "MM/DD/YYYY or empty",
      "current": true/false,
      "description": "string or empty"
    }
  ],
  "secondaryEducation": {
    "twelfth": { "institution": "string or empty", "percentage": "string or empty", "year": "YYYY or empty", "board": "string or empty", "stream": "string or empty" },
    "tenth": { "institution": "string or empty", "percentage": "string or empty", "year": "YYYY or empty", "board": "string or empty" }
  },
  "professional": {
    "linkedin": "URL or empty",
    "github": "URL or empty",
    "portfolio": "URL or empty",
    "skills": ["skill1", "skill2", ...]
  }
}

Rules:
1. Extract ALL information available in the resume.
2. For names, split into firstName, middleName, lastName correctly.
3. For education with no end date and appears ongoing, set current=true.
4. For skills, extract all technical and soft skills mentioned.
5. Parse dates as MM/DD/YYYY format. If only year is given, use 01/01/YYYY.
6. If a field is not found in the resume, use empty string "" or empty array [].
7. For LinkedIn/GitHub/Portfolio, extract the full URL if present.
8. Do NOT invent or hallucinate data not present in the resume.`;

/**
 * Parse resume text using AI and return a structured UserProfile.
 * @param resumeText The raw text extracted from a resume PDF/DOC
 * @returns A populated UserProfile
 */
export async function parseResumeToProfile(resumeText: string): Promise<UserProfile> {
  if (!isBackendConfigured()) {
    throw new Error('AI backend is not configured. Please set up your API keys.');
  }

  if (!resumeText || resumeText.trim().length < 50) {
    throw new Error('Resume text is too short to extract meaningful data.');
  }

  const response = await requestOpenRouter({
    model: 'openai/gpt-4o-mini',
    messages: [
      { role: 'system', content: RESUME_PARSE_PROMPT },
      { role: 'user', content: `Parse this resume:\n\n${resumeText.slice(0, 8000)}` },
    ],
    temperature: 0.1,
    max_tokens: 2000,
    response_format: { type: 'json_object' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Resume Parser] API error:', response.status, errorText);
    throw new Error('Failed to parse resume. Please try again or fill manually.');
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error('Empty response from AI. Please try again.');
  }

  const cleanText = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  const parsed = JSON.parse(cleanText);

  // Build a proper UserProfile with generated IDs
  const profile = createEmptyProfile();

  // Personal
  if (parsed.personal) {
    profile.personal.firstName = parsed.personal.firstName || '';
    profile.personal.middleName = parsed.personal.middleName || undefined;
    profile.personal.lastName = parsed.personal.lastName || '';
    profile.personal.gender = parsed.personal.gender || undefined;
    profile.personal.dateOfBirth = parsed.personal.dateOfBirth || undefined;
  }

  // Phones
  if (Array.isArray(parsed.phones)) {
    profile.phones = parsed.phones
      .filter((p: any) => p.value)
      .map((p: any, i: number) => ({
        id: generateId(),
        value: p.value,
        label: p.label || 'Personal',
        primary: i === 0,
      }));
  }

  // Emails
  if (Array.isArray(parsed.emails)) {
    profile.emails = parsed.emails
      .filter((e: any) => e.value)
      .map((e: any, i: number) => ({
        id: generateId(),
        value: e.value,
        label: e.label || 'Personal',
        primary: i === 0,
      }));
  }

  // Addresses
  if (Array.isArray(parsed.addresses)) {
    profile.addresses = parsed.addresses
      .filter((a: any) => a.line1 || a.city || a.state || a.country)
      .map((a: any, i: number) => ({
        id: generateId(),
        label: a.label || 'Current',
        primary: i === 0,
        line1: a.line1 || '',
        line2: a.line2 || '',
        city: a.city || '',
        state: a.state || '',
        postalCode: a.postalCode || '',
        country: a.country || '',
      }));
  }

  // Education
  if (Array.isArray(parsed.education)) {
    profile.education = parsed.education
      .filter((e: any) => e.institution || e.degree)
      .map((e: any) => ({
        id: generateId(),
        institution: e.institution || '',
        registrationNo: e.registrationNo || undefined,
        degree: e.degree || '',
        field: e.field || '',
        startDate: e.startDate || undefined,
        endDate: e.endDate || undefined,
        current: Boolean(e.current),
        gpa: e.gpa || undefined,
        description: e.description || undefined,
      }));
  }

  // Experience
  if (Array.isArray(parsed.experience)) {
    profile.experience = parsed.experience
      .filter((e: any) => e.company || e.title)
      .map((e: any) => ({
        id: generateId(),
        company: e.company || '',
        title: e.title || '',
        location: e.location || undefined,
        startDate: e.startDate || undefined,
        endDate: e.endDate || undefined,
        current: Boolean(e.current),
        description: e.description || undefined,
      }));
  }

  // Professional
  if (parsed.professional) {
    profile.professional.linkedin = parsed.professional.linkedin || undefined;
    profile.professional.github = parsed.professional.github || undefined;
    profile.professional.portfolio = parsed.professional.portfolio || undefined;
    profile.professional.skills = Array.isArray(parsed.professional.skills)
      ? parsed.professional.skills.filter((s: any) => typeof s === 'string' && s.trim())
      : [];
  }

  // Secondary Education (12th & 10th)
  if (parsed.secondaryEducation) {
    profile.secondaryEducation = {
      twelfth: parsed.secondaryEducation.twelfth ? {
        institution: parsed.secondaryEducation.twelfth.institution || '',
        percentage: parsed.secondaryEducation.twelfth.percentage || undefined,
        year: parsed.secondaryEducation.twelfth.year || undefined,
        board: parsed.secondaryEducation.twelfth.board || undefined,
        stream: parsed.secondaryEducation.twelfth.stream || undefined,
      } : undefined,
      tenth: parsed.secondaryEducation.tenth ? {
        institution: parsed.secondaryEducation.tenth.institution || '',
        percentage: parsed.secondaryEducation.tenth.percentage || undefined,
        year: parsed.secondaryEducation.tenth.year || undefined,
        board: parsed.secondaryEducation.tenth.board || undefined,
      } : undefined,
    };
  }

  console.log('[Resume Parser] Successfully extracted profile:', {
    name: `${profile.personal.firstName} ${profile.personal.lastName}`,
    emails: profile.emails.length,
    phones: profile.phones.length,
    education: profile.education.length,
    experience: profile.experience.length,
    skills: profile.professional.skills.length,
  });

  return profile;
}

/**
 * Check if a profile is essentially empty or only contains basic OAuth defaults.
 * A new OAuth user only has name and email from Google,
 * but no phone, education, work experience, address, or skills.
 */
export function isProfileEmpty(profile: UserProfile): boolean {
  if (!profile) return true;

  const hasEdu = Array.isArray(profile.education) && profile.education.length > 0;
  const hasExp = Array.isArray(profile.experience) && profile.experience.length > 0;
  const hasPhone = Array.isArray(profile.phones) && profile.phones.some((p) => p.value?.trim());
  const hasSkills =
    Array.isArray(profile.professional?.skills) && profile.professional.skills.length > 0;
  const hasAddress =
    Array.isArray(profile.addresses) &&
    profile.addresses.some((a) => a.line1?.trim() || a.city?.trim());

  // If user has none of these, they have not filled out their profile beyond basic OAuth credentials
  return !hasEdu && !hasExp && !hasPhone && !hasSkills && !hasAddress;
}

