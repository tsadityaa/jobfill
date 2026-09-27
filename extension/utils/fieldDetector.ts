// ============================================================
// Field Detector — Layer 1 & 2
// ============================================================
// Layer 1: HTML attributes (name, id, autocomplete, type, etc.)
// Layer 2: Known dictionary of field name patterns
// Layer 3: Semantic matching (Phase 5 — AI agent)
// ============================================================

import type { DetectedField, ProfileFieldKey, FieldCategory } from '../types/autofill';
import { isSensitiveField } from './sensitiveFields';

// ---- Layer 2: Known dictionary ----

interface FieldPattern {
  profileField: ProfileFieldKey;
  patterns: RegExp[];
  autocompleteValues: string[];
  inputTypes?: string[];
}

const FIELD_DICTIONARY: FieldPattern[] = [
  // ---- Personal ----
  {
    profileField: 'personal.firstName',
    patterns: [
      /first[_-]?name/i,
      /fname/i,
      /given[_-]?name/i,
      /first/i,
      /forename/i,
    ],
    autocompleteValues: ['given-name'],
  },
  {
    profileField: 'personal.middleName',
    patterns: [
      /middle[_-]?name/i,
      /mname/i,
      /middle/i,
    ],
    autocompleteValues: ['additional-name'],
  },
  {
    profileField: 'personal.lastName',
    patterns: [
      /last[_-]?name/i,
      /lname/i,
      /family[_-]?name/i,
      /surname/i,
      /last/i,
    ],
    autocompleteValues: ['family-name'],
  },
  {
    profileField: 'personal.fullName',
    patterns: [
      /^full[_-]?name$/i,
      /^name$/i,
      /^your[_-]?name$/i,
      /^applicant[_-]?name$/i,
      /^legal[_-]?name$/i,
      /^complete[_-]?name$/i,
    ],
    autocompleteValues: ['name'],
  },
  {
    profileField: 'personal.dateOfBirth',
    patterns: [
      /^(date[_-]?of[_-]?)?birth$/i,
      /^dob$/i,
      /^birthday$/i,
      /^birth[_-]?date$/i,
    ],
    autocompleteValues: ['bday'],
    inputTypes: ['date'],
  },

  // ---- Contact ----
  {
    profileField: 'emails.primary',
    patterns: [
      /e[_-]?mail/i,
      /^email[_-]?addr/i,
      /^contact[_-]?email/i,
    ],
    autocompleteValues: ['email'],
    inputTypes: ['email'],
  },
  {
    profileField: 'phones.primary',
    patterns: [
      /phone/i,
      /mobile/i,
      /^tel$/i,
      /telephone/i,
      /contact[_-]?number/i,
      /mobile[_-]?number/i,
      /phone[_-]?number/i,
      /cell/i,
    ],
    autocompleteValues: ['tel', 'tel-national'],
    inputTypes: ['tel'],
  },

  // ---- Address ----
  {
    profileField: 'addresses.primary.line1',
    patterns: [
      /^address[_-]?(line)?[_-]?1?$/i,
      /^street[_-]?addr/i,
      /^street$/i,
      /^addr1$/i,
    ],
    autocompleteValues: ['address-line1', 'street-address'],
  },
  {
    profileField: 'addresses.primary.line2',
    patterns: [
      /^address[_-]?(line)?[_-]?2$/i,
      /^apt/i,
      /^suite$/i,
      /^addr2$/i,
      /^apartment/i,
    ],
    autocompleteValues: ['address-line2'],
  },
  {
    profileField: 'addresses.primary.city',
    patterns: [
      /^city$/i,
      /^town$/i,
      /^locality$/i,
      /^municipality$/i,
    ],
    autocompleteValues: ['address-level2'],
  },
  {
    profileField: 'addresses.primary.state',
    patterns: [
      /^state$/i,
      /^province$/i,
      /^region$/i,
      /^county$/i,
    ],
    autocompleteValues: ['address-level1'],
  },
  {
    profileField: 'addresses.primary.postalCode',
    patterns: [
      /^(post|zip)[_-]?(code|al)?$/i,
      /^postal$/i,
      /^pin[_-]?code$/i,
    ],
    autocompleteValues: ['postal-code'],
  },
  {
    profileField: 'addresses.primary.country',
    patterns: [
      /^country$/i,
      /^nation$/i,
    ],
    autocompleteValues: ['country', 'country-name'],
  },

  // ---- Education ----
  {
    profileField: 'education.latest.institution',
    patterns: [
      /^(school|university|college|institution)[_-]?(name)?$/i,
      /^alma[_-]?mater$/i,
    ],
    autocompleteValues: [],
  },
  {
    profileField: 'education.latest.degree',
    patterns: [
      /^degree$/i,
      /^qualification$/i,
      /^degree[_-]?type$/i,
    ],
    autocompleteValues: [],
  },
  {
    profileField: 'education.latest.field',
    patterns: [
      /^(field|area)[_-]?(of)?[_-]?(study|specialization)$/i,
      /^major$/i,
      /^concentration$/i,
      /^discipline$/i,
      /^branch$/i,
    ],
    autocompleteValues: [],
  },
  {
    profileField: 'education.latest.gpa',
    patterns: [
      /^gpa$/i,
      /^cgpa$/i,
      /^grade$/i,
      /^percentage$/i,
    ],
    autocompleteValues: [],
  },

  // ---- Experience ----
  {
    profileField: 'experience.latest.company',
    patterns: [
      /^company$/i,
      /^employer$/i,
      /^organization$/i,
      /^organisation$/i,
      /^company[_-]?name$/i,
      /^current[_-]?employer$/i,
    ],
    autocompleteValues: ['organization'],
  },
  {
    profileField: 'experience.latest.title',
    patterns: [
      /^(job[_-]?)?(title|position|role|designation)$/i,
      /^current[_-]?title$/i,
      /^current[_-]?position$/i,
    ],
    autocompleteValues: ['organization-title'],
  },

  // ---- Professional ----
  {
    profileField: 'professional.linkedin',
    patterns: [
      /linkedin/i,
    ],
    autocompleteValues: [],
  },
  {
    profileField: 'professional.github',
    patterns: [
      /github/i,
    ],
    autocompleteValues: [],
  },
  {
    profileField: 'professional.portfolio',
    patterns: [
      /portfolio/i,
      /website/i,
      /personal[_-]?(site|page|url)/i,
    ],
    autocompleteValues: ['url'],
  },
  {
    profileField: 'professional.skills',
    patterns: [
      /^skills$/i,
      /^key[_-]?skills$/i,
      /^technical[_-]?skills$/i,
      /^competencies$/i,
    ],
    autocompleteValues: [],
  },
];

