// ============================================================
// Form Filler
// ============================================================
// Fills form fields with mapped values, dispatching appropriate
// events so React/Angular/Vue forms detect the changes.
// ============================================================

import type { FieldMapping, AutofillResult, AutofillFieldResult } from '../types/autofill';
import { getElementBySelector, queryAcrossOpenShadowRoots, scanPageFields } from './fieldDetector';
import { cleanAnswerText } from './answerGenerator';
import collegeAliases from '../data/college-aliases.json';
import { withScrollLock, withScrollLockSync } from './scrollLock';

/**
 * Find the React fiber key on a DOM node (differs across React versions).
 */
function getReactFiberKey(el: Element): string | undefined {
  return Object.keys(el).find(
    (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
  );
}

/**
 * Walk the React fiber tree upward and call the first onChange prop found.
 * This directly updates React 16/17/18 internal state so it matches the DOM,
 * preventing React from reconciling the value back to "" on next render.
 */
function triggerReactOnChange(
  el: HTMLInputElement | HTMLTextAreaElement,
): void {
  const fiberKey = getReactFiberKey(el);
  if (!fiberKey) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node = (el as any)[fiberKey];
  while (node) {
    const onChange =
      node.memoizedProps?.onChange ?? node.pendingProps?.onChange;
    if (typeof onChange === 'function') {
      // Build a minimal synthetic-event-like object React onChange expects
      onChange({
        target: el,
        currentTarget: el,
        type: 'change',
        nativeEvent: new Event('change', { bubbles: true }),
        bubbles: true,
        preventDefault: () => { },
        stopPropagation: () => { },
        persist: () => { },
      });
      return;
    }
    node = node.return;
  }
}

/**
 * Set the native DOM value using the prototype setter.
 * Required for React controlled components (bypasses React's value tracking).
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const cleanedValue = cleanAnswerText(value);
  const setter =
    el instanceof HTMLTextAreaElement
      ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  if (setter) {
    setter.call(el, cleanedValue);
  } else {
    el.value = cleanedValue;
  }
}

function getWorkdayDatePartValue(el: HTMLInputElement, value: string): string | null | undefined {
  const automationId = el.getAttribute('data-automation-id');
  if (el.getAttribute('role') !== 'spinbutton' || !automationId?.startsWith('dateSection')) return undefined;

  let month: string | undefined;
  let year: string | undefined;
  const normalized = value.trim();
  const isoDate = normalized.match(/^(\d{4})[-./:](\d{1,2})(?:[-./:](\d{1,2}))?$/);
  const monthYear = normalized.match(/^(\d{1,2})[./:-](\d{4})$/);
  const numericDate = normalized.match(/^(\d{1,2})[./:-](\d{1,2})[./:-](\d{4})$/);
  if (isoDate) {
    [, year, month] = isoDate;
    const day = isoDate[3];
    if (day && !isValidCalendarDate(Number(year), Number(month), Number(day))) return null;
  } else if (monthYear) {
    [, month, year] = monthYear;
  } else if (numericDate) {
    const first = Number(numericDate[1]);
    const second = Number(numericDate[2]);
    year = numericDate[3];
    const dateOrder = new Intl.DateTimeFormat(navigator.language)
      .formatToParts(new Date(2001, 10, 22))
      .filter((part) => part.type === 'day' || part.type === 'month')
      .map((part) => part.type);
    const monthFirst = dateOrder.indexOf('month') < dateOrder.indexOf('day');
    if (first > 12) {
      month = String(second);
      if (!isValidCalendarDate(Number(year), second, first)) return null;
    } else if (second > 12) {
      month = String(first);
      if (!isValidCalendarDate(Number(year), first, second)) return null;
    } else if (monthFirst) {
      month = String(first);
      if (!isValidCalendarDate(Number(year), first, second)) return null;
    } else {
      month = String(second);
      if (!isValidCalendarDate(Number(year), second, first)) return null;
    }
  } else {
    return null;
  }

  if (!month || !year || Number(month) < 1 || Number(month) > 12) return null;
  // Workday's MM box rejects an unpadded "5" and stays blank ("MM/2023" -> Invalid Date).
  month = month.padStart(2, '0');

  if (automationId === 'dateSectionMonth-input') return month;
  if (automationId === 'dateSectionYear-input') return year;
  return undefined;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function formatDateForInput(el: HTMLInputElement, value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)
  ) return value;

  const isoDate = `${year}-${month}-${day}`;
  if (el.type === 'date') return isoDate;
  if (el.type === 'month') return `${year}-${month}`;
  if (el.type === 'datetime-local') return `${isoDate}T00:00`;

  const hints = [
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('data-date-format'),
    ...Array.from(el.labels ?? [], (label) => label.textContent ?? ''),
  ].filter(Boolean).join(' ').toUpperCase();
  const format = hints.match(/(D{1,2}|M{1,2}|Y{2,4})([./:-])(D{1,2}|M{1,2}|Y{2,4})\2(D{1,2}|M{1,2}|Y{2,4})/);
  if (!format) return isoDate;

  const tokens = [format[1], format[3], format[4]];
  if (new Set(tokens.map((token) => token[0])).size !== 3) return isoDate;

  const parts: Record<string, string> = {
    D: tokens.find((token) => token.startsWith('D'))?.length === 2 ? day : String(Number(day)),
    M: tokens.find((token) => token.startsWith('M'))?.length === 2 ? month : String(Number(month)),
    Y: tokens.find((token) => token.startsWith('Y'))?.length === 2 ? year.slice(-2) : year,
  };
  return tokens.map((token) => parts[token[0]]).join(format[2]);
}

/**
 * Dispatch native DOM events that frameworks listen to.
 * Also directly triggers React fiber onChange to commit value into React state.
 */
function dispatchInputEvents(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, skipBlur = false): void {
  el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

  // Trigger React fiber onChange directly — commits value into React state
  // so it survives re-renders (input/textarea only; select uses DOM events)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    triggerReactOnChange(el);
  }

  // Also fire DOM events for Angular/Vue/non-React forms
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  if (!skipBlur) {
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }
}

