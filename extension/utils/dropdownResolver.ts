import type { UserProfile } from '../types/profile';
import type { DropdownControl, DropdownDecision, DropdownOption } from '../types/dropdown';
import type { ChoiceControl, ChoiceEvidence } from '../types/choice';
import { getRelevantProfileFacts, resolveChoicesWithAI } from './choiceResolver';
import { classifyLevelHint, pickEducation } from './educationPicker';
import { isDropdownPlaceholder } from './dropdownControls';
import { isDropdownAIEnabled } from './dropdownSettings';

const DROPDOWN_CACHE_KEY = 'jf_dropdown_cache_v3';
const DROPDOWN_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface DropdownCacheEntry {
  decision: DropdownDecision;
  cachedAt: number;
}

type DropdownCache = Record<string, DropdownCacheEntry>;

const WORKDAY_SCREENING_PRESETS: Array<{ question: RegExp; answer: string }> = [
  { question: /^would you consider relocating for this role\b/, answer: 'I am local to where the job is posted' },
  { question: /^are you subject to any non compete or non solicitation restrictions at your current or most recent employer\b/, answer: 'No' },
  { question: /^in your current job do you use or work on the workday system\b/, answer: 'No, I do not use the Workday system in my current job' },
  { question: /^are you authorized to work in the country where this job is located\b/, answer: 'Yes' },
  { question: /^do you now or in the future require any immigration filing or visa sponsorship\b/, answer: 'No' },
  { question: /^are you a current or former employee of the united states government\b/, answer: 'No' },
  { question: /^this information is sought for compliance with u s export control laws\b/, answer: 'No' },
  { question: /^are you related to a current workday employee\b/, answer: 'No' },
  { question: /^to the best of your knowledge are you related to an employee of a customer or a government official\b/, answer: 'No' },
  { question: /^are you i a current or recent former.*employee of ernst young llp\b/, answer: 'No' },
  { question: /^do you have a spouse spousal equivalent parent dependent nondependent child or sibling.*employed by ernst young llp\b/, answer: 'No' },
  { question: /^i acknowledge that i have read understood and reviewed the above questions\b/, answer: 'Yes' },
  { question: /\bdo you consent to recorded workday interviews\b/, answer: 'Yes' },
];