// ---- Core Detection Functions ----

/**
 * Generate a unique CSS selector for an element.
 */
function getUniqueSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const path: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector = `#${CSS.escape(current.id)}`;
      path.unshift(selector);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    path.unshift(selector);
    current = parent;
  }
  return path.join(' > ');
}

/**
 * Get the label text associated with a form element.
 * Handles standard labels, aria attributes, AND non-standard patterns
 * like Google Forms (where labels are divs/spans in ancestor containers).
 */
function getLabelText(el: HTMLElement): string | undefined {
  // 1. Check for <label for="...">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent?.trim();
  }

  // 2. Check for wrapping <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const inputs = clone.querySelectorAll('input, select, textarea');
    inputs.forEach((input) => input.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  // 3. Check aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent?.trim();
  }

  // 4. Check aria-label directly
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // 5. Check preceding sibling text
  const prev = el.previousElementSibling;
  if (prev && ['LABEL', 'SPAN', 'P', 'DIV'].includes(prev.tagName)) {
    const text = prev.textContent?.trim();
    if (text && text.length < 100) return text;
  }

  // 6. Walk up ancestors to find the closest "question container"
  //    This handles Google Forms, Typeform, custom React forms, etc.
  //    where the label is in a sibling/cousin div, not a <label> tag.
  let ancestor: HTMLElement | null = el.parentElement;
  let depth = 0;
  while (ancestor && depth < 6) {
    // Look for text-bearing elements before the input within this ancestor
    const textEls = ancestor.querySelectorAll(
      'span, h1, h2, h3, h4, h5, h6, p, legend, [role="heading"], [data-initial-value]',
    );
    for (const textEl of textEls) {
      // Skip if the text element is inside or IS the input
      if (textEl === el || textEl.contains(el) || el.contains(textEl)) continue;
      // Skip tiny or huge text
      const text = textEl.textContent?.trim();
      if (text && text.length > 1 && text.length < 200) {
        // Make sure this text element comes BEFORE the input in DOM order
        if (textEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
          return text;
        }
      }
    }
    ancestor = ancestor.parentElement;
    depth++;
  }

  return undefined;
}

/**
 * Match an element against the field dictionary.
 * Returns the best match with confidence score.
 */