function pressWorkdayEnter(el: HTMLInputElement): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, composed: true }));
}

function getWorkdaySearchQueries(mapping: FieldMapping): string[] | null {
  const profileField = mapping.profileField;
  if (isWorkdaySchoolField(profileField)) {
    return [mapping.value.trim()];
  }
  if (/^education\.(?:current|ug|pg|phd|highest)\.fieldOfStudy$/.test(profileField) || profileField === 'education.latest.field') {
    return [/^(?:cse|computer science and engineering)$/i.test(mapping.value.trim())
      ? 'Computer Science'
      : mapping.value.trim()];
  }
  if (profileField === 'professional.skills') {
    const skills = [...new Set(mapping.value.split(',').map((skill) => skill.trim()).filter(Boolean))];
    return skills.length ? skills : null;
  }
  return null;
}

function clickWorkdayOption(element: HTMLElement): void {
  const clickTarget = element.querySelector<HTMLElement>('[data-automation-id="promptLeafNode"]') ?? element;
  const rect = clickTarget.getBoundingClientRect();
  const shared: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    button: 0,
    buttons: 1,
  };

  clickTarget.dispatchEvent(new PointerEvent('pointerdown', { ...shared, pointerId: 1, pointerType: 'mouse' }));
  clickTarget.dispatchEvent(new MouseEvent('mousedown', shared));
  clickTarget.dispatchEvent(new PointerEvent('pointerup', { ...shared, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
  clickTarget.dispatchEvent(new MouseEvent('mouseup', { ...shared, buttons: 0 }));
  clickTarget.dispatchEvent(new MouseEvent('click', { ...shared, buttons: 0 }));
}

function normalizeWorkdayLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

interface CollegeAliasEntry {
  canonical_name: string;
  aliases: string[];
}

const COLLEGE_ALIAS_ENTRIES = collegeAliases as CollegeAliasEntry[];

function normalizeCollegeName(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isWorkdaySchoolField(profileField: string): boolean {
  return /^education\.(?:current|ug|pg|phd|highest)\.institutionName$/.test(profileField) || profileField === 'education.latest.institution';
}

function findCollegeAliasEntry(value: string): CollegeAliasEntry | undefined {
  const normalized = normalizeCollegeName(value);
  return COLLEGE_ALIAS_ENTRIES.find((entry) =>
    [entry.canonical_name, ...entry.aliases].some((name) => normalizeCollegeName(name) === normalized),
  );
}

function getCollegeSearchNames(value: string): string[] {
  const normalized = normalizeCollegeName(value);
  const matchingEntries = COLLEGE_ALIAS_ENTRIES.filter((entry) =>
    [entry.canonical_name, ...entry.aliases].some((name) => normalizeCollegeName(name) === normalized),
  );
  const allNames = new Set<string>();
  // Prioritize canonical name first (e.g. if user has alias like IITB, search canonical name first)
  for (const entry of matchingEntries) {
    allNames.add(entry.canonical_name);
  }
  allNames.add(value.trim());
  if (normalized.includes('vellore') || normalized === 'vit') {
    allNames.add('Vellore Institute of Technology');
    allNames.add('VIT');
    allNames.add('VIT University');
    allNames.add('Vellore Institute of Technology (VIT)');
  }
  return [...allNames];
}

const WORKDAY_SKILL_ALIASES: Record<string, string[]> = {
  html: ['Hyper Text Markup Language (HTML)'],
  'hyper text markup language': ['HTML', 'Hyper Text Markup Language (HTML)'],
  css: ['Cascading Style Sheets', 'CSS'],
  'cascading style sheets': ['CSS', 'Cascading Style Sheets'],
  css3: ['CSS3', 'CSS'],
  js: ['JavaScript'],
  javascript: ['JavaScript'],
  'java script': ['JavaScript'],
  ts: ['TypeScript'],
  typescript: ['TypeScript'],
  'type script': ['TypeScript'],
  'c++': ['C++ Programming Language'],
  cpp: ['C++ Programming Language'],
  'c plus plus': ['C++ Programming Language'],
  'c#': ['C Sharp (Programming Language)'],
  csharp: ['C Sharp (Programming Language)'],
  'c sharp': ['C Sharp (Programming Language)'],
  golang: ['Go Programming Language', 'Go'],
  'go lang': ['Go Programming Language', 'Go'],
  'go language': ['Go Programming Language', 'Go'],
  py: ['Python', 'Python (Programming Language)'],
  python: ['Python', 'Python (Programming Language)'],
  php: ['PHP (Programming Language)', 'PHP'],
  ruby: ['Ruby', 'Ruby (Programming Language)'],
  rust: ['Rust Programming Language', 'Rust'],
  swift: ['Swift Programming Language', 'Swift'],
  kotlin: ['Kotlin Programming Language', 'Kotlin'],
  java: ['Java', 'Java Programming Language'],
  dart: ['Dart Programming Language', 'Dart'],
  perl: ['Perl Programming Language', 'Perl'],
  r: ['R Programming Language', 'R'],
  scala: ['Scala Programming Language', 'Scala'],
  sql: ['SQL', 'Structured Query Language'],
  'structured query language': ['SQL', 'Structured Query Language'],
  django: ['Django', 'Django Web Framework'],
  'django framework': ['Django', 'Django Web Framework'],
  node: ['Node.js'],
  'react js': ['React.js', 'React'],
  react: ['React.js', 'React'],
  reactjs: ['React.js', 'React'],
  vue: ['Vue.js', 'Vue'],
  vuejs: ['Vue.js', 'Vue'],
  angular: ['Angular', 'Angular Framework'],
  'node js': ['Node.js'],
  nodejs: ['Node.js'],
  'node.js': ['Node.js'],
  express: ['Express.js', 'Express'],
  'express js': ['Express.js', 'Express'],
  nextjs: ['Next.js', 'Next'],
  'next js': ['Next.js', 'Next'],
  'k8s': ['Kubernetes'],
  kube: ['Kubernetes'],
  kubernetes: ['Kubernetes'],
  docker: ['Docker'],
  aws: ['Amazon Web Services (AWS)', 'Amazon Web Services'],
  'amazon web services': ['Amazon Web Services (AWS)', 'Amazon Web Services'],
  gcp: ['Google Cloud Platform (GCP)', 'Google Cloud Platform'],
  'google cloud': ['Google Cloud Platform (GCP)', 'Google Cloud Platform'],
  azure: ['Microsoft Azure', 'Azure'],
  mongodb: ['MongoDB', 'MongoDB (Platform)'],
  mongo: ['MongoDB', 'MongoDB (Platform)'],
  postgres: ['PostgreSQL', 'Postgres'],
  postgresql: ['PostgreSQL', 'Postgres'],
  mysql: ['MySQL'],
  redis: ['Redis'],
  tensorflow: ['TensorFlow', 'TensorFlow.js'],
  tf: ['TensorFlow'],
  pytorch: ['PyTorch'],
  'scikit learn': ['scikit-learn', 'Scikit-Learn'],
  sklearn: ['scikit-learn', 'Scikit-Learn'],
  'machine learning': ['Machine Learning'],
  ml: ['Machine Learning'],
  'artificial intelligence': ['Artificial Intelligence'],
  ai: ['Artificial Intelligence'],
  pandas: ['Pandas'],
  numpy: ['NumPy', 'Numpy'],
  spark: ['Apache Spark', 'Spark'],
  pyspark: ['Apache Spark', 'PySpark'],
  kafka: ['Apache Kafka', 'Kafka'],
  airflow: ['Apache Airflow', 'Airflow'],
  'data science': ['Data Science'],
  'data engineering': ['Data Engineering'],
  'web development': ['Web Development'],
  'web dev': ['Web Development'],
  'app development': ['Application Development'],
  'application development': ['Application Development'],
};

function getWorkdaySearchTerms(query: string, isSchool: boolean): string[] {
  if (isSchool) return getCollegeSearchNames(query);
  const aliases = WORKDAY_SKILL_ALIASES[normalizeWorkdayLabel(query)] ?? [];
  return [...new Set([query, ...aliases])];
}

function isExactWorkdayOptionMatch(value: string, expected: string, isSchool: boolean): boolean {
  if (isSchool) {
    const normalized = normalizeCollegeName(value);
    return getCollegeSearchNames(expected).some((name) => {
      const candidate = normalizeCollegeName(name);
      return normalized === candidate;
    });
  }

  const normalized = normalizeWorkdayLabel(value);
  const normalizedExpected = normalizeWorkdayLabel(expected);
  const candidates = [normalizedExpected, ...(WORKDAY_SKILL_ALIASES[normalizedExpected] ?? []).map(normalizeWorkdayLabel)];

  return candidates.some((candidate) => {
    if (!candidate) return false;
    return normalized === candidate
      || (normalized.startsWith(`${candidate} (`) && normalized.endsWith(')'))
      || normalized.startsWith(`${candidate} -`);
  });
}

function matchesWorkdayLabel(value: string, expected: string, isSchool: boolean): boolean {
  const cleaned = value
    .replace(/[×✕✖\u00d7\u2715\u2716]/g, ' ')
    .replace(/\b(remove|delete|close|selected)\b/gi, ' ');
  if (isSchool) {
    if (isExactWorkdayOptionMatch(cleaned, expected, true)) return true;
    const normalized = normalizeCollegeName(cleaned);
    const searchNames = getCollegeSearchNames(expected);
    return searchNames.some((name) => {
      const candidate = normalizeCollegeName(name);
      return candidate.length >= 4 && (normalized === candidate || normalized.startsWith(`${candidate} `));
    });
  }

  const normalized = normalizeWorkdayLabel(cleaned);
  const normalizedExpected = normalizeWorkdayLabel(expected);
  const candidates = [normalizedExpected, ...(WORKDAY_SKILL_ALIASES[normalizedExpected] ?? []).map(normalizeWorkdayLabel)];

  return candidates.some((candidate) => {
    if (!candidate) return false;
    return normalized === candidate
      || (normalized.startsWith(`${candidate} (`) && normalized.endsWith(')'))
      || normalized.startsWith(`${candidate} -`);
  });
}

async function findWorkdayOption(input: HTMLInputElement, expected: string, isSchool: boolean): Promise<HTMLElement | undefined> {
  const multiselectId = input.getAttribute('data-uxi-multiselect-id');
  const listboxes = queryAcrossOpenShadowRoots<HTMLElement>(
    '[data-automation-id="activeListContainer"][role="listbox"], [role="listbox"][aria-label="Options Expanded"]',
  ).filter((listbox) => getComputedStyle(listbox).display !== 'none' && listbox.getClientRects().length > 0);

  const getOptionText = (opt: HTMLElement): string => {
    const leaf = opt.querySelector<HTMLElement>('[data-automation-id="promptLeafNode"]');
    return (leaf?.innerText || leaf?.textContent || opt.innerText || opt.textContent || '').trim();
  };

  for (const listbox of listboxes) {
    const rawOptions = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
    if (!rawOptions.length) continue;

    const filteredOptions = multiselectId
      ? rawOptions.filter((option) => {
          const optId = option.getAttribute('data-uxi-multiselect-id')
            ?? option.querySelector<HTMLElement>('[data-uxi-multiselect-id]')?.getAttribute('data-uxi-multiselect-id');
          return optId === multiselectId;
        })
      : rawOptions;
    const options = filteredOptions.length > 0 ? filteredOptions : rawOptions;

    // 1. Exact match (exact college name, alias, or skill label)
    const exactMatch = options.find((option) =>
      isExactWorkdayOptionMatch(getOptionText(option), expected, isSchool),
    );
    if (exactMatch) return exactMatch;

    // 2. Strict prefix match (option label starts with the target name, e.g. "Vellore Institute of Technology, India")
    const searchTerms = getWorkdaySearchTerms(expected, isSchool);
    const prefixMatch = options.find((option) => {
      const optText = isSchool
        ? normalizeCollegeName(getOptionText(option))
        : normalizeWorkdayLabel(getOptionText(option));
      return searchTerms.some((term) => {
        const candidate = isSchool ? normalizeCollegeName(term) : normalizeWorkdayLabel(term);
        return candidate.length >= 4 && (optText === candidate || optText.startsWith(`${candidate} `));
      });
    });
    if (prefixMatch) return prefixMatch;
  }

  return undefined;
}

async function fillWorkdayMultiSelect(selector: string, query: string, isSchool: boolean): Promise<boolean> {
  return withScrollLock(async () => {
    const getInput = (): HTMLInputElement | null => {
      const element = getElementBySelector(selector);
      return element instanceof HTMLInputElement ? element : null;
    };
    const getContainer = (): HTMLElement | null =>
      getInput()?.closest<HTMLElement>('[data-automation-id="multiSelectContainer"]') ?? null;
    const initialInput = getInput();
    const initialContainer = getContainer();
    if (!initialInput || !initialContainer) return false;

    const expected = normalizeWorkdayLabel(query);
    const selectedItems = Array.from(initialContainer.querySelectorAll<HTMLElement>('[data-automation-id="selectedItem"], [data-automation-id*="selectedItem"]'));
    if (selectedItems.some((item) => matchesWorkdayLabel(item.innerText || item.textContent || item.getAttribute('aria-label') || '', expected, isSchool))) {
      return true;
    }

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const getSearchInput = () => getContainer()?.querySelector<HTMLInputElement>('[data-automation-id="searchBox"]') ?? getInput() ?? initialInput;
    const setQuery = (input: HTMLInputElement, value: string) => {
      if (setter) setter.call(input, value);
      else input.value = value;
      dispatchInputEvents(input, true);
    };

    initialInput.focus({ preventScroll: true });
    try {
      let exactOption: HTMLElement | undefined;
      for (const searchTerm of getWorkdaySearchTerms(query, isSchool)) {
        const input = getSearchInput();
        input.focus({ preventScroll: true });
        setQuery(input, searchTerm.slice(0, 1));
        pressWorkdayEnter(input);
        await new Promise((resolve) => setTimeout(resolve, 200));
        setQuery(input, searchTerm);
        pressWorkdayEnter(input);

        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const currentInput = getSearchInput();
          exactOption = await findWorkdayOption(currentInput, expected, isSchool);
          if (exactOption) break;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        if (exactOption) break;
      }
      if (!exactOption) return false;

      // Click the matched option and finish
      clickWorkdayOption(exactOption);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    } finally {
      const input = getSearchInput();
      const hasSelected = Array.from(initialContainer.querySelectorAll<HTMLElement>(
        '[data-automation-id="selectedItem"], [data-automation-id*="selectedItem"], [data-automation-id="promptLeafNode"]'
      )).some((item) => matchesWorkdayLabel(item.innerText || item.textContent || item.getAttribute('aria-label') || '', expected, isSchool));
      if (!hasSelected && input.value) {
        setQuery(input, '');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, composed: true }));
      }
    }
  });
}

