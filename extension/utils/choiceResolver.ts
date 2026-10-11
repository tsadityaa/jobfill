import type { UserProfile } from '../types/profile';
import type { ChoiceControl, ChoiceDecision, ChoiceEvidence, ChoiceOption } from '../types/choice';

const CHOICE_CACHE_KEY = 'jf_choice_decisions_v6';
const CHOICE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHED_CHOICES = 80;
const CHOICE_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

  const highestEducation = profile.education.slice().sort((a, b) => {
    const rankA = degreeRank(degreeLevel(a.degree) || '');
    const rankB = degreeRank(degreeLevel(b.degree) || '');
    return rankB - rankA;
  })[0];

  return [
    // Personal & Identity
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
      const dates = [item.startDate, item.endDate || (isCurrentEdu ? 'Present' : '')].filter(Boolean).join(' - ');
      const status = item.current ? 'Currently Pursuing' : 'Completed Degree';
      const level = inferDegreeLevel(item.degree);
      const degField = [item.degree, item.field].filter(Boolean).join(' in ');
      const inst = item.institution ? ` from ${item.institution}` : '';
      const gpa = item.gpa ? `, GPA: ${item.gpa}` : '';
      return [
        { section: 'education', value: `Degree: ${degField} [Degree Level: ${level}]${inst}${dates ? ` (${dates})` : ''} [Status: ${status}]${gpa}` },
      ];
    }),

    // Skills
    ...(profile.professional.skills.length ? [{ section: 'skills', value: `Skills: ${profile.professional.skills.join(', ')}` }] : []),

    // Locations & Addresses
    ...profile.addresses.map((item) => ({
      section: 'address',
      value: `Location (${item.label}): ${[item.line1, item.line2, item.city, item.state, item.postalCode, item.country].filter(Boolean).join(', ')}`,
    })),

    // Contact
    ...profile.phones.map((item) => ({ section: 'contact', value: `Phone: ${item.value}` })),
    ...profile.emails.map((item) => ({ section: 'contact', value: `Email: ${item.value}` })),

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

  const isPreferenceQuestion = /\b(prefer|preferred|preference|willing|interest(?:ed)?|would you like|do you want|desire|desired|choice|available|availability|joining|relocat(?:e|ion)|on ?site)\b/.test(question);
  if (isPreferenceQuestion) return null;
  const isEducationQuestion = /education|degree|qualification|highest.*(school|college|university|degree)|academic/.test(question);
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
  if (control.multiple) return null;
  const question = normalize(control.question);
  
  // Job qualification / screening questions:
  // 1. Relocation, onsite, hybrid, facility, commute, shift
  // 2. Available, availability, immediate, joining, start date, internship duration, full-time commitment
  // 3. Work authorization, legally authorized, eligible to work, 18 years+, background check, drug test
  // 4. Agreement, terms, declaration, truthfulness
  const isScreening = /\b(?:available|availability|immediate|immediately|joining|join|start|onsite|on site|internship|relocat(?:e|ion)|hybrid|in person|commute|shift|overtime|facility|legally authorized|work authorization|authorized to work|eligible to work|right to work|18 years|background check|drug (?:screen|test)|declaration|certif(?:y|ication)|agree|truthful|statement is accurate)\b/.test(question);
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

