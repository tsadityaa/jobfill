import type { UserProfile } from '../types/profile';
import { classifyDegree, pickEducation } from './educationPicker';
import type { ChoiceControl, ChoiceDecision, ChoiceEvidence, ChoiceOption } from '../types/choice';
import { isBackendConfigured, requestOpenRouter } from './backendClient';

const CHOICE_CACHE_KEY = 'jf_choice_decisions_v8';
const CHOICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_CHOICES = 80;

interface ChoiceCacheEntry {
  decision: ChoiceDecision;
  cachedAt: number;
}

type ChoiceCache = Record<string, ChoiceCacheEntry>;

function normalize(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferDegreeLevel(degree: string): string {
  const norm = normalize(degree);
  if (/\b(phd|doctorate|doctoral|doctor of)\b/.test(norm)) return "Doctorate / Ph.D";
  if (/\b(master|masters|m tech|mtech|mba|msc|ms degree|m e)\b/.test(norm)) return "Master's Degree";
  if (/\b(bachelor|bachelors|b tech|btech|b e|bsc|bs degree|undergrad|undergraduate)\b/.test(norm)) return "Bachelor's Degree";
  if (/\b(diploma|associate|polytechnic)\b/.test(norm)) return "Diploma / Associate Degree";
  if (/\b(high school|secondary|12th|10th|matriculation)\b/.test(norm)) return "High School";
  return degree || "Degree";
}

function getFacts(profile: UserProfile): Array<{ section: string; value: string }> {
  const fullName = [profile.personal.firstName, profile.personal.middleName, profile.personal.lastName].filter(Boolean).join(' ');
  const firstName = profile.personal.firstName?.trim() || '';
  const currentExperiences = profile.experience.filter((item) => item.current || !item.endDate || /present|current|now/i.test(item.endDate));
  const isCurrentlyEmployed = currentExperiences.length > 0;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const highestEducation = profile.education.slice().sort((a, b) => {
    const rankA = degreeRank(degreeLevel(a.degree) || '');
    const rankB = degreeRank(degreeLevel(b.degree) || '');
    return rankB - rankA;
  })[0];

  return [
    // Current Date for timeline/age/academic year reasoning by LLM
    { section: 'system', value: `Current Date: ${todayStr}` },

    // Personal & Identity (no email/phone — redacted for privacy)
    { section: 'personal', value: `Full Name: ${fullName}` },
    ...(firstName ? [{ section: 'personal', value: `First Name: ${firstName}` }] : []),
    {
      section: 'personal',
      value: `Gender: ${profile.personal.gender?.trim() ? profile.personal.gender.trim() : `Not explicitly set in settings (infer from candidate first name "${firstName}")`}`,
    },
    ...(profile.personal.dateOfBirth ? [{ section: 'personal', value: `Date of Birth: ${profile.personal.dateOfBirth}` }] : []),

    // Current Employment Status Summary
    {
      section: 'employment_status',
      value: isCurrentlyEmployed
        ? `Current Employment Status: Employed (Currently working as ${currentExperiences.map((e) => [e.title, e.company].filter(Boolean).join(' at ')).join(', ')})`
        : profile.experience.length > 0
          ? `Current Employment Status: Not currently employed / Seeking employment (Previous roles: ${profile.experience.map((e) => [e.title, e.company].filter(Boolean).join(' at ')).join(', ')})`
          : 'Current Employment Status: Student / Fresher / Seeking Entry-level Role',
    },

    // Detailed Work Experience
    ...profile.experience.flatMap((item) => {
      const isCurrent = item.current || !item.endDate || /present|current|now/i.test(item.endDate);
      const dates = [item.startDate, item.endDate || (isCurrent ? 'Present' : '')].filter(Boolean).join(' - ');
      const status = isCurrent ? 'CURRENT ACTIVE JOB (Currently Employed)' : 'Past Employment';
      const role = [item.title, item.company].filter(Boolean).join(' at ');
      const loc = item.location ? ` in ${item.location}` : '';
      const desc = item.description ? ` (${item.description})` : '';
      return [
        { section: 'experience', value: `Position: ${role}${loc}${dates ? ` (${dates})` : ''} [${status}]${desc}` },
      ];
    }),

    // Highest Education Level Summary
    ...(highestEducation ? [{
      section: 'education_level',
      value: `Highest Level of Education: ${inferDegreeLevel(highestEducation.degree)} (${highestEducation.degree} in ${highestEducation.field || 'General'}${highestEducation.institution ? ` from ${highestEducation.institution}` : ''})`,
    }] : []),

    // Detailed Education History
    ...profile.education.flatMap((item) => {
      const isCurrentEdu = item.current || (!item.endDate && !item.startDate);
      const dates = [item.startDate, item.endDate || (isCurrentEdu ? 'Present / Ongoing' : '')].filter(Boolean).join(' - ');
      const status = item.current ? 'Currently Pursuing' : 'Completed Degree';
      const level = inferDegreeLevel(item.degree);
      const degField = [item.degree, item.field].filter(Boolean).join(' in ');
      const inst = item.institution ? ` from ${item.institution}` : '';
      const gpa = item.gpa ? `, GPA: ${item.gpa}` : '';
      const regNo = item.registrationNo ? `, Reg/Roll No: ${item.registrationNo}` : '';
      return [
        { section: 'education', value: `Degree: ${degField} [Degree Level: ${level}]${inst}${dates ? ` (${dates})` : ''} [Status: ${status}]${gpa}${regNo}` },
      ];
    }),

    // Secondary Education (12th & 10th)
    ...(profile.secondaryEducation?.twelfth?.institution ? [{
      section: 'education_12th',
      value: `Class 12th / PUC / Junior College: ${profile.secondaryEducation.twelfth.institution}${profile.secondaryEducation.twelfth.percentage ? ` (Percentage/Score: ${profile.secondaryEducation.twelfth.percentage})` : ''}${profile.secondaryEducation.twelfth.year ? ` (Passing Year: ${profile.secondaryEducation.twelfth.year})` : ''}${profile.secondaryEducation.twelfth.board ? ` (Board: ${profile.secondaryEducation.twelfth.board})` : ''}${profile.secondaryEducation.twelfth.stream ? ` (Stream: ${profile.secondaryEducation.twelfth.stream})` : ''}`,
    }] : []),
    ...(profile.secondaryEducation?.tenth?.institution ? [{
      section: 'education_10th',
      value: `Class 10th / Secondary High School: ${profile.secondaryEducation.tenth.institution}${profile.secondaryEducation.tenth.percentage ? ` (Percentage/Score: ${profile.secondaryEducation.tenth.percentage})` : ''}${profile.secondaryEducation.tenth.year ? ` (Passing Year: ${profile.secondaryEducation.tenth.year})` : ''}${profile.secondaryEducation.tenth.board ? ` (Board: ${profile.secondaryEducation.tenth.board})` : ''}`,
    }] : []),

    // Skills
    ...(profile.professional.skills.length ? [{ section: 'skills', value: `Skills: ${profile.professional.skills.join(', ')}` }] : []),

    // Locations & Addresses
    ...profile.addresses.map((item) => ({
      section: 'address',
      value: `Location (${item.label}): ${[item.line1, item.line2, item.city, item.state, item.postalCode, item.country].filter(Boolean).join(', ')}`,
    })),

    // NOTE: Phone and Email are intentionally EXCLUDED from AI evidence for privacy.
    // They are only used by the text-input autofill pipeline, not the choice resolver.

    // Professional links
    { section: 'professional', value: `Links: ${[profile.professional.linkedin, profile.professional.github, profile.professional.portfolio].filter(Boolean).join(' | ')}` },

    // Affirmative Job Screening Stances
    { section: 'screening_intent', value: 'Willingness to Relocate: Yes, willing and ready to relocate for work or internship.' },
    { section: 'screening_intent', value: 'Work Mode: Willing and comfortable working on-site, hybrid, and remote.' },
    { section: 'screening_intent', value: 'Availability & Internship: Available immediately, open to 6-month internships and full-time positions.' },
    { section: 'screening_intent', value: 'Work Authorization: Legally authorized to work without restrictions; does NOT require visa sponsorship.' },
    { section: 'screening_intent', value: 'Declarations & Background Checks: Consents to background checks and drug screenings; confirms statements are truthful.' },
  ].filter((fact) => fact.value.trim());
}

export function getRelevantProfileFacts(profile: UserProfile, _question?: string): string[] {
  // Always supply the complete structured profile facts to the AI.
  // Never omit sections based on regex keywords so the AI has 100% full context.
  return getFacts(profile).map((fact) => `${fact.section}: ${fact.value}`);
}

function optionIsGeneric(option: ChoiceOption): boolean {
  return /^(choose|select|select one|please select|other|none|none of the above|not applicable|prefer not to say|unknown)$/i.test(normalize(option.label));
}

function isPlaceholderOption(option: ChoiceOption): boolean {
  return /^(choose|select|select one|please select)$/i.test(normalize(option.label));
}

function degreeLevel(value: string): string | null {
  const text = normalize(value);
  if (/\b(phd|doctorate|doctoral|doctor of)\b/.test(text)) return 'doctorate';
  if (/\b(master|masters|m tech|mtech|mba|msc|ms degree)\b/.test(text)) return 'masters';
  if (/\b(bachelor|bachelors|b tech|btech|b e degree|b e |undergraduate|undergrad|bsc|be degree)\b/.test(text)) return 'bachelors';
  if (/\b(associate|associates|diploma)\b/.test(text)) return 'associate';
  if (/\b(high school|secondary school|12th grade)\b/.test(text)) return 'secondary';
  return null;
}

function degreeLevelFromOption(option: ChoiceOption): string | null {
  const level = degreeLevel(option.label);
  if (level) return level;
  const label = normalize(option.label);
  if (/\b(graduate|postgraduate)\b/.test(label)) return 'masters';
  return null;
}

function degreeRank(level: string): number {
  return ({ secondary: 1, associate: 2, bachelors: 3, masters: 4, doctorate: 5 } as Record<string, number>)[level] ?? 0;
}

function optionMatchesFact(option: ChoiceOption, facts: string[]): boolean {
  if (optionIsGeneric(option)) return false;
  const candidate = normalize(option.label);
  if (candidate.length < 2) return false;
  const candidateTokens = candidate.split(' ').filter((token) => token.length > 1 || /[+#]/.test(token));
  return facts.some((fact) => {
    const normalizedFact = normalize(fact);
    if (normalizedFact === candidate || normalizedFact.includes(` ${candidate} `)
      || normalizedFact.startsWith(`${candidate} `) || normalizedFact.endsWith(` ${candidate}`)) return true;
    const factTokens = new Set(normalizedFact.split(' '));
    return candidateTokens.length > 1 && candidateTokens.every((token) => factTokens.has(token));
  });
}

function findPolarity(options: ChoiceOption[], positive: boolean): ChoiceOption | undefined {
  const patterns = positive
    ? /^(yes|true|i do|i am|employed|currently employed|student|current student)$/i
    : /^(no|false|i do not|i am not|not employed|unemployed)$/i;
  return options.find((option) => patterns.test(normalize(option.label)) && !option.disabled);
}

const YEAR_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

/** Academic year (1-based) of the entry currently being studied, capped at the course length. */
function getCurrentAcademicYear(profile: UserProfile, now = new Date()): number | undefined {
  const entry = pickEducation(profile, 'current');
  if (!entry?.current || !entry.startDate) return undefined;
  const start = new Date(entry.startDate);
  if (Number.isNaN(start.getTime())) return undefined;
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (months < 0) return undefined;
  const courseLength = classifyDegree(entry.degree) === 'pg' ? 2 : 4;
  return Math.min(Math.floor(months / 12) + 1, courseLength);
}

function academicYearMatches(label: string, year: number): boolean {
  const n = String(year);
  const ordinal = `${n}${year === 1 ? 'st' : year === 2 ? 'nd' : year === 3 ? 'rd' : 'th'}`;
  return new RegExp(`^(?:year )?(?:${n}|${ordinal}|${YEAR_WORDS[year] ?? n})(?: year)?$`).test(label);
}

function resolveFromProfile(control: ChoiceControl, facts: string[], profile: UserProfile): ChoiceDecision | null {
  if (!facts.length) return null;
  const options = control.options.filter((option) => !option.disabled);
  if (!options.length) return null;
  const question = normalize(control.question);

  // --- Gender Question Resolution (deterministic profile check only) ---
  const isGenderQuestion = /\b(?:gender|sex)\b/i.test(question) && !/\b(?:transgender)\b/i.test(question);
  if (isGenderQuestion && !control.multiple) {
    const explicitGender = profile.personal.gender?.trim();
    if (explicitGender) {
      const isMale = /^m(?:ale)?$/i.test(explicitGender);
      const isFemale = /^f(?:emale)?$/i.test(explicitGender);
      const match = options.find((opt) => {
        const lbl = normalize(opt.label);
        if (isMale) return /\bmale\b/.test(lbl) && !/\bfemale\b/.test(lbl);
        if (isFemale) return /\bfemale\b/.test(lbl);
        return false;
      });
      if (match) return { controlId: control.id, selectedOptionIds: [match.id], confidence: 0.98, source: 'profile' };
    }
  }

  // --- Current academic year (deterministic: avoids model date arithmetic) ---
  const isAcademicYearQuestion = /\b(?:current (?:academic )?year|academic year|year of (?:study|college|engineering)|which year (?:are you|of))\b/.test(question);
  if (isAcademicYearQuestion && !control.multiple) {
    const year = getCurrentAcademicYear(profile);
    if (year) {
      const matching = options.filter((option) => academicYearMatches(normalize(option.label), year));
      if (matching.length === 1) return { controlId: control.id, selectedOptionIds: [matching[0].id], confidence: 0.96, source: 'profile' };
    }
  }

  const isPreferenceQuestion = /\b(prefer|preferred|preference|willing|interest(?:ed)?|would you like|do you want|desire|desired|choice|available|availability|joining|relocat(?:e|ion)|on ?site)\b/.test(question);
  if (isPreferenceQuestion) return null;
  const isEducationQuestion = /education|degree|qualification|highest.*(school|college|university|degree)/.test(question);
  const isExperienceQuestion = /professional experience|work experience|years.*experience|experience.*years/.test(question);
  const isCurrentEmploymentQuestion = /current.*(employment|employ|job|work)|employment status|are you employed/.test(question);
  const isPastEmployerQuestion = /\b(?:have you|were you|did you)\b.{0,50}\b(?:employed|worked|work)\b/.test(question)
    && /\b(?:past|previous|previously|before|ever)\b/.test(question);
  const isSkillQuestion = /skill|language|technology|tool|program|framework|software|cloud|familiar|proficient/.test(question);

  if (isEducationQuestion) {
    const educationFacts = getFacts(profile).filter((fact) => fact.section === 'education').map((fact) => fact.value);
    const levels = educationFacts.map(degreeLevel).filter((level): level is string => Boolean(level));
    if (levels.length) {
      const highestLevel = levels.reduce((highest, level) => degreeRank(level) > degreeRank(highest) ? level : highest);
      const matching = options.filter((option) => degreeLevelFromOption(option) === highestLevel);
      if (matching.length === 1) return { controlId: control.id, selectedOptionIds: [matching[0].id], confidence: 0.96, source: 'profile' };
    }
  }

  const isGraduationYearQuestion = /graduat(?:e|ion)|year of (?:passing|completion)|completion year/.test(question);
  if (isGraduationYearQuestion) {
    const educationDates = profile.education.flatMap((item) => [item.startDate, item.endDate]).filter(Boolean) as string[];
    const years = new Set(educationDates.map((date) => date.match(/(?:19|20)\d{2}/)?.[0]).filter(Boolean));
    if (years.size === 1) {
      const matching = options.filter((option) => normalize(option.label) === [...years][0]);
      if (matching.length === 1) return { controlId: control.id, selectedOptionIds: [matching[0].id], confidence: 0.94, source: 'profile' };
    }
  }

  if (isExperienceQuestion && profile.experience.some((item) => item.company || item.title)) {
    const yes = findPolarity(options, true);
    if (yes) return { controlId: control.id, selectedOptionIds: [yes.id], confidence: 0.97, source: 'profile' };
  }

  if (isPastEmployerQuestion) {
    const companySuffixes = new Set(['co', 'company', 'corp', 'corporation', 'inc', 'limited', 'llc', 'ltd']);
    const employerMatchesQuestion = profile.experience.some(({ company }) => {
      if (!company) return false;
      const companyTokens = normalize(company).split(' ').map((token) => token.replace(/\.+$/, ''))
        .filter((token) => token.length > 2 && !companySuffixes.has(token));
      const questionTokens = new Set(question.split(' '));
      return companyTokens.length > 0 && companyTokens.every((token) => questionTokens.has(token));
    });
    const yes = employerMatchesQuestion ? findPolarity(options, true) : undefined;
    if (yes) return { controlId: control.id, selectedOptionIds: [yes.id], confidence: 0.97, source: 'profile' };
    const no = !employerMatchesQuestion ? findPolarity(options, false) : undefined;
    if (no) return { controlId: control.id, selectedOptionIds: [no.id], confidence: 0.95, source: 'profile' };
  }

  if (isCurrentEmploymentQuestion && profile.experience.some((item) => item.current && (item.company || item.title))) {
    const employed = options.find((option) => /\b(employed|working)\b/.test(normalize(option.label)) && !/self employed|not employed|unemployed/.test(normalize(option.label)));
    if (employed) return { controlId: control.id, selectedOptionIds: [employed.id], confidence: 0.96, source: 'profile' };
    const yes = findPolarity(options, true);
    if (yes) return { controlId: control.id, selectedOptionIds: [yes.id], confidence: 0.96, source: 'profile' };
  }

  if (isSkillQuestion && control.multiple) {
    const skills = profile.professional.skills;
    const matched = options.filter((option) => optionMatchesFact(option, skills));
    if (matched.length) return { controlId: control.id, selectedOptionIds: matched.map((option) => option.id), confidence: 0.94, source: 'profile' };
  }

  if (control.multiple) {
    const matched = options.filter((option) => optionMatchesFact(option, facts));
    if (matched.length) return { controlId: control.id, selectedOptionIds: matched.map((option) => option.id), confidence: 0.91, source: 'profile' };
    return null;
  }

  const hasDirectIntent = isEducationQuestion
    || isGraduationYearQuestion
    || isCurrentEmploymentQuestion
    || isSkillQuestion
    || /(?:what|which) (?:is|are|was|were) your (?:current )?(?:company|employer|job title|role|position)|where (?:are you|do you) (?:currently )?(?:located|live|reside)|your (?:current )?(?:city|state|country|address)/.test(question);
  if (!hasDirectIntent) return null;
  const matched = options.filter((option) => optionMatchesFact(option, facts));
  if (matched.length === 1) return { controlId: control.id, selectedOptionIds: [matched[0].id], confidence: 0.93, source: 'profile' };
  return null;
}

export function resolveChoiceFromProfile(control: ChoiceControl, profile: UserProfile): ChoiceDecision | null {
  return resolveFromProfile(control, getRelevantProfileFacts(profile, control.question), profile);
}

export function resolveOptimisticJobAvailability(control: ChoiceControl, evidence: string[]): ChoiceDecision | null {
  const question = normalize(control.question);

  // Standalone agreement/certification/consent/opt-in checkboxes:
  if (control.kind === 'checkbox' && control.options.length === 1 && !control.options[0].disabled) {
    const combined = normalize(`${control.question} ${control.options[0].label}`);
    const isAgreementOrConsent = /\b(?:certif(?:y|ication)|true and accurate|truthful|truthfulness|disqualification|terms|condition|privacy|policy|consent|agree|accept|acknowledge|declaration|background check|keep me informed|personalized emails|employment opportunities|talent community|communication)\b/.test(combined);
    if (isAgreementOrConsent) {
      return {
        controlId: control.id,
        selectedOptionIds: [control.options[0].id],
        confidence: 0.95,
        source: 'user_preference',
      };
    }
  }

  if (control.multiple) return null;

  // Job qualification / screening questions:
  // 1. Relocation, onsite, hybrid, facility, commute, shift
  // 2. Available, availability, immediate, joining, start date, internship duration, full-time commitment
  // 3. Work authorization, legally authorized, eligible to work, 18 years+, background check, drug test
  // 4. Agreement, terms, declaration, truthfulness
  const isScreening = /\b(?:available|availability|immediate|immediately|joining|join|start|onsite|on site|internship|relocat(?:e|ion)|hybrid|in person|commute|shift|overtime|facility|legally authorized|work authorization|authorized to work|eligible to work|right to work|18 years|background check|drug (?:screen|test)|declaration|certif(?:y|ication)|agree|truthful|statement is accurate)\b/.test(question);

  // Past employer check fallback:
  if (!isScreening && /\b(?:employed by|worked at|worked for|previous employee|former employee)\b/.test(question)
    && /\b(?:past|previous|previously|before|ever)\b/.test(question)) {
    const no = findPolarity(control.options, false);
    if (no) {
      return {
        controlId: control.id,
        selectedOptionIds: [no.id],
        confidence: 0.93,
        source: 'user_preference',
      };
    }
  }

  if (!isScreening) return null;

  const yes = findPolarity(control.options, true);
  const no = findPolarity(control.options, false);
  if (!yes || !no) return null;

  const normalizedEvidence = normalize(evidence.join(' '));

  // Visa sponsorship question polarity check:
  const isSponsorshipQuestion = /\b(?:require|need|will you require)\b.{0,40}\b(?:visa|sponsorship)\b/.test(question);
  if (isSponsorshipQuestion) {
    const requiresSponsorship = /\b(?:require.*sponsorship|need.*visa|require.*visa|need.*sponsorship)\b/.test(normalizedEvidence);
    return {
      controlId: control.id,
      selectedOptionIds: [requiresSponsorship ? yes.id : no.id],
      confidence: 0.95,
      source: 'user_preference',
    };
  }

  // Check for explicit negative evidence in profile/memories (e.g. "cannot relocate", "not willing to relocate", "unavailable")
  const negativeEvidence = /\b(?:not available|unavailable|cannot|can't|unable to|not willing|not ready|not able|do not want|don't want|will not|won't)\b.{0,80}\b(?:join|start|available|relocat|onsite|on site|internship|office|work)\b|\b(?:join|start|relocat|onsite|on site|internship|office|work)\b.{0,80}\b(?:not possible|cannot|can't|unable|not willing|not able)\b/.test(normalizedEvidence)
    || (/\b(?:immediate|immediately)\b/.test(question)
      && /\b(?:notice period|joining after|can join after|available after)\b.{0,35}\b\d+\s*(?:days?|weeks?|months?)\b/.test(normalizedEvidence));

  return {
    controlId: control.id,
    selectedOptionIds: [negativeEvidence ? no.id : yes.id],
    confidence: negativeEvidence ? 0.92 : 0.95,
    source: 'user_preference',
  };
}

export function getRelevantChoiceFormAnswers(control: ChoiceControl, answers: string[]): string[] {
  const question = normalize(control.question);
  if (/\b(immediate|immediately|joining|notice period)\b/.test(question)) {
    return answers.filter((answer) => /\b(immediate|immediately|join|joining|notice period|available to start)\b/i.test(answer));
  }
  if (/\b(on site|onsite|relocat(?:e|ion)|availability)\b/.test(question)) {
    return answers.filter((answer) =>
      /\b(relocat(?:e|ion)|on site|onsite|availability|available)\b/i.test(answer),
    );
  }
  return [];
}

export function resolveChoiceFromEvidence(
  control: ChoiceControl,
  evidence: string[],
  source: 'form' | 'memory' = 'memory',
): ChoiceDecision | null {
  if (!evidence.length) return null;
  const options = control.options.filter((option) => !option.disabled);
  const matched = options.filter((option) => optionMatchesFact(option, evidence));
  if (control.multiple) {
    return matched.length
      ? { controlId: control.id, selectedOptionIds: matched.map((option) => option.id), confidence: 0.88, source }
      : null;
  }
  if (matched.length === 1) return { controlId: control.id, selectedOptionIds: [matched[0].id], confidence: 0.9, source };

  const yes = findPolarity(options, true);
  const no = findPolarity(options, false);
  if (!yes) return null;
  const question = normalize(control.question);
  const normalizedEvidence = normalize(evidence.join(' '));
  if (/\b(?:on site|onsite|relocat(?:e|ion))\b/.test(question)
    && /\b(?:ready|willing|open|able) to (?:relocate|work on site|work onsite)\b/.test(normalizedEvidence)) {
    return { controlId: control.id, selectedOptionIds: [yes.id], confidence: 0.92, source };
  }
  if (/\b(?:immediate|immediately)\b/.test(question)
    && /\b(?:available|ready|able) to (?:join|start) immediately\b/.test(normalizedEvidence)) {
    return { controlId: control.id, selectedOptionIds: [yes.id], confidence: 0.96, source };
  }
  if (!no) return null;
  if (/\b(?:professional experience|work experience|employment status|currently employed|have you been employed)\b/.test(question)
    && /\b(currently employed|currently working|works at|employed at|professional work experience)\b/.test(normalizedEvidence)) {
    return { controlId: control.id, selectedOptionIds: [yes.id], confidence: 0.9, source };
  }
  return null;
}

function readCache(): Promise<ChoiceCache> {
  return new Promise((resolve) => {
    chrome.storage.local.get([CHOICE_CACHE_KEY], (result) => {
      resolve((result[CHOICE_CACHE_KEY] as ChoiceCache) ?? {});
    });
  });
}

async function cacheKey(control: ChoiceControl, evidence: ChoiceEvidence): Promise<string> {
  const raw = JSON.stringify({
    kind: control.kind,
    question: normalize(control.question),
    multiple: control.multiple,
    options: control.options.map((option) => [normalize(option.label), option.disabled]),
    profileFacts: evidence.profileFacts.map(normalize),
    memories: evidence.memories.map(normalize),
    formAnswers: evidence.formAnswers.map(normalize),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getCachedChoice(control: ChoiceControl, evidence: ChoiceEvidence): Promise<ChoiceDecision | null> {
  const key = await cacheKey(control, evidence);
  const entry = (await readCache())[key];
  if (!entry || Date.now() - entry.cachedAt > CHOICE_CACHE_TTL_MS) return null;
  const validIds = new Set(control.options.filter((option) => !option.disabled).map((option) => option.id));
  if (!entry.decision.selectedOptionIds.length || entry.decision.selectedOptionIds.some((id) => !validIds.has(id))) return null;
  return { ...entry.decision, controlId: control.id };
}

export async function cacheChoice(control: ChoiceControl, evidence: ChoiceEvidence, decision: ChoiceDecision): Promise<void> {
  const key = await cacheKey(control, evidence);
  const cache = await readCache();
  cache[key] = { decision, cachedAt: Date.now() };
  const entries = Object.entries(cache)
    .sort(([, left], [, right]) => right.cachedAt - left.cachedAt)
    .slice(0, MAX_CACHED_CHOICES);
  await new Promise<void>((resolve) => chrome.storage.local.set({
    [CHOICE_CACHE_KEY]: Object.fromEntries(entries),
  }, resolve));
}

export interface AIChoiceRequest {
  control: ChoiceControl;
  evidence: ChoiceEvidence;
}

export interface AIChoiceOptions {
  stage?: 'call1' | 'call2';
}

/**
 * Resolve one model-selected value to an option.
 * Accepts the option key ("o3"), or - for older/non-compliant responses - a bare in-range
 * index, or an unambiguous exact label match. Returns undefined when nothing matches safely.
 */
function resolveSelectedOption(raw: string | number, options: ChoiceOption[]): ChoiceOption | undefined {
  const text = String(raw).trim();
  const keyMatch = /^o(\d+)$/i.exec(text);
  if (keyMatch) return options[Number(keyMatch[1])];
  if (/^\d+$/.test(text)) {
    const labelMatches = options.filter((o) => o.label.trim() === text);
    const index = Number(text);
    // A bare number is ambiguous; trust it as an index unless it is out of range and matches exactly one label.
    if (index < options.length) return options[index];
    return labelMatches.length === 1 ? labelMatches[0] : undefined;
  }
  const labelMatches = options.filter((o) => o.label.trim().toLowerCase() === text.toLowerCase());
  return labelMatches.length === 1 ? labelMatches[0] : undefined;
}

export async function resolveChoicesWithAI(
  requests: AIChoiceRequest[],
  options?: AIChoiceOptions,
): Promise<ChoiceDecision[]> {
  const stage = options?.stage ?? 'call1';
  const stageLabel = stage === 'call1' ? 'Call #1 (Profile-only)' : 'Call #2 (Memory-augmented)';

  if (!isBackendConfigured() || !requests.length) {
    console.warn(`[JobFill Choice AI] [${stageLabel}] skipping AI resolver:`, {
      reason: !isBackendConfigured() ? 'backend URL is not configured' : 'no requests',
      requestCount: requests.length,
    });
    return [];
  }
  const available = requests.filter(({ control }) => control.options.some((option) => !option.disabled));
  if (!available.length) {
    console.warn(`[JobFill Choice AI] [${stageLabel}] all controls have only disabled options, skipping`);
    return [];
  }

  // Build per-question enabled-options arrays for index ↔ internal-ID mapping
  const enabledOptionsByQuestion: ChoiceOption[][] = available.map(({ control }) =>
    control.options.filter((option) => !option.disabled),
  );

  console.info(`[JobFill Choice AI] [${stageLabel}] sending ${available.length} controls to OpenRouter (index-based)`, available.map(({ control, evidence }, qi) => ({
    questionIndex: qi,
    question: control.question,
    optionCount: enabledOptionsByQuestion[qi].length,
    profileFactCount: evidence.profileFacts.length,
    memoryCount: evidence.memories.length,
    formAnswerCount: evidence.formAnswers.length,
  })));

  if (stage === 'call2') {
    console.info(`[JobFill Choice AI] [${stageLabel}] Supermemory memories retrieved for questions:`, available.map(({ control, evidence }, qi) => ({
      questionIndex: qi,
      question: control.question,
      options: enabledOptionsByQuestion[qi].map((o) => o.label),
      memoryCount: evidence.memories.length,
      memoriesFromSupermemory: evidence.memories,
    })));
  }

  const stageInstruction = stage === 'call1'
    ? `
CRITICAL STAGE #1 INSTRUCTION (PROFILE-ONLY FAST RESOLUTION):
- This is Call #1. You are evaluating questions using the applicant's profile facts, work/education timeline, skills, screening stances, and options WITHOUT external memories.
- If a question CANNOT be confidently and factually answered from the profile evidence (e.g. requires specific project details, external society memberships like IEEE/ACM, certifications, or past achievements not mentioned in the profile):
  DO NOT GUESS. Either omit the question from results or return an empty selection "s": [] with confidence: 0.
  These unanswered questions will be automatically routed to a secondary retrieval stage (Supermemory) in Call #2.`
    : `
CRITICAL STAGE #2 INSTRUCTION (DEEP MEMORY RESOLUTION):
- This is Call #2. These are the remaining questions that could not be resolved from the profile alone.
- Each question now contains "mem" (relevant retrieved memories from Supermemory).
- Carefully inspect both the top-level "profile" and the per-question "mem" chunks to answer accurately.
- If IEEE, certifications, or specific experiences are confirmed in "mem", select the corresponding option. If still absent anywhere, select the appropriate negative option ("No", "None", etc.) or omit.`;

  const systemPrompt = `You are an expert AI job-application assistant that accurately selects the right choices (radio buttons, checkboxes, dropdown selects) for job application forms on behalf of the applicant.
Analyze the applicant's profile facts, relevant retrieved memories from Supermemory, and answers from the same form.
${stageInstruction}

INPUT FORMAT:
The user message is a JSON object with:
- "profile": The applicant's profile facts (sent ONCE, shared across ALL questions).
- "questions": An array of form questions. Each has:
  - "i": question index (0-based)
  - "q": the question text
  - "type": "radio", "checkbox", or "select"
  - "multi": true if multiple selections are allowed, false for single-choice radio buttons or dropdowns
  - "opts": array of strings formatted "oN: label". "oN" is the option KEY you must return in "s". Labels may themselves be numbers (e.g. "o3: 4" means key "o3", label "4") — always return the key, never the label text or a bare number.
  - "mem": relevant memories from Supermemory (may be empty)
  - "form": relevant answers from the same form (may be empty)

OUTPUT FORMAT:
Return strictly JSON: {"results":[{"i":0,"s":["o0"],"c":0.95},{"i":1,"s":["o2","o3"],"c":0.9,"ot":"custom text"}]}
- "i": question index (must match the input "i")
- "s": array of selected option KEYS (strings like "o3") copied from "opts" (NOT the label text, NOT bare numbers)
- "c": confidence from 0 to 1
- "ot": (optional) only include when selecting an "Other" option; put the concise evidence-backed text here

EVIDENCE PRIORITY (follow this order):
- "profile" is the PRIMARY SOURCE OF TRUTH. It contains raw facts (education with start/end dates, work history with dates, Date of Birth, skills, current date). You must use these facts and timeline dates to deduce and derive answers to indirect questions (e.g. current academic year, current semester, age, total experience, prior internships count).
- Per-question "mem" (Supermemory) is SECONDARY. Use when profile lacks the fact. If they conflict, profile ALWAYS wins.
- Per-question "form" is useful only when it explicitly answers the same question without conflicting with profile.
- Options are possible responses, NOT evidence. Never infer a personal fact from an option being listed.
- For a country or phone calling-code dropdown, select the option matching the applicant's primary address country (for example, India -> India +91), not the current/default option.

MANDATORY DEEP THINKING & TIMELINE DEDUCTION RULES:
Perform strict, precise mental arithmetic and calendar math using "system: Current Date" (YYYY-MM-DD) and profile dates. Do NOT guess or ballpark!

1. Current Semester & Academic Timeline (Strict Calendar Arithmetic):
- Standard university calendar: 1 academic year = 2 semesters.
  * Odd semesters (1st, 3rd, 5th, 7th) run in the Autumn/Fall term: July to December (Months 7–12).
  * Even semesters (2nd, 4th, 6th, 8th) run in the Spring term: January to June (Months 1–6).
- Extract degree start year from the active education entry (e.g. "2022-01-01" or start year in roll number "22bce7451" -> StartYear = 2022).
- Extract CurrentYear and CurrentMonth from "system: Current Date" (e.g. "2026-10-18" -> CurrentYear = 2026, CurrentMonth = 10).
- Calculate elapsed calendar years: ElapsedYears = CurrentYear - StartYear (e.g. 2026 - 2022 = 4 years).
- Semester progression for a standard 4-year degree (B.Tech / B.E. / B.S.):
  * Year 1 (StartYear): Sem 1 (Jul–Dec), Sem 2 (Jan–Jun)
  * Year 2 (StartYear + 1): Sem 3 (Jul–Dec), Sem 4 (Jan–Jun)
  * Year 3 (StartYear + 2): Sem 5 (Jul–Dec), Sem 6 (Jan–Jun)
  * Year 4 (StartYear + 3): Sem 7 (Jul–Dec), Sem 8 (Jan–Jun)
  * Year 5 / Beyond (StartYear + 4 or more, e.g. Start 2022 with Current Date late 2026): 4 full calendar years have passed! If marked "Currently Pursuing / Ongoing", the student is in their final 8th semester or Graduated. If "Graduated" is an option and 4+ years have passed, pick "Graduated" or "8th semester".
- Concrete Timeline Check: If degree started in 2022 (e.g. roll no "22bce..." or start "2022-01-01") and Current Date is late 2026 (Month 10):
  * 2022-2023: 1st & 2nd semester
  * 2023-2024: 3rd & 4th semester
  * 2024-2025: 5th & 6th semester (this was TWO YEARS AGO!)
  * 2025-2026: 7th & 8th semester
  * Late 2026: 8th semester or Graduated. Selecting 5th semester is an arithmetic failure because 5th semester was in 2024!
- For 2-year Master's (M.Tech/MS/MBA): Sem 1 (Year 1 Fall), Sem 2 (Year 1 Spring), Sem 3 (Year 2 Fall), Sem 4 (Year 2 Spring).

2. Current Academic Year & College Level:
- Map the derived academic year to form options:
  * Numbers: "1", "2", "3", "4"
  * Ordinals: "1st", "2nd", "3rd", "4th", "1st Year", "2nd Year", "3rd Year", "4th Year"
  * Classifications: Year 1 = "Freshman", Year 2 = "Sophomore", Year 3 = "Junior", Year 4 = "Senior"
  * Relative terms: Year 4 of 4 = "Final Year", Year 3 of 4 = "Pre-final Year"

3. Exact Current Age (Strict Date of Birth Calculation):
- Compare "personal: Date of Birth" (YYYY-MM-DD) with "system: Current Date" (YYYY-MM-DD).
- Formula: Age = CurrentYear - BirthYear.
- If (CurrentMonth < BirthMonth) OR (CurrentMonth == BirthMonth AND CurrentDay < BirthDay), subtract 1 from Age.
- Example: Born 2004-11-06, Current Date 2026-10-18 -> 2026 - 2004 = 22, but November 6 is after October 18, so exact age is 21!
- Map to exact number option ("21") or range ("20-25").

4. Prior Internships Count:
- Count the number of distinct past positions in profile "experience:" entries whose title explicitly contains "Intern", "Internship", or "Trainee" that are completed or prior to the current primary job.
- Full-time jobs (e.g. "sde at ibm" without "intern") are NOT internships.
- If 0 internship entries in profile, select "0".
- If 1 internship entry in profile, select "1".
- Do not invent prior internships not listed in the profile.

5. Hours Per Day / Daily Commitment:
- For questions asking how many hours a day you can spend on tasks (e.g. "Less than two hours", "Less than four hours", "Less than eight hours"):
- The applicant wants to qualify and be shortlisted! Select the option representing serious, high commitment (e.g. "Less than eight hours", "8 hours", "Full time"), NOT minimal commitment ("Less than two hours").

6. Skill & Technology Experience Duration (e.g. JavaScript, Python, Java):
- Calculate total time since earliest practical work/degree experience with that technology to "system: Current Date".
- If candidate has been pursuing CSE since 2022 with Current Date 2026, they have 4+ years of core programming experience. Match to closest range: "Less than one year", "2 years", "3 years", "> 4 years".

7. Part of Platform / Work Interest (Multi-choice):
- For questions like "Which part of our platform would you like to work on?" (Frontend, Backend, DevOps):
- If the applicant's skills include both Frontend (React, HTML/CSS, JS) and Backend (Node.js, Python, Java, SQL, Rust), select BOTH "Frontend" and "Backend".

8. Memberships & Certifications (Strict Factual Verification):
- For questions like "DO YOU HAVE IEEE MEMBERSHIP?", "Are you a member of ACM?":
  * Check profile evidence and memories. If IEEE or the asked organization is NOT explicitly mentioned anywhere, select "No". NEVER falsely claim memberships.

9. Current Employment & Education Level:
- If applicant currently holds a job marked active/present -> "Employed". If student without active employment -> "Student".
- Degree mapping: B.Tech/B.E./B.S. -> "Bachelor's Degree", M.Tech/MS -> "Master's Degree".

10. Gender & Demographics:
- Use explicit profile gender. If not explicitly set, infer from first name (e.g. Aditya -> Male). Select "Male" or "Female" with high confidence. Do NOT pick "Prefer not to say" when name clearly indicates gender.

11. Screening & Qualification Defaults (Advancing Candidacy):
- Always select "Yes" for: willingness to relocate, work on-site/hybrid, immediate availability, authorization to work, consenting to background checks and truthfulness.
- Select "No" for visa sponsorship (unless explicit profile facts say sponsorship is needed).
- Standalone single checkboxes (terms, consent, truthfulness, privacy policy): ALWAYS select them.

12. Programs/Fellowships (GSoC, GirlScript, MLH):
- ONLY select if EXPLICITLY confirmed in profile facts or memories. If not participated, select "Not really", "None", or "No". NEVER pick both positive and negative options together.

CONSTRAINTS:
- Single-choice (multi=false): select EXACTLY ONE index.
- Multi-choice (multi=true): select ALL matching indices.
- Standalone single checkboxes (consent, agreement): return the option index so it gets checked.
- Confidence < ${stage === 'call1' ? '0.70' : '0.65'} means uncertain — prefer omitting the question or returning empty "s".`;

  // Build the compact payload: profile once + numbered questions with label-only options
  const sharedProfileFacts = available[0].evidence.profileFacts;

  const userPayload = {
    profile: sharedProfileFacts,
    questions: available.map(({ control, evidence }, qi) => ({
      i: qi,
      q: control.question,
      type: control.kind,
      multi: control.multiple,
      opts: enabledOptionsByQuestion[qi].map((o, n) => `o${n}: ${o.label}`),
      ...(evidence.memories.length ? { mem: evidence.memories } : {}),
      ...(evidence.formAnswers.length ? { form: evidence.formAnswers } : {}),
    })),
  };

  console.info(`[JobFill Choice AI] [${stageLabel}] Full System Prompt Text (Lines 555-635):\n${systemPrompt}`);
  console.info(`[JobFill Choice AI] [${stageLabel}] Full prompt payload given to OpenRouter:`, {
    model: 'openai/gpt-4o-mini',
    stage,
    systemPromptLength: systemPrompt.length,
    userPayload,
  });

  try {
    const response = await requestOpenRouter({
      model: 'openai/gpt-4o-mini',
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }, AbortSignal.timeout(45000));
    if (!response.ok) {
      console.warn(`[JobFill Choice AI] API returned HTTP ${response.status}: ${response.statusText}`);
      return [];
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      console.warn('[JobFill Choice AI] unexpected API response structure', { data });
      return [];
    }
    console.info(`[JobFill Choice AI] [${stageLabel}] raw AI response content:`, content);
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as {
      results?: Array<{ i?: number; s?: Array<string | number>; c?: number; ot?: string }>;
    };
    console.info(`[JobFill Choice AI] [${stageLabel}] parsed AI results:`, parsed.results);

    const minConfidence = stage === 'call1' ? 0.70 : 0.65;

    return (parsed.results ?? []).flatMap((result) => {
      const qi = typeof result.i === 'number' ? result.i : -1;
      if (qi < 0 || qi >= available.length) {
        console.info('[JobFill Choice AI] filtering out result: question index out of range', { qi, totalQuestions: available.length });
        return [];
      }
      const request = available[qi];
      const enabledOpts = enabledOptionsByQuestion[qi];
      const rawIndices = Array.isArray(result.s) ? [...new Set(result.s)] : [];
      const confidence = typeof result.c === 'number' ? result.c : 0;

      if (confidence < minConfidence || !rawIndices.length) {
        console.info(`[JobFill Choice AI] [${stageLabel}] filtering out result:`, {
          questionIndex: qi,
          question: request.control.question,
          reason: confidence < minConfidence ? `low confidence (${confidence} < ${minConfidence})` : 'empty selected indices',
          rawIndices,
          confidence,
        });
        return [];
      }

      // Map option keys ("o3") to internal option IDs. Keys cannot be confused with numeric labels.
      const selectedIds: string[] = [];
      for (const raw of rawIndices) {
        const opt = resolveSelectedOption(raw, enabledOpts);
        if (opt && !isPlaceholderOption(opt)) {
          selectedIds.push(opt.id);
        } else if (!opt) {
          console.warn('[JobFill Choice AI] invalid option key, skipping:', { questionIndex: qi, value: raw, totalOptions: enabledOpts.length });
        }
      }

      if (!selectedIds.length) {
        console.info('[JobFill Choice AI] filtering out result (no valid option indices):', {
          questionIndex: qi,
          question: request.control.question,
          rawIndices,
          optionCount: enabledOpts.length,
        });
        return [];
      }

      let finalSelectedIds = request.control.multiple ? selectedIds : [selectedIds[0]];

      // For multi-choice: if negative option ("Not really", "None") is selected alongside positives, keep only the negative
      if (request.control.multiple && finalSelectedIds.length > 1) {
        const negativeOption = enabledOpts.find((opt) =>
          /^(?:not really|none|none of the above|neither|n\/a|not applicable|no,?\s+none)$/i.test(opt.label.trim())
        );
        if (negativeOption && finalSelectedIds.includes(negativeOption.id)) {
          finalSelectedIds = [negativeOption.id];
        }
      }

      // Handle "Other" text
      const selectedOther = finalSelectedIds.some((id) => enabledOpts.some((option) =>
        option.id === id && /^other\b/i.test(normalize(option.label)),
      ));
      const otherText = selectedOther && typeof result.ot === 'string' ? result.ot.trim().slice(0, 600) : '';

      console.info(`[JobFill Choice AI] ✓ accepted result for Q${qi}`, {
        question: request.control.question,
        selectedIndices: rawIndices,
        selectedOptionIds: finalSelectedIds,
        selectedLabels: enabledOpts.filter((o) => finalSelectedIds.includes(o.id)).map((o) => o.label),
        confidence,
        hasOtherText: Boolean(otherText),
        ...(otherText ? { otherText } : {}),
      });

      return [{
        controlId: request.control.id,
        selectedOptionIds: finalSelectedIds,
        confidence,
        source: 'ai' as const,
        ...(otherText ? { otherText } : {}),
      }];
    });
  } catch (error) {
    console.warn('[JobFill Choice AI] Batched AI resolution failed:', error);
    return [];
  }
}