async function closeWorkdayMultiSelect(selector: string): Promise<void> {
  const element = getElementBySelector(selector);
  const input = element instanceof HTMLInputElement ? element : null;
  const container = input?.closest<HTMLElement>('[data-automation-id="multiSelectContainer"]') ?? null;
  const searchInput = container?.querySelector<HTMLInputElement>('[data-automation-id="searchBox"]') ?? input;

  if (searchInput && searchInput !== input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(searchInput, '');
    else searchInput.value = '';
    dispatchInputEvents(searchInput, true);

    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, composed: true }));
    searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, composed: true }));

    searchInput.blur();
    searchInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    searchInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  if (input) {
    input.blur();
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  // Dismiss dropdown by dispatching Escape and global outside click
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

  await new Promise((resolve) => setTimeout(resolve, 80));
}

function normalizeFillText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function isMappingSatisfied(mapping: FieldMapping): boolean {
  const element = getElementBySelector(mapping.selector);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) {
    return false;
  }

  const workdayQueries = element instanceof HTMLInputElement
    && element.getAttribute('data-uxi-widget-type') === 'selectinput'
    ? getWorkdaySearchQueries(mapping)
    : null;
  if (workdayQueries) {
    const isSchool = isWorkdaySchoolField(mapping.profileField);
    const container = element.closest<HTMLElement>('[data-automation-id="multiSelectContainer"]') ?? element.parentElement;
    const selectedElements = Array.from(container?.querySelectorAll<HTMLElement>(
      '[data-automation-id="selectedItem"], [data-automation-id*="selectedItem"], [data-automation-id="promptLeafNode"]'
    ) ?? []);
    const elementValue = element.value ? [element.value] : [];
    const candidateTexts = [
      ...selectedElements.map((item) => item.innerText || item.textContent || item.getAttribute('aria-label') || ''),
      ...elementValue,
    ];
    return workdayQueries.every((query) => candidateTexts.some((text) =>
      matchesWorkdayLabel(text, query, isSchool),
    ));
  }

  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    const shouldCheck = /^(?:true|yes|1|on|checked)$/i.test(mapping.value.trim());
    return element.checked === shouldCheck;
  }

  if (element instanceof HTMLSelectElement) {
    const selectedText = element.options[element.selectedIndex]?.textContent ?? '';
    const target = normalizeFillText(mapping.value);
    return normalizeFillText(element.value) === target || normalizeFillText(selectedText) === target;
  }

  const datePart = element instanceof HTMLInputElement
    ? getWorkdayDatePartValue(element, mapping.value)
    : undefined;
  if (datePart === null) return false;
  const targetValue = element instanceof HTMLInputElement
    ? datePart ?? formatDateForInput(element, mapping.value)
    : mapping.value;
  return normalizeFillText(element.value) === normalizeFillText(cleanAnswerText(targetValue));
}