function normalizePresetText(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getWorkdayPresetOption(control: DropdownControl): DropdownOption | undefined {
  const question = normalizePresetText(control.question);
  const preset = WORKDAY_SCREENING_PRESETS.find((entry) => entry.question.test(question));
  if (!preset) return undefined;

  const expectedAnswer = normalizePresetText(preset.answer);
  return control.options.find((option) =>
    !option.disabled && normalizePresetText(option.label) === expectedAnswer,
  );
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function makeCacheKey(control: DropdownControl, facts: string[]): string {
  const optionsSig = control.options.map((o) => `${o.label}::${o.value}`).join('|');
  const factsSig = facts.slice(0, 10).join(';');
  return `${control.kind}::${control.question}::${optionsSig}::${hash(factsSig)}`;
}

export async function getCachedDropdown(control: DropdownControl, facts: string[]): Promise<DropdownDecision | null> {
  try {
    const key = makeCacheKey(control, facts);
    const stored = await new Promise<DropdownCache | undefined>((resolve) => {
      chrome.storage.local.get([DROPDOWN_CACHE_KEY], (res) => resolve(res[DROPDOWN_CACHE_KEY] as DropdownCache | undefined));
    });
    const entry = stored?.[key];
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > DROPDOWN_CACHE_TTL_MS) return null;
    return entry.decision;
  } catch {
    return null;
  }
}

export async function cacheDropdown(control: DropdownControl, facts: string[], decision: DropdownDecision): Promise<void> {
  try {
    const key = makeCacheKey(control, facts);
    const stored = await new Promise<DropdownCache>((resolve) => {
      chrome.storage.local.get([DROPDOWN_CACHE_KEY], (res) => resolve((res[DROPDOWN_CACHE_KEY] as DropdownCache) ?? {}));
    });
    stored[key] = { decision, cachedAt: Date.now() };
    await new Promise<void>((resolve) => chrome.storage.local.set({ [DROPDOWN_CACHE_KEY]: stored }, resolve));
  } catch (err) {
    console.warn('[JobFill Dropdown] Failed to cache dropdown decision:', err);
  }
}

function toChoiceControl(control: DropdownControl): ChoiceControl {
  return {
    id: control.id,
    kind: 'select',
    selector: control.selector,
    question: control.question,
    multiple: false,
    options: control.options.map((option) => ({
      id: `${control.id}:option:${option.index}`,
      label: option.label,
      value: option.value,
      disabled: option.disabled,
      selected: option.selected,
      selector: option.selector,
    })),
  };
}

function getProfileFactsWithPhoneDialingCodes(profile: UserProfile): string[] {
  const facts = getRelevantProfileFacts(profile);
  const dialingCodes = profile.phones
    .filter((phone) => phone.primary)
    .map((phone) => phone.value.match(/^\s*(\+\d{1,4})\b/)?.[1])
    .filter((code): code is string => Boolean(code));

  for (const code of new Set(dialingCodes)) {
    facts.push(`contact: Primary phone country calling code: ${code} (phone number withheld)`);
  }
  return facts;
}

function getPrimaryAddressCountry(profile: UserProfile): string {
  const currentAddress = profile.addresses.find((item) => item.label === 'Current' && item.country.trim());
  const primaryAddress = profile.addresses.find((item) => item.primary && item.country.trim());
  const address = currentAddress ?? primaryAddress ?? profile.addresses.find((item) => item.country.trim());
  return address?.country.trim() ?? '';
}

function findCountryCallingCodeOption(control: DropdownControl, country: string): DropdownOption | undefined {
  if (!country || !/\bcountry\b/i.test(control.question)) return undefined;
  if (!control.options.some((option) => /\+\d{1,4}\b/.test(option.label))) return undefined;

  const expectedCountry = country.trim().toLocaleLowerCase();
  return control.options.find((option) => {
    const optionCountry = option.label.split(/\s+\+\d{1,4}\b/)[0].trim().toLocaleLowerCase();
    return optionCountry === expectedCountry && !option.disabled;
  });
}

function findEducationDegreeOption(control: DropdownControl, profile: UserProfile): DropdownOption | undefined {
  if (!/\bdegree\b/i.test(control.question)) return undefined;
  const education = pickEducation(profile, classifyLevelHint(control.question) ?? 'current');
  const degree = education?.degree ?? '';
  let expectedLabel: RegExp | undefined;

  if (/\b(?:b\.?\s*tech|b\.?\s*e\.?|bachelor(?:'s)?\s+of\s+engineering)\b/i.test(degree)) {
    expectedLabel = /^bachelor of engineering$/i;
  } else if (/\b(?:b\.?\s*sc|bachelor(?:'s)?\s+of\s+science)\b/i.test(degree)) {
    expectedLabel = /^bachelor of science$/i;
  } else if (/\b(?:b\.?\s*a|bachelor(?:'s)?\s+of\s+arts)\b/i.test(degree)) {
    expectedLabel = /^bachelor of arts$/i;
  } else if (/\b(?:b\.?\s*com|bachelor(?:'s)?\s+of\s+commerce)\b/i.test(degree)) {
    expectedLabel = /^bachelor of commerce$/i;
  }

  return expectedLabel
    ? control.options.find((option) => expectedLabel.test(option.label.trim()) && !option.disabled)
    : undefined;
}

/** Resolve dropdowns using the same profile-first, indexed choice prompt as radios and checkboxes. */
export async function resolveDropdownsWithAI(
  controls: DropdownControl[],
  profile?: UserProfile,
): Promise<DropdownDecision[]> {
  if (!controls.length) return [];
  const aiEnabled = await isDropdownAIEnabled();

  const profileFacts = profile ? getProfileFactsWithPhoneDialingCodes(profile) : [];
  const profileCountry = profile ? getPrimaryAddressCountry(profile) : '';
  const decisions: DropdownDecision[] = [];
  const candidates: Array<{ control: DropdownControl; choiceControl: ChoiceControl; evidence: ChoiceEvidence }> = [];

  for (const control of controls) {
    const currentlySelected = control.options.find((option) => option.selected && !isDropdownPlaceholder(option.label));

    const workdayPresetOption = getWorkdayPresetOption(control);
    if (workdayPresetOption) {
      if (currentlySelected?.index === workdayPresetOption.index) continue;

      decisions.push({
        controlId: control.id,
        selector: control.selector,
        selectedIndex: workdayPresetOption.index,
        selectedLabel: workdayPresetOption.label,
        confidence: 1,
        optionSelector: workdayPresetOption.selector,
        source: 'profile',
      });
      console.info(`[JobFill Dropdown] Applying configured Workday answer for "${control.question}": "${workdayPresetOption.label}"`);
      continue;
    }

    const educationDegreeOption = profile ? findEducationDegreeOption(control, profile) : undefined;
    if (educationDegreeOption) {
      if (currentlySelected?.index === educationDegreeOption.index) continue;

      decisions.push({
        controlId: control.id,
        selector: control.selector,
        selectedIndex: educationDegreeOption.index,
        selectedLabel: educationDegreeOption.label,
        confidence: 1,
        optionSelector: educationDegreeOption.selector,
        source: 'profile',
      });
      continue;
    }

    const profileCountryOption = findCountryCallingCodeOption(control, profileCountry);
    if (profileCountryOption) {
      if (currentlySelected?.index === profileCountryOption.index) continue;

      const decision: DropdownDecision = {
        controlId: control.id,
        selector: control.selector,
        selectedIndex: profileCountryOption.index,
        selectedLabel: profileCountryOption.label,
        confidence: 1,
        optionSelector: profileCountryOption.selector,
        source: 'profile',
      };
      decisions.push(decision);
      void cacheDropdown(control, profileFacts, decision);
      continue;
    }

    if (currentlySelected) {
      console.info(`[JobFill Dropdown] Preserving existing non-placeholder selection for "${control.question}": "${currentlySelected.label}"`);
      continue;
    }

    if (!control.options.some((option) => !option.disabled)) continue;

    // Configured presets above are profile-independent; skip profile/AI matching without a profile.
    if (!profile) continue;

    const cached = await getCachedDropdown(control, profileFacts);
    if (cached) {
      console.info(`[JobFill Dropdown] Cache hit for "${control.question}": "${cached.selectedLabel}" (index ${cached.selectedIndex})`);
      decisions.push(cached);
      continue;
    }

    // User turned off AI dropdown selection: skip the slow AI call (rules and cache above still apply).
    if (!aiEnabled) {
      console.info(`[JobFill Dropdown] AI dropdown selection is off; leaving "${control.question}" unfilled`);
      continue;
    }

    candidates.push({
      control,
      choiceControl: toChoiceControl(control),
      evidence: { profileFacts, memories: [], formAnswers: [] },
    });
  }

  if (!candidates.length) return decisions;

  const choiceDecisions = await resolveChoicesWithAI(
    candidates.map(({ choiceControl, evidence }) => ({ control: choiceControl, evidence })),
    { stage: 'call1' },
  );

  for (const choiceDecision of choiceDecisions) {
    const candidate = candidates.find(({ choiceControl }) => choiceControl.id === choiceDecision.controlId);
    if (!candidate) continue;

    const selectedId = choiceDecision.selectedOptionIds[0];
    const selectedOption = candidate.choiceControl.options.find((option) => option.id === selectedId);
    const originalOption = candidate.control.options.find((option) => option.index === Number(selectedId.split(':option:').at(-1)));
    if (!selectedOption || !originalOption || originalOption.disabled || isDropdownPlaceholder(originalOption.label)) continue;

    const decision: DropdownDecision = {
      controlId: candidate.control.id,
      selector: candidate.control.selector,
      selectedIndex: originalOption.index,
      selectedLabel: originalOption.label,
      confidence: choiceDecision.confidence,
      optionSelector: originalOption.selector,
      source: 'ai',
    };
    decisions.push(decision);
    void cacheDropdown(candidate.control, profileFacts, decision);
  }

  return decisions;
}