export async function resolveChoicesWithAI(requests: AIChoiceRequest[]): Promise<ChoiceDecision[]> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'xyzz' || !requests.length) {
    console.warn('[JobFill Choice AI] skipping AI resolver:', {
      reason: !apiKey ? 'no API key' : apiKey === 'xyzz' ? 'placeholder API key' : 'no requests',
      requestCount: requests.length,
    });
    return [];
  }
  const available = requests.filter(({ control }) => control.options.some((option) => !option.disabled));
  if (!available.length) {
    console.warn('[JobFill Choice AI] all controls have only disabled options, skipping');
    return [];
  }

  console.info(`[JobFill Choice AI] sending ${available.length} controls to OpenRouter`, available.map(({ control, evidence }) => ({
    controlId: control.id,
    question: control.question,
    optionCount: control.options.filter((o) => !o.disabled).length,
    profileFactCount: evidence.profileFacts.length,
    memoryCount: evidence.memories.length,
    formAnswerCount: evidence.formAnswers.length,
  })));

  try {
    const response = await fetch(CHOICE_API_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Personal Copilot Extension',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an expert AI job-application assistant that accurately selects the right choices (radio buttons, checkboxes) for job application forms on behalf of the applicant.
Analyze the applicant's profile facts, relevant retrieved memories from Supermemory, and answers from the same form.

CRITICAL DECISION-MAKING GUIDELINES:

1. Current Employment Status & Work Experience:
- Inspect the applicant's experience facts and active roles.
- If the applicant currently holds a job (e.g. "Data Scientist at IBM" marked active, present, or currently employed), select "Employed" or "Currently Employed".
- If the applicant is a student without active employment, select "Student".
- If self-employed, select "Self-employed".
- If unemployed, select "Unemployed".
- For questions asking about years of experience, current employer, job title, or previous companies worked at, strictly match against the profile facts and memories.

2. Highest Education Level & Degrees:
- Inspect the applicant's education facts and completed/pursued degrees.
- Map the applicant's degree to the standard education levels:
  * B.Tech, B.E., B.S., B.Sc., B.A., or any Bachelor's -> select "Bachelor's Degree" (or "Bachelor's" / "Undergraduate").
  * M.Tech, M.E., M.S., M.Sc., MBA, or any Master's -> select "Master's Degree" (or "Master's" / "Postgraduate").
  * Ph.D., Doctorate -> select "Doctorate" or "PhD".
  * Diploma, Polytechnic, Associate -> select "Diploma" or "Associate Degree".
  * High School, 12th, Secondary -> select "High School".
- Select the option representing their highest achieved/completed level of education.

3. Gender & Demographics:
- If gender is explicitly listed in profile evidence, use it.
- If gender is not explicitly stated in profile settings, INFER the gender from the candidate's first name (e.g., Aditya/Adithya, Rahul, Amit, Rohan -> Male; Priya, Ananya, Sneha, Pooja -> Female; John, David, Michael -> Male; Sarah, Emily, Jessica -> Female).
- When the name or profile clearly indicates gender, ALWAYS select the matching option ("Male" or "Female") with high confidence (0.95+).
- Do NOT select "I choose not to disclose", "Prefer not to say", or "Decline to state" for gender when the name clearly identifies the applicant.
- ONLY select "Choose not to disclose" / "Prefer not to say" for voluntary demographic disclosures like disability or veteran status where no facts exist in the profile or memories.

4. Screening, Availability, & Qualification Questions (Advancing the Application):
- The applicant wants to qualify and be shortlisted for the position!
- For questions regarding:
  * Willingness to relocate -> Select "Yes"
  * Willingness to work on-site or hybrid -> Select "Yes"
  * Availability to start immediately / notice period -> Select "Yes" (or immediate / least notice period)
  * Commitment to internship or program duration (e.g. 6 months) -> Select "Yes"
  * Legal authorization to work in the country -> Select "Yes"
  * Passing background check / drug test -> Select "Yes"
  * Agreement to terms and truthfulness of application -> Select "Yes"
  * Requiring visa sponsorship -> Select "No" (unless explicit profile/memory evidence says the applicant needs sponsorship).
- NEVER pick a disqualifying negative answer ("No") to screening questions unless supplied profile/memory evidence explicitly demands it.

5. Dynamic Question Understanding:
- For any novel, arbitrary, or company-specific questions (e.g. "Have you ever worked at IBM before?", "Do you have experience with Python?", "How did you hear about us?"):
  * Reason carefully over the profile facts, work history, skills, and Supermemory chunks.
  * Pick the option that best accurately reflects the applicant's history and maximizes their candidacy.

6. Output Format & Constraints:
- You must return ONLY options from the provided "options" list using their exact "id".
- For single-choice ("multiple": false, or radio buttons): select EXACTLY ONE option ID that is the best match.
- For multi-choice ("multiple": true, or checkboxes): select all matching option IDs.
- Return strictly JSON: {"results":[{"control_id":"...","selected_option_ids":["..."],"confidence":0.95}]}. Use confidence from 0 to 1.`,
          },
          { role: 'user', content: JSON.stringify({ controls: available.map(({ control, evidence }) => ({
            control_id: control.id,
            type: control.kind,
            question: control.question,
            multiple: control.multiple,
            options: control.options.filter((option) => !option.disabled).map(({ id, label }) => ({ id, label })),
            profile_evidence: evidence.profileFacts,
            relevant_memories: evidence.memories,
            relevant_form_answers: evidence.formAnswers,
          })) }) },
        ],
      }),
    });
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
    console.info('[JobFill Choice AI] raw AI response content:', content);
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as {
      results?: Array<{ control_id?: string; selected_option_ids?: string[]; confidence?: number }>;
    };
    console.info('[JobFill Choice AI] parsed AI results:', parsed.results);
    const requestsById = new Map(available.map((request) => [request.control.id, request]));
    return (parsed.results ?? []).flatMap((result) => {
      const request = result.control_id ? requestsById.get(result.control_id) : undefined;
      const rawSelected = Array.isArray(result.selected_option_ids) ? [...new Set(result.selected_option_ids)] : [];
      const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
      if (!request || confidence < 0.65 || !rawSelected.length) {
        console.info('[JobFill Choice AI] filtering out result:', {
          controlId: result.control_id,
          reason: !request ? 'unknown control_id' : confidence < 0.65 ? `low confidence (${confidence})` : 'empty selected_option_ids',
          rawSelected,
          confidence,
        });
        return [];
      }

      // Map returned IDs or option labels to valid enabled option IDs
      const enabledOptions = request.control.options.filter((option) => !option.disabled && !isPlaceholderOption(option));
      const enabledIdMap = new Map<string, string>();
      for (const opt of enabledOptions) {
        enabledIdMap.set(opt.id, opt.id);
        enabledIdMap.set(opt.label.trim().toLowerCase(), opt.id);
        enabledIdMap.set(normalize(opt.label), opt.id);
      }

      const mappedIds = rawSelected
        .map((idOrLabel) => enabledIdMap.get(idOrLabel) || enabledIdMap.get(idOrLabel.trim().toLowerCase()) || enabledIdMap.get(normalize(idOrLabel)))
        .filter((id): id is string => Boolean(id));
      const selectedIds = [...new Set(mappedIds)];

      if (!selectedIds.length) {
        console.info('[JobFill Choice AI] filtering out result (no matching option IDs found):', {
          controlId: result.control_id,
          rawSelected,
          enabledIds: enabledOptions.map((o) => o.id),
        });
        return [];
      }

      const finalSelectedIds = request.control.multiple ? selectedIds : [selectedIds[0]];
      console.info(`[JobFill Choice AI] ✓ accepted result for ${result.control_id}`, { selectedOptionIds: finalSelectedIds, confidence });
      return [{ controlId: request.control.id, selectedOptionIds: finalSelectedIds, confidence, source: 'ai' as const }];
    });
  } catch (error) {
    console.warn('[JobFill Choice AI] Batched AI resolution failed:', error);
    return [];
  }
}