let fillQueue: Promise<void> = Promise.resolve();

export function fillQuestionAnswer(el: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  return withScrollLockSync(() => {
    const cleaned = cleanAnswerText(value);
    if (!cleaned.trim()) return false;
    setNativeValue(el, cleaned);
    dispatchInputEvents(el);
    return el.value === cleaned;
  });
}

/**
 * Fill a <select> element by matching option text or value.
 */
function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const normalizedValue = value.toLowerCase().trim();

  for (const option of el.options) {
    const optText = option.textContent?.toLowerCase().trim() ?? '';
    const optValue = option.value.toLowerCase().trim();

    if (optText === normalizedValue || optValue === normalizedValue) {
      el.value = option.value;
      dispatchInputEvents(el);
      return true;
    }
  }

  // Fuzzy match: check if option text contains the value or vice versa
  for (const option of el.options) {
    const optText = option.textContent?.toLowerCase().trim() ?? '';
    if (optText.includes(normalizedValue) || normalizedValue.includes(optText)) {
      el.value = option.value;
      dispatchInputEvents(el);
      return true;
    }
  }

  return false;
}

function fillCheckbox(el: HTMLInputElement, value: string): boolean {
  const shouldCheck = /^(?:true|yes|1|on|checked)$/i.test(value.trim());
  if (el.checked !== shouldCheck) {
    el.click();
  }
  if (el.checked !== shouldCheck) {
    const parent = el.closest('label') ?? el.parentElement;
    if (parent && parent !== document.body) {
      parent.click();
    }
  }
  if (el.checked !== shouldCheck) {
    const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    if (checkedSetter) {
      checkedSetter.call(el, shouldCheck);
    } else {
      el.checked = shouldCheck;
    }
    dispatchInputEvents(el, true);
  }
  return el.checked === shouldCheck;
}