function matchField(
  attributes: DetectedField['attributes'],
  inputType: string,
): { profileField: ProfileFieldKey; confidence: number } | null {
  let bestMatch: { profileField: ProfileFieldKey; confidence: number } | null = null;

  for (const entry of FIELD_DICTIONARY) {
    let confidence = 0;

    // Layer 1: autocomplete attribute (highest confidence)
    if (
      attributes.autocomplete &&
      entry.autocompleteValues.includes(attributes.autocomplete)
    ) {
      confidence = Math.max(confidence, 0.95);
    }

    // Layer 1: input type match
    if (entry.inputTypes?.includes(inputType)) {
      confidence = Math.max(confidence, 0.8);
    }

    // Layer 2: name/id pattern matching
    const namesToCheck = [attributes.name, attributes.id].filter(Boolean) as string[];
    for (const name of namesToCheck) {
      if (entry.patterns.some((pattern) => pattern.test(name))) {
        confidence = Math.max(confidence, 0.85);
      }
    }

    // Layer 2: placeholder / aria-label / label text matching
    const textsToCheck = [
      attributes.placeholder,
      attributes.ariaLabel,
      attributes.labelText,
    ].filter(Boolean) as string[];
    for (const text of textsToCheck) {
      // Normalize: remove special chars, collapse whitespace
      const normalized = text.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
      if (entry.patterns.some((pattern) => pattern.test(normalized))) {
        confidence = Math.max(confidence, 0.7);
      }
    }

    if (confidence > 0 && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = { profileField: entry.profileField, confidence };
    }
  }

  return bestMatch;
}

/**
 * Scan the current page for all fillable form fields.
 * Returns detected fields with their matched profile keys and categories.
 */
export function scanPageFields(): DetectedField[] {
  const elements = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), select, textarea',
  );

  const detected: DetectedField[] = [];

  for (const el of elements) {
    // Skip invisible elements
    if (el.offsetParent === null && el.getAttribute('type') !== 'hidden') continue;

    const attributes: DetectedField['attributes'] = {
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined,
      autocomplete: el.getAttribute('autocomplete') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      labelText: getLabelText(el),
    };

    const inputType = el instanceof HTMLInputElement ? (el.type || 'text') : el.tagName.toLowerCase();

    // Check for sensitive fields first
    const allTexts = [
      attributes.placeholder,
      attributes.ariaLabel,
      attributes.labelText,
      attributes.name,
    ].filter(Boolean) as string[];

    const sensitive = isSensitiveField(allTexts);

    if (sensitive) {
      detected.push({
        selector: getUniqueSelector(el),
        tagName: el.tagName.toLowerCase(),
        inputType,
        attributes,
        profileField: null,
        confidence: 0,
        category: 'USER_DECISION_REQUIRED',
        currentValue: el.value || '',
      });
      continue;
    }

    // Try to match field
    const match = matchField(attributes, inputType);

    detected.push({
      selector: getUniqueSelector(el),
      tagName: el.tagName.toLowerCase(),
      inputType,
      attributes,
      profileField: match?.profileField ?? null,
      confidence: match?.confidence ?? 0,
      category: match ? 'SAFE_AUTO' : 'UNKNOWN',
      currentValue: el.value || '',
    });
  }

  return detected;
}

// ---- AI Layer: Sanitized Field Extraction ----

import type { SanitizedField, FieldIdLookup } from '../types/aiMapper';

/**
 * Extract sanitized field descriptors for AI mapping.
 * DELIBERATELY strips: values, textContent, surrounding page text.
 * Returns:
 *   - sanitizedFields: safe to send to AI
 *   - selectorLookup: local-only map (fieldId → CSS selector), NEVER sent anywhere
 */
export function extractSanitizedFields(): {
  sanitizedFields: SanitizedField[];
  selectorLookup: FieldIdLookup;
} {
  const elements = document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), select, textarea',
  );

  const sanitizedFields: SanitizedField[] = [];
  const selectorLookup: FieldIdLookup = {};
  let index = 0;

  for (const el of elements) {
    // Skip invisible elements
    if (el.offsetParent === null && el.getAttribute('type') !== 'hidden') continue;

    const fieldId = `f${index}`;
    const selector = getUniqueSelector(el);
    selectorLookup[fieldId] = selector;

    const sanitized: SanitizedField = {
      fieldId,
      tag: el.tagName.toLowerCase(),
      type: el instanceof HTMLInputElement ? (el.type || 'text') : el.tagName.toLowerCase(),
    };

    // Label text (safe — it's the visible form label, not user data)
    const labelText = getLabelText(el);
    if (labelText) sanitized.label = labelText;

    // Placeholder (safe — it's developer-set hint text)
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) sanitized.placeholder = placeholder;

    // Name attribute (safe — it's the HTML field name)
    const name = el.getAttribute('name');
    if (name) sanitized.name = name;

    // Autocomplete attribute
    const autocomplete = el.getAttribute('autocomplete');
    if (autocomplete) sanitized.autocomplete = autocomplete;

    // Aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) sanitized.ariaLabel = ariaLabel;

    // For <select>: include option label texts (NOT values, NOT selected state)
    if (el instanceof HTMLSelectElement) {
      sanitized.options = Array.from(el.options)
        .map((opt) => opt.textContent?.trim() ?? '')
        .filter((text) => text.length > 0 && text.length < 100)
        .slice(0, 20); // Cap at 20 options to save tokens
    }

    sanitizedFields.push(sanitized);
    index++;
  }

  return { sanitizedFields, selectorLookup };
}
