import type { UserProfile } from '../types/profile';
import type { ChoiceControl, ChoiceDecision, ChoiceEvidence, ChoiceOption } from '../types/choice';

const CHOICE_CACHE_KEY = 'jf_choice_decisions_v4';
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

function getFacts(profile: UserProfile): Array<{ section: string; value: string }> {
  return [
    { section: 'skills', value: profile.professional.skills.join(', ') },
    ...profile.experience.flatMap((item) => [
      { section: 'experience', value: [item.title, item.company, item.location].filter(Boolean).join(' at ') },
      { section: 'experience', value: item.description ?? '' },
      { section: 'experience', value: item.current ? 'currently working' : '' },
      { section: 'experience', value: [item.startDate, item.endDate].filter(Boolean).join(' to ') },
    ]),
    ...profile.education.flatMap((item) => [
      { section: 'education', value: [item.degree, item.field, item.institution, item.description].filter(Boolean).join(' ') },
      { section: 'education', value: [item.startDate, item.endDate].filter(Boolean).join(' to ') },
    ]),
    ...profile.addresses.map((item) => ({
      section: 'address',
      value: [item.line1, item.line2, item.city, item.state, item.postalCode, item.country].filter(Boolean).join(', '),
    })),
    ...profile.phones.map((item) => ({ section: 'contact', value: item.value })),
    ...profile.emails.map((item) => ({ section: 'contact', value: item.value })),
    { section: 'personal', value: [profile.personal.firstName, profile.personal.middleName, profile.personal.lastName].filter(Boolean).join(' ') },
    { section: 'professional', value: [profile.professional.linkedin, profile.professional.github, profile.professional.portfolio].filter(Boolean).join(' ') },
  ].filter((fact) => fact.value.trim());
}

export function getRelevantProfileFacts(profile: UserProfile, question: string): string[] {
  const normalizedQuestion = normalize(question);
  const sections = new Set<string>();
  if (/education|degree|qualification|school|college|university|major|study/.test(normalizedQuestion)) sections.add('education');
  if (/skill|language|technology|tool|program|framework|software|cloud|know|familiar/.test(normalizedQuestion)) {
    sections.add('skills');
    sections.add('experience');
  }
  if (/employ|job|work|career|company|role|position|professional experience/.test(normalizedQuestion)) sections.add('experience');
  if (/address|location|city|state|province|country|relocat|reside|live|on site|on-site|office|commut|noida/.test(normalizedQuestion)) sections.add('address');
  if (/available|availability|immediate|joining|notice period|internship/.test(normalizedQuestion)) sections.add('experience');
  if (/phone|telephone|email|contact/.test(normalizedQuestion)) sections.add('contact');
  if (/name|about you|yourself/.test(normalizedQuestion)) sections.add('personal');
  if (sections.size === 0) {
    sections.add('skills');
    sections.add('experience');
    sections.add('education');
    sections.add('professional');
  }

  return getFacts(profile)
    .filter((fact) => sections.has(fact.section))
    .map((fact) => `${fact.section}: ${fact.value}`)
    .slice(0, 24);
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
  if (!/\b(?:available|availability|immediate|immediately|joining|join|start|onsite|on site|internship|relocat(?:e|ion))\b/.test(question)) return null;
  const yes = findPolarity(control.options, true);
  const no = findPolarity(control.options, false);
  if (!yes || !no) return null;

  const normalizedEvidence = normalize(evidence.join(' '));
  const negativeEvidence = /\b(?:not available|unavailable|cannot|can't|unable to|not willing|not ready|not able|do not want|don't want|will not|won't)\b.{0,80}\b(?:join|start|available|relocat|onsite|on site|internship|office)\b|\b(?:join|start|relocat|onsite|on site|internship|office)\b.{0,80}\b(?:not possible|cannot|can't|unable|not willing|not able)\b/.test(normalizedEvidence)
    || /\b(?:immediate|immediately)\b/.test(question)
      && /\b(?:notice period|joining after|can join after|available after)\b.{0,35}\b\d+\s*(?:days?|weeks?|months?)\b/.test(normalizedEvidence);
  return {
    controlId: control.id,
    selectedOptionIds: [negativeEvidence ? no.id : yes.id],
    confidence: negativeEvidence ? 0.92 : 0.86,
    source: 'user_preference',
  };
}