// ============================================================
// Visual FX — injected directly into the page DOM
// ============================================================

/** Inject shared keyframes once per page load */
function ensureStyles() {
  if (document.getElementById('jf-fill-styles')) return;
  const s = document.createElement('style');
  s.id = 'jf-fill-styles';
  s.textContent = `
    @keyframes jf-check-pop {
      0%   { transform: translate(-50%,-50%) scale(0)    rotate(-20deg); opacity: 0; }
      60%  { transform: translate(-50%,-50%) scale(1.3)  rotate(6deg);   opacity: 1; }
      100% { transform: translate(-50%,-50%) scale(1)    rotate(0deg);   opacity: 1; }
    }
    @keyframes jf-check-fade {
      0%   { opacity: 1; transform: translate(-50%,-50%) translateY(0)    scale(1);   }
      100% { opacity: 0; transform: translate(-50%,-50%) translateY(-18px) scale(.85); }
    }
    @keyframes jf-particle {
      0%   { opacity: 1; transform: translate(0, 0) scale(1); }
      100% { opacity: 0; transform: translate(var(--jf-tx), var(--jf-ty)) scale(0); }
    }
    @keyframes jf-glow-in {
      0%   { outline-color: #00d4ff; box-shadow: 0 0 0   0   #00d4ff44, 0 0  0   0   #00ff8744; }
      35%  { outline-color: #00d4ff; box-shadow: 0 0 0   5px #00d4ff60, 0 0 18px 2px #00ff8730; }
      100% { outline-color: #00d4ff88; box-shadow: 0 0 0 0   #00d4ff00, 0 0  0   0   #00ff8700; }
    }
    @keyframes jf-page-flash {
      0%   { opacity: 0; }
      12%  { opacity: 1; }
      88%  { opacity: 1; }
      100% { opacity: 0; }
    }
    @keyframes jf-border-pulse {
      0%,100% { opacity: 0; }
      40%     { opacity: 1; }
    }
  `;
  document.head.appendChild(s);
}

