// ============================================================
// Education Picker
// ============================================================
// Chooses which education entry answers a question, based on the
// entry's degree text (no UI / profile schema changes needed).
//   ug / pg / phd -> entry whose degree belongs to that level
//   highest       -> highest level (PhD > PG > UG), then latest start
//   current       -> entry still being studied (highest of those),
//                    falling back to highest
// ============================================================

import type { Education, UserProfile } from '../types/profile';

export type EducationLevel = 'ug' | 'pg' | 'phd';
export type EducationSelector = EducationLevel | 'highest' | 'current' | 'latest';

const LEVEL_RANK: Record<EducationLevel, number> = { ug: 1, pg: 2, phd: 3 };

/** Classify a degree name (or a question label) as UG / PG / PhD. */
export function classifyDegree(text?: string): EducationLevel | undefined {
  const t = (text ?? '').toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!t) return undefined;
  if (/\b(phd|ph d|dphil|doctorate|doctoral|doctor of|post doctoral|postdoctoral)\b/.test(t)) return 'phd';
  if (/\b(m ?tech|m ?sc|m ?e|m ?s|m ?a|m ?com|m ?arch|m ?phil|mca|mba|pgdm|llm|master|masters|postgraduate|post graduate|pg)\b/.test(t)) return 'pg';
  if (/\b(b ?tech|b ?e|b ?sc|b ?s|b ?a|b ?com|b ?arch|bca|bba|llb|bachelor|bachelors|undergraduate|under graduate|ug)\b/.test(t)) return 'ug';
  return undefined;
}

/** Strict level detection for free-text question labels (avoids "me"/"be" false hits). */
export function classifyLevelHint(label?: string): EducationLevel | undefined {
  const t = (label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/\b(ph ?d|doctorate|doctoral|post ?doctoral)\b/.test(t)) return 'phd';
  if (/\b(pg|post ?graduate|postgraduation|post graduation|masters?|m ?tech|mba)\b/.test(t)) return 'pg';
  if (/\b(ug|under ?graduate|undergraduation|bachelors?|b ?tech)\b/.test(t)) return 'ug';
  return undefined;
}

function rank(entry: Education): number {
  const level = classifyDegree(entry.degree);
  return level ? LEVEL_RANK[level] : 0;
}

/** Highest level first; ties -> most recent start date; then profile order. */
function sortHighestFirst(entries: Education[]): Education[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      rank(b.entry) - rank(a.entry)
      || (b.entry.startDate ?? '').localeCompare(a.entry.startDate ?? '')
      || a.index - b.index)
    .map(({ entry }) => entry);
}

export function pickEducation(profile: UserProfile, selector: EducationSelector): Education | undefined {
  const sorted = sortHighestFirst(profile.education);
  if (selector === 'ug' || selector === 'pg' || selector === 'phd') {
    // Wrong-level data is worse than blank, so no fallback here.
    return sorted.find((entry) => classifyDegree(entry.degree) === selector);
  }
  if (selector === 'current') return sorted.find((entry) => entry.current) ?? sorted[0];
  return sorted[0]; // 'highest' | 'latest'
}

const FIELD_GETTERS: Record<string, (entry: Education, all: Education[]) => string | undefined> = {
  institutionName: (e) => e.institution,
  institution: (e) => e.institution,
  registrationNumber: (e, all) => e.registrationNo || all.find((item) => item.registrationNo)?.registrationNo,
  registrationNo: (e, all) => e.registrationNo || all.find((item) => item.registrationNo)?.registrationNo,
  degree: (e) => e.degree,
  fieldOfStudy: (e) => e.field,
  field: (e) => e.field,
  startDate: (e) => e.startDate,
  endDate: (e) => e.endDate,
  gpaOrPercentage: (e) => e.gpa,
  gpa: (e) => e.gpa,
  isCurrentlyStudying: (e) => (e.current !== undefined ? (e.current ? 'Yes' : 'No') : undefined),
};

const EDUCATION_KEY = /^education\.(ug|pg|phd|highest|current|latest)\.(\w+)$/;

export function isEducationLevelKey(key: string): boolean {
  return EDUCATION_KEY.test(key);
}

/** Resolve keys like "education.pg.degree". Returns undefined if not an entry-based education key. */
export function resolveEducationValue(profile: UserProfile, key: string): string | undefined {
  const match = EDUCATION_KEY.exec(key);
  if (!match) return undefined;
  const entry = pickEducation(profile, match[1] as EducationSelector);
  const value = entry && FIELD_GETTERS[match[2]]?.(entry, profile.education);
  return value || undefined;
}