export function getRelevantChoiceFormAnswers(control: ChoiceControl, answers: string[]): string[] {
  const question = normalize(control.question);
  if (/\b(immediate|immediately|joining|notice period)\b/.test(question)) {
    return answers.filter((answer) => /\b(immediate|immediately|join|joining|notice period|available to start)\b/i.test(answer));
  }
  if (/\b(on site|onsite|relocat(?:e|ion)|availability)\b/.test(question)) {
    const needsNoidaEvidence = /\bnoida\b/.test(question);
    return answers.filter((answer) =>
      /\b(relocat(?:e|ion)|on site|onsite|availability|available)\b/i.test(answer)
      && (!needsNoidaEvidence || /\bnoida\b/i.test(answer)),
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
    && /\bready to relocate to noida\b/.test(normalizedEvidence)
    && /\bnoida\b/.test(question)) {
    return { controlId: control.id, selectedOptionIds: [yes.id], confidence: 0.88, source };
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
            content: 'Resolve job-application choice controls using only the supplied profile facts, document excerpts, and relevant memories. Understand each question before comparing evidence to options. Prefer an affirmative answer when the supplied evidence supports it; choose a negative answer only when the evidence supports that answer, not merely as a cautious default. Never invent eligibility, availability, willingness, qualifications, or personal details, WITH ONE EXCEPTION: for demographic or EEO information (gender, race, ethnicity, disability, veteran status) where no evidence is supplied, you MUST default to selecting the "choose not to disclose", "decline to identify", or "prefer not to say" option if available, and return a confidence of 0.95. For preferences, willingness, availability, immediate joining, onsite, or relocation, use explicit evidence; current address or qualifications alone do not establish willingness. Never select legal consent, privacy, truthfulness, certification, or declaration checkboxes unless the supplied evidence explicitly records the user\'s affirmative decision for that exact statement. Select only supplied option IDs. For single-choice controls return at most one ID; for multi-choice return only individually supported IDs. Return JSON: {"results":[{"control_id":"...","selected_option_ids":["..."],"confidence":0.0}]}. Use confidence from 0 to 1; return an empty list if evidence is insufficient or ambiguous.',
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
      const selectedIds = Array.isArray(result.selected_option_ids) ? [...new Set(result.selected_option_ids)] : [];
      const confidence = typeof result.confidence === 'number' ? result.confidence : 0;
      if (!request || confidence < 0.85 || !selectedIds.length) {
        console.info('[JobFill Choice AI] filtering out result:', {
          controlId: result.control_id,
          reason: !request ? 'unknown control_id' : confidence < 0.85 ? `low confidence (${confidence})` : 'empty selected_option_ids',
          selectedIds,
          confidence,
        });
        return [];
      }
      const enabledIds = new Set(request.control.options
        .filter((option) => !option.disabled && !isPlaceholderOption(option))
        .map((option) => option.id));
      if (selectedIds.some((id) => !enabledIds.has(id)) || (!request.control.multiple && selectedIds.length !== 1)) {
        console.info('[JobFill Choice AI] filtering out result (invalid option IDs or count mismatch):', {
          controlId: result.control_id,
          selectedIds,
          enabledIds: [...enabledIds],
          multiple: request.control.multiple,
        });
        return [];
      }
      console.info(`[JobFill Choice AI] ✓ accepted result for ${result.control_id}`, { selectedIds, confidence });
      return [{ controlId: request.control.id, selectedOptionIds: selectedIds, confidence, source: 'ai' as const }];
    });
  } catch (error) {
    console.warn('[JobFill Choice AI] Batched AI resolution failed:', error);
    return [];
  }
}