/** Particle burst — tiny dots scatter from field centre */
function burstParticles(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2 + window.scrollX;
  const cy = rect.top + rect.height / 2 + window.scrollY;
  const colors = ['#00d4ff', '#00ff87', '#ffb300', '#ffffff', '#00d4ff', '#00ff87'];
  const COUNT = 12;

  for (let i = 0; i < COUNT; i++) {
    const angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = 24 + Math.random() * 40;
    const color = colors[i % colors.length];
    const size = 2.5 + Math.random() * 3.5;
    const dur = 300 + Math.random() * 250;

    const dot = document.createElement('div');
    dot.style.cssText = `
      position: absolute;
      left: ${cx}px;
      top: ${cy}px;
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${color};
      box-shadow: 0 0 6px ${color};
      pointer-events: none;
      z-index: 2147483646;
      --jf-tx: ${Math.cos(angle) * dist}px;
      --jf-ty: ${Math.sin(angle) * dist}px;
      animation: jf-particle ${dur}ms cubic-bezier(.2,.8,.3,1) forwards;
    `;
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), dur + 50);
  }
}



/** Floating ✓ badge that pops then drifts up and fades */
function checkBadge(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const badge = document.createElement('div');
  badge.textContent = '✓';
  badge.style.cssText = `
    position: absolute;
    left: ${rect.right - 14 + window.scrollX}px;
    top:  ${rect.top + rect.height / 2 + window.scrollY}px;
    transform: translate(-50%,-50%);
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: linear-gradient(135deg, #00d4ff, #00ff87);
    color: #04080f;
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 2147483647;
    box-shadow: 0 0 12px #00d4ffaa, 0 2px 8px rgba(0,0,0,.35);
    animation: jf-check-pop 380ms cubic-bezier(.34,1.56,.64,1) forwards;
  `;
  document.body.appendChild(badge);
  setTimeout(() => {
    badge.style.animation = 'jf-check-fade 550ms ease-out forwards';
    setTimeout(() => badge.remove(), 600);
  }, 400);
}

/** Neon glow outline on the field — uses an overlay to avoid touching the input's styles */
function glowField(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const rect = el.getBoundingClientRect();
  const glow = document.createElement('div');
  glow.style.cssText = `
    position: absolute;
    left: ${rect.left + window.scrollX}px;
    top:  ${rect.top + window.scrollY}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border-radius: ${getComputedStyle(el).borderRadius || '4px'};
    pointer-events: none;
    z-index: 2147483645;
    outline: 2px solid #00d4ff;
    outline-offset: -2px;
    animation: jf-glow-in 1.3s cubic-bezier(.4,0,.2,1) forwards;
  `;
  document.body.appendChild(glow);
  setTimeout(() => glow.remove(), 2800);
}

/**
 * Full-page holographic sweep + neon border flash.
 * Fires once after all fields have been filled.
 */
function pageCompleteFlash() {
  // Diagonal light-beam overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483645;
    background: linear-gradient(
      108deg,
      transparent 0%,
      transparent 28%,
      rgba(0,212,255,0.06) 40%,
      rgba(0,255,135,0.10) 50%,
      rgba(0,212,255,0.06) 60%,
      transparent 72%,
      transparent 100%
    );
    animation: jf-page-flash 850ms cubic-bezier(.4,0,.2,1) forwards;
  `;
  document.body.appendChild(overlay);

  // Neon border on the whole viewport
  const border = document.createElement('div');
  border.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483645;
    border: 2px solid rgba(0,212,255,0.45);
    box-shadow: inset 0 0 40px rgba(0,212,255,0.08);
    border-radius: 0;
    animation: jf-border-pulse 850ms ease-out forwards;
  `;
  document.body.appendChild(border);

  setTimeout(() => { overlay.remove(); border.remove(); }, 900);
}

// ============================================================
// Main fill function
// ============================================================

/**
 * Fill all mapped fields on the page with cascading visual FX.
 */
