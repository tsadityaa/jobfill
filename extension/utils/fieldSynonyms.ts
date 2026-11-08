// ============================================================
// Field Synonym Matcher (local profile matching)
// ============================================================
// Data-driven replacement for the old regex dictionary. All matching rules live in
// ../data/field-synonyms.json - to support a new label, add a phrase there; no code change.
//
// Entry shape (all lists optional except profileField):
//   synonyms     whole label / name / id equals the phrase           -> confidence 0.90
//   weak         ambiguous phrases (e.g. "address", "percentage")    -> confidence 0.70
//                (Google Forms re-checks <0.85 matches with the LLM)
//   autocomplete HTML autocomplete tokens                            -> confidence 0.95
//   inputTypes   <input type> values                                 -> confidence 0.80
// Phrases are normalised like labels: case-insensitive, punctuation-insensitive,
// "e-mail" == "email", camelCase / snake_case split. The most specific (longest) phrase wins ties.
// Polite/instructional prefix words (e.g. "please enter your") are stripped to variants
// so standard labels match cleanly without risk of false positives on open prompts.
// Anything that does not match here is sent to the LLM.
// ============================================================

import registryJson from '../data/field-synonyms.json';
import type { DetectedField, ProfileFieldKey } from '../types/autofill';

interface RegistryEntry {
  profileField: string;
  synonyms?: string[];
  weak?: string[];
  autocomplete?: string[];
  inputTypes?: string[];
}

interface CompiledEntry {
  profileField: ProfileFieldKey;
  exact: Set<string>;
  weak: Set<string>;
  autocomplete: Set<string>;
  inputTypes: Set<string>;
}

export const SYNONYM_CONFIDENCE = {
  autocomplete: 0.95,
  exact: 0.9,
  inputType: 0.8,
  weak: 0.7,
} as const;

/**
 * Lowercase, drop punctuation, treat "e mail" as "email".
 * `splitCamel` is only for HTML name/id attributes ("firstName"); human labels such as
 * "LinkedIn" / "GitHub" must not be split.
 */
export function normalizeText(text: string, splitCamel = false): string {
  return (splitCamel ? text.replace(/([a-z0-9])([A-Z])/g, '$1 $2') : text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\be mail\b/g, 'email')
    .trim();
}

/**
 * Strip common polite form prefixes (e.g. "please enter your first name" -> "first name")
 * without disturbing open-ended prompt phrases or qualifiers like "emergency contact".
 */
export function stripPrefixFillers(text: string): string {
  let prev = '';
  let curr = text;
  while (prev !== curr) {
    prev = curr;
    curr = curr.replace(/^(?:please\s+(?:enter|provide|fill\s+in|type)|enter\s+your|provide\s+your|enter|provide|type|fill\s+in|your|applicant(?:\x27?s)?|candidate(?:\x27?s)?)\s+/gi, '').trim();
  }
  return curr;
}

function compile(entries: RegistryEntry[]): CompiledEntry[] {
  const norm = (list?: string[]) => (list ?? []).map((phrase) => normalizeText(phrase)).filter(Boolean);
  return entries.map((entry) => ({
    profileField: entry.profileField as ProfileFieldKey,
    exact: new Set(norm(entry.synonyms)),
    weak: new Set(norm(entry.weak)),
    autocomplete: new Set((entry.autocomplete ?? []).map((value) => value.toLowerCase())),
    inputTypes: new Set((entry.inputTypes ?? []).map((value) => value.toLowerCase())),
  }));
}

const ENTRIES = compile(registryJson as unknown as RegistryEntry[]);

/** Profile keys the registry can produce (used by tests / diagnostics). */
export function getRegistryProfileFields(): ProfileFieldKey[] {
  return [...new Set(ENTRIES.map((entry) => entry.profileField))];
}

/**
 * Normalised variants of a raw attribute: with and without parenthetical hints,
 * with and without polite prefix fillers, and (for name/id attributes such as "education-2--school")
 * without standalone numbers.
 */
function textVariants(raw: string, isIdentifier: boolean): string[] {
  const withoutParens = raw.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const variants = new Set<string>();
  for (const source of [raw, withoutParens]) {
    // Identifiers (name/id) get both the camelCase-split and the unsplit form: "firstName" and "linkedIn".
    for (const normalized of isIdentifier
      ? [normalizeText(source, true), normalizeText(source, false)]
      : [normalizeText(source)]) {
      if (!normalized) continue;
      variants.add(normalized);
      if (isIdentifier) {
        const stripped = normalized.split(' ').filter((word) => !/^\d+$/.test(word)).join(' ');
        if (stripped) variants.add(stripped);
      } else {
        const strippedFiller = stripPrefixFillers(normalized);
        if (strippedFiller && strippedFiller !== normalized) {
          variants.add(strippedFiller);
        }
      }
    }
  }
  return [...variants];
}

export function matchFieldBySynonyms(
  attributes: DetectedField['attributes'],
  inputType: string,
): { profileField: ProfileFieldKey; confidence: number } | null {
  const labelTexts = [attributes.labelText, attributes.ariaLabel, attributes.placeholder]
    .filter((value): value is string => Boolean(value));
  const idTexts = [attributes.name, attributes.id].filter((value): value is string => Boolean(value));
  const variants = [...new Set([
    ...labelTexts.flatMap((text) => textVariants(text, false)),
    ...idTexts.flatMap((text) => textVariants(text, true)),
  ])];
  const autocompleteTokens = (attributes.autocomplete ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const type = inputType.toLowerCase();

  let best: { profileField: ProfileFieldKey; confidence: number; specificity: number } | null = null;

  for (const entry of ENTRIES) {
    let confidence = 0;
    let specificity = 0;
    const consider = (candidateConfidence: number, candidateSpecificity: number) => {
      if (candidateConfidence > confidence || (candidateConfidence === confidence && candidateSpecificity > specificity)) {
        confidence = candidateConfidence;
        specificity = candidateSpecificity;
      }
    };

    if (autocompleteTokens.some((token) => entry.autocomplete.has(token))) consider(SYNONYM_CONFIDENCE.autocomplete, 0);
    if (entry.inputTypes.has(type)) consider(SYNONYM_CONFIDENCE.inputType, 0);

    for (const variant of variants) {
      const words = variant.split(' ');
      if (entry.exact.has(variant)) consider(SYNONYM_CONFIDENCE.exact, words.length);
      else if (entry.weak.has(variant)) consider(SYNONYM_CONFIDENCE.weak, words.length);
    }

    if (
      confidence > 0
      && (!best || confidence > best.confidence || (confidence === best.confidence && specificity > best.specificity))
    ) {
      best = { profileField: entry.profileField, confidence, specificity };
    }
  }

  return best ? { profileField: best.profileField, confidence: best.confidence } : null;
}