async function fillFieldsPass(mappings: FieldMapping[]): Promise<AutofillResult> {
  ensureStyles();

  const results: AutofillFieldResult[] = [];
  let errorCount = 0;
  let skippedExistingCount = 0;

  // ---- Pre-scan: resolve selectors to elements ----
  type FillItem = {
    el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    mapping: FieldMapping;
    workdayAutocomplete: boolean;
  };
  const toFill: FillItem[] = [];

  for (const mapping of mappings) {
    try {
      const el = getElementBySelector(mapping.selector);
      if (!el) {
        results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: 'Element not found' });
        errorCount++;
        continue;
      }

      if (isMappingSatisfied(mapping)) {
        results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'skipped_existing' });
        skippedExistingCount++;
        continue;
      }

      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        const workdayQueries = el instanceof HTMLInputElement
          && el.getAttribute('data-uxi-widget-type') === 'selectinput'
          ? getWorkdaySearchQueries(mapping)
          : null;
        toFill.push({ el, mapping, workdayAutocomplete: workdayQueries !== null });
      }
    } catch (err) {
      results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      errorCount++;
    }
  }

  // ---- Phase 1 (sync, ~0ms): Write ALL values instantly ----
  // No timeouts — React/Angular/Vue validators cannot clear values mid-cascade
  // because blur is intentionally skipped here.
  const filled: FillItem[] = [];

  for (const item of toFill) {
    const { el, mapping } = item;
    try {
      let ok = false;

      if (item.workdayAutocomplete && el instanceof HTMLInputElement) {
        const queries = getWorkdaySearchQueries(mapping) ?? [];
        let failedQuery: string | undefined;
        ok = queries.length > 0;
        for (const query of queries) {
          if (await fillWorkdayMultiSelect(mapping.selector, query, isWorkdaySchoolField(mapping.profileField))) continue;
          failedQuery = query;
          ok = false;
          break;
        }
        await closeWorkdayMultiSelect(mapping.selector);
        if (!ok) {
          results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: `No exact Workday suggestion found for "${failedQuery ?? mapping.value}"` });
          errorCount++;
          continue;
        }
      } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
        ok = fillCheckbox(el, mapping.value);
        if (!ok) {
          results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: `Could not toggle checkbox for "${mapping.profileField}"` });
          errorCount++;
          continue;
        }
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const workdayDateValue = el instanceof HTMLInputElement
          ? getWorkdayDatePartValue(el, mapping.value)
          : undefined;
        if (workdayDateValue === null) {
          results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: `Unsupported date format: "${mapping.value}"` });
          errorCount++;
          continue;
        }
        const value = el instanceof HTMLInputElement
          ? workdayDateValue ?? formatDateForInput(el, mapping.value)
          : mapping.value;
        setNativeValue(el, value);
        dispatchInputEvents(el, true /* skipBlur */);
        ok = true;
      } else if (el instanceof HTMLSelectElement) {
        ok = fillSelect(el, mapping.value);
        if (!ok) {
          results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: `No matching option for "${mapping.value}"` });
          errorCount++;
        }
      }

      if (ok) {
        filled.push(item);
        results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'filled' });
      }
    } catch (err) {
      results.push({ selector: mapping.selector, profileField: mapping.profileField, status: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      errorCount++;
    }
  }

  const filledCount = filled.length;
  const ANIM_STAGGER = 60;

  // ---- Phase 1.5: Re-scan after select/dropdown changes ----
  // When selects (Country, State, Phone Type, etc.) are filled, the form may
  // dynamically add/remove fields or swap dropdown options.
  // Examples:
  //   - Country → US to India: adds "Local Given Name", "Local Family Name"
  //   - Country → India: State dropdown gets Indian states (Karnataka matches)
  // Strategy: wait for React re-render, re-scan, fill newly-appeared fields.
  const filledSelects = filled.filter(({ el }) => el instanceof HTMLSelectElement);

  if (filledSelects.length > 0) {
    // Build profileField → value lookup from ALL original mappings
    // so we can resolve values for newly-discovered fields
    const valueByProfile: Record<string, string> = {};
    for (const mapping of mappings) {
      if (mapping.profileField && mapping.value) {
        valueByProfile[mapping.profileField] = mapping.value;
      }
    }

    const originalSelectors = new Set(mappings.map((m) => m.selector));

    await new Promise((resolve) => setTimeout(resolve, 800));
    {
      const newFilled: FillItem[] = [];

      // --- Pass A: Retry ORIGINAL selects that failed in Phase 1 ---
      // Their options may have changed (e.g., State dropdown switched from
      // US states to Indian states after Country changed to India).
      for (const mapping of mappings) {
        const el = getElementBySelector(mapping.selector);
        if (!el || !(el instanceof HTMLSelectElement)) continue;
        // Skip if value already matches — it was filled successfully
        const currentText = el.options[el.selectedIndex]?.textContent?.trim().toLowerCase() ?? '';
        const targetLower = mapping.value.toLowerCase().trim();
        if (currentText === targetLower || currentText.includes(targetLower) || targetLower.includes(currentText)) continue;
        // Also skip if the raw select value already matches
        if (el.value.toLowerCase().trim() === targetLower) continue;

        // Re-try filling with the (potentially updated) options
        try {
          const ok = fillSelect(el, mapping.value);
          if (ok) {
            newFilled.push({ el, mapping, workdayAutocomplete: false });
            console.log(`[Personal Copilot] Re-scan: retried select "${mapping.selector}" → "${mapping.value}" ✓`);
          }
        } catch (err) {
          console.warn('[Personal Copilot] Re-scan retry failed:', mapping.selector, err);
        }
      }

      // --- Pass B: Fill BRAND NEW fields that weren't in the original scan ---
      const freshFields = scanPageFields();

      for (const field of freshFields) {
        // Skip fields already in the original mapping
        if (originalSelectors.has(field.selector)) continue;
        // Only fill regex-matched fields (SAFE_AUTO)
        if (field.category !== 'SAFE_AUTO' || !field.profileField) continue;
        // Resolve value from the profile lookup
        const value = valueByProfile[field.profileField];
        if (!value) continue;

        const el = getElementBySelector(field.selector);
        if (!el) continue;
        if (
          !(el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement)
        ) continue;

        // Fill the new field
        try {
          let ok = false;
          const newMapping: FieldMapping = {
            selector: field.selector,
            profileField: field.profileField,
            value,
            confidence: field.confidence,
          };

          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            setNativeValue(el, value);
            dispatchInputEvents(el, true /* skipBlur */);
            ok = true;
          } else if (el instanceof HTMLSelectElement) {
            ok = fillSelect(el, value);
          }

          if (ok) {
            newFilled.push({ el, mapping: newMapping, workdayAutocomplete: false });
            // Also add to the main filled array for Phase 4 reinforcement
            filled.push({ el, mapping: newMapping, workdayAutocomplete: false });
          }
        } catch (err) {
          console.warn('[Personal Copilot] Re-scan fill failed:', field.selector, err);
        }
      }

      // Animate newly-filled fields — use rAF so browser completes
      // layout after the fills before we measure positions
      if (newFilled.length > 0) {
        console.log(`[Personal Copilot] Re-scan after select changes: filled ${newFilled.length} new fields`);
        newFilled.forEach(({ el }, idx) => {
          setTimeout(() => {
            requestAnimationFrame(() => {
              glowField(el);
              checkBadge(el as HTMLElement);
              burstParticles(el as HTMLElement);
            });
          }, idx * ANIM_STAGGER);
        });
      }
    }
  }

  // ---- Phase 2 (async, visual only): Stagger animations at 60ms ----
  // Data is already in the DOM — this is pure eye candy.
  // IMPORTANT: When selects (Country, etc.) were filled in Phase 1, React may
  // re-render the form ~200ms later — adding/removing fields and shifting
  // positions. We delay Phase 2 by 400ms in that case so getBoundingClientRect()
  // measures FINAL positions, not pre-re-render ones.
  const PHASE2_DELAY = filledSelects.length > 0 ? 400 : 0;

  filled.forEach(({ el }, idx) => {
    setTimeout(() => {
      requestAnimationFrame(() => {
        glowField(el);
        checkBadge(el as HTMLElement);
        burstParticles(el as HTMLElement);
      });
    }, PHASE2_DELAY + idx * ANIM_STAGGER);
  });

  // ---- Phase 3: Page sweep after last animation ----
  // NOTE: We intentionally do NOT dispatch blur on text inputs.
  // Adobe/Workday React forms re-sync DOM from React state on blur — if their
  // onBlur validator runs before React has fully committed the value, it
  // overwrites the field with an empty string. The `input`+`change` events
  // fired in Phase 1 are sufficient to update React state. Blur is skipped.
  const lastAnimEnd = filledCount > 0 ? PHASE2_DELAY + (filledCount - 1) * ANIM_STAGGER + 80 : 0;

  setTimeout(() => {
    if (filledCount > 0) pageCompleteFlash();
  }, lastAnimEnd);

  // Return only after DOM fills and the select-dependent rescan have completed.
  return {
    totalFields: mappings.length,
    filledFields: filledCount,
    skippedSensitive: 0,
    skippedUnknown: 0,
    skippedExisting: skippedExistingCount,
    errors: errorCount,
    fields: results,
  };
}

async function fillAndRetryMissing(mappings: FieldMapping[]): Promise<AutofillResult> {
  const firstPass = await fillFieldsPass(mappings);
  if (mappings.length === 0) return firstPass;

  await new Promise((resolve) => setTimeout(resolve, 500));
  const missingMappings = mappings.filter((mapping) => !isMappingSatisfied(mapping));
  if (missingMappings.length === 0) return firstPass;

  console.info(`[JobFill] Resweep: retrying ${missingMappings.length} of ${mappings.length} fields still missing after fill`);
  const retryPass = await fillFieldsPass(missingMappings);
  const fieldsBySelector = new Map(firstPass.fields.map((field) => [field.selector, field]));
  for (const field of retryPass.fields) fieldsBySelector.set(field.selector, field);
  const fields = Array.from(fieldsBySelector.values());

  return {
    ...firstPass,
    totalFields: mappings.length,
    filledFields: fields.filter((field) => field.status === 'filled').length,
    skippedExisting: fields.filter((field) => field.status === 'skipped_existing').length,
    errors: fields.filter((field) => field.status === 'error').length,
    fields,
  };
}

export function fillFields(mappings: FieldMapping[]): Promise<AutofillResult> {
  const operation = fillQueue.then(() => withScrollLock(() => fillAndRetryMissing(mappings)));
  fillQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

