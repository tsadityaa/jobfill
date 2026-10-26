import { getElementBySelector, getLabelText, getUniqueSelector, queryAcrossOpenShadowRoots } from './fieldDetector';
import type { DropdownControl, DropdownDecision, DropdownOption } from '../types/dropdown';
import { safeClick, withScrollLock } from './scrollLock';

const DROPDOWN_APPLY_SETTLE_MS = 250;

function isRendered(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function getDropdownContainer(element: HTMLElement): HTMLElement | null {
  return element.closest<HTMLElement>(
    '.select-shell, .select__container, .field-wrapper, [data-automation-id^="formField-"]',
  ) ?? element.closest<HTMLElement>('[class*="-container"]') ?? element.parentElement;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function dropdownShowsValue(element: HTMLElement, container: HTMLElement | null, label: string): boolean {
  const expected = normalizeText(label).toLocaleLowerCase();
  const triggerText = normalizeText(element.textContent).toLocaleLowerCase();
  const inputValue = element instanceof HTMLInputElement ? normalizeText(element.value).toLocaleLowerCase() : '';
  const selectedValue = normalizeText(container?.querySelector<HTMLElement>(
    '.select__single-value, .iti__selected-country, [aria-selected="true"]',
  )?.textContent).toLocaleLowerCase();
  const expectedDialCode = expected.match(/(?:^|\s)(\+\d{1,4})$/)?.[1];
  const selectedDialCode = selectedValue.match(/^\+\d{1,4}$/)?.[0];
  return triggerText === expected
    || inputValue === expected
    || selectedValue === expected
    || Boolean(expectedDialCode && selectedDialCode === expectedDialCode);
}

async function waitForDropdownValue(
  element: HTMLElement,
  container: HTMLElement | null,
  label: string,
  timeoutMs = 1800,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dropdownShowsValue(element, container, label)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return dropdownShowsValue(element, container, label);
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function isDropdownPlaceholder(label: string): boolean {
  return /^(?:choose(?: one)?|select(?: one)?|please select|select\.\.\.|no items(?: available)?|no results(?: found)?|loading(?:\.\.\.)?|--|\s*)$/i.test(normalizeText(label));
}

function makeDropdownControlId(kind: DropdownControl['kind'], question: string, options: DropdownOption[], selector: string): string {
  const signature = JSON.stringify({
    kind,
    selector,
    question: normalizeText(question).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    options: options.map((option) => [normalizeText(option.label).toLowerCase(), option.value, option.disabled]),
  });
  return `dropdown_${kind}_${hash(signature)}`;
}

function simulateFullClick(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const shared: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: cx,
    clientY: cy,
    button: 0,
    buttons: 1,
  };

  element.dispatchEvent(new PointerEvent('pointerdown', { ...shared, pointerId: 1, pointerType: 'mouse' }));
  element.dispatchEvent(new MouseEvent('mousedown', shared));
  element.dispatchEvent(new PointerEvent('pointerup', { ...shared, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...shared, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('click', { ...shared, buttons: 0 }));
}

interface PageScrollSnapshot {
  x: number;
  y: number;
  ancestors: Array<{ element: HTMLElement; left: number; top: number }>;
}

function capturePageScroll(element: HTMLElement): PageScrollSnapshot {
  const ancestors: PageScrollSnapshot['ancestors'] = [];
  let parent = element.parentElement;

  while (parent && parent !== document.documentElement) {
    const style = getComputedStyle(parent);
    const canScroll = /(auto|scroll|overlay)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`);
    if (canScroll && (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth)) {
      ancestors.push({ element: parent, left: parent.scrollLeft, top: parent.scrollTop });
    }
    parent = parent.parentElement;
  }

  return { x: window.scrollX, y: window.scrollY, ancestors };
}

function restorePageScroll(snapshot: PageScrollSnapshot): void {
  for (const position of snapshot.ancestors) {
    if (position.element !== document.documentElement && position.element !== document.body) {
      position.element.scrollLeft = position.left;
      position.element.scrollTop = position.top;
    }
  }
  // DO NOT call window.scrollTo: user manual scrolling should never be reverted
}

async function preservePageScroll<T>(element: HTMLElement, action: () => Promise<T>): Promise<T> {
  return withScrollLock(async () => {
    const snapshot = capturePageScroll(element);
    try {
      return await action();
    } finally {
      restorePageScroll(snapshot);
    }
  });
}

function questionForDropdown(element: HTMLElement, container?: HTMLElement | null): string {
  const root = container?.getRootNode() ?? element.getRootNode();
  const queryRoot = root instanceof ShadowRoot ? root : document;

  const getElementByIdSafe = (id: string): HTMLElement | null => {
    if (!id) return null;
    if ('getElementById' in queryRoot && typeof (queryRoot as Document).getElementById === 'function') {
      return (queryRoot as Document).getElementById(id);
    }
    return queryRoot.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  };

  // 1. Associated <label for="...">
  if (element.id) {
    const forLabel = queryRoot.querySelector<HTMLElement>(`label[for="${CSS.escape(element.id)}"]`);
    if (forLabel) {
      const clone = forLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input, select, svg').forEach((n) => n.remove());
      const text = normalizeText(clone.textContent);
      if (text) return text;
    }
  }

  // 2. ARIA labelledby
  const labelledBy = element.getAttribute('aria-labelledby') ?? container?.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelledText = labelledBy
      .split(/\s+/)
      .map((id) => getElementByIdSafe(id)?.textContent ?? '')
      .filter(Boolean)
      .join(' ');
    if (labelledText) return normalizeText(labelledText);
  }

  // 3. Parent wrapper label (Greenhouse .select__container > label, .field-wrapper > label)
  const wrapper = container ?? element.closest<HTMLElement>('.select__container, .field-wrapper, .select-shell, [class*="select"]');
  if (wrapper) {
    const wrapperLabel = wrapper.querySelector<HTMLElement>('label, .select__label, [class*="select__label"]');
    if (wrapperLabel && !wrapperLabel.contains(element)) {
      const clone = wrapperLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input, select, svg').forEach((n) => n.remove());
      const text = normalizeText(clone.textContent);
      if (text && text.length < 300) return text;
    }
  }

  // 4. Wrapping <label>
  const parentLabel = element.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('select, input, [role="listbox"], svg').forEach((n) => n.remove());
    const text = normalizeText(clone.textContent);
    if (text) return text;
  }

  const fieldsetLegend = element.closest('fieldset')?.querySelector<HTMLElement>('legend');
  const legendQuestion = normalizeText(fieldsetLegend?.textContent);
  if (legendQuestion) return legendQuestion;

  // Workday exposes its prompt as the accessible name of the question group,
  // while the dropdown button itself is labelled only "Select One Required".
  const questionGroup = element.closest<HTMLElement>('[role="group"]');
  const groupQuestion = normalizeText(questionGroup?.getAttribute('aria-label'));
  if (groupQuestion) return groupQuestion;

  // 6. Google Forms card (.Qr7Oae or [jsmodel="CP1oW"] or [role="listitem"])
  const card = container ?? element.closest<HTMLElement>('.Qr7Oae, [jsmodel="CP1oW"], [role="listitem"]');
  if (card) {
    const heading = card.querySelector<HTMLElement>('[role="heading"], .M7eMe, h1, h2, h3, h4');
    if (heading) {
      const text = normalizeText(heading.textContent);
      if (text) return text;
    }
  }

  // 7. Generic container headings (form group, field, legend)
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const heading = parent.querySelector<HTMLElement>(
      ':scope > [role="heading"], [data-automation-id*="Label"], [data-automation-id*="label"], .application-label, .field-label, legend, h1, h2, h3, h4',
    );
    if (heading && !heading.contains(element)) {
      const text = normalizeText(heading.textContent);
      if (text && text.length < 300) return text;
    }
    parent = parent.parentElement;
  }

  // Trigger labels like "Select One Required" are less informative than the
  // surrounding prompt and should only be used when no question label exists.
  const ariaLabel = element.getAttribute('aria-label') ?? container?.getAttribute('aria-label');
  if (ariaLabel) {
    const question = normalizeText(ariaLabel.replace(/\s+(?:select one|required)\b/gi, ' '));
    if (question && !isDropdownPlaceholder(question)) return question;
  }

  return normalizeText(getLabelText(element)) || normalizeText(element.getAttribute('name')) || element.id || '';
}

/**
 * Scan native <select> elements across the DOM and shadow roots.
 */
function scanNativeSelects(): DropdownControl[] {
  const selects = queryAcrossOpenShadowRoots<HTMLSelectElement>('select').filter(isRendered);
  const controls: DropdownControl[] = [];

  for (const select of selects) {
    const selector = getUniqueSelector(select);
    const question = questionForDropdown(select);
    const options: DropdownOption[] = Array.from(select.options).map((opt, index) => {
      const label = normalizeText(opt.textContent) || normalizeText(opt.label) || opt.value;
      return {
        index,
        label,
        value: opt.value,
        disabled: opt.disabled,
        selected: opt.selected,
        selector: `${selector} option:nth-child(${index + 1})`,
      };
    });

    if (!options.length) continue;

    controls.push({
      id: makeDropdownControlId('select', question, options, selector),
      kind: 'select',
      selector,
      question,
      options,
    });
  }

  return controls;
}

/**
 * Scan Google Forms custom dropdown listboxes.
 */
function scanGoogleFormsDropdowns(): DropdownControl[] {
  const listboxes = queryAcrossOpenShadowRoots<HTMLElement>('[role="listbox"]').filter(isRendered);
  const controls: DropdownControl[] = [];

  for (const listbox of listboxes) {
    const card = listbox.closest<HTMLElement>('.Qr7Oae, [jsmodel="CP1oW"], [role="listitem"]');
    if (!card) continue;

    const selector = getUniqueSelector(listbox);
    const question = questionForDropdown(listbox, card);

    const optionElements = Array.from(card.querySelectorAll<HTMLElement>('[role="option"]'));
    if (!optionElements.length) continue;

    const options: DropdownOption[] = optionElements.map((opt, index) => {
      const textEl = opt.querySelector<HTMLElement>('.vRMGwf, span') ?? opt;
      const label = normalizeText(textEl.textContent) || normalizeText(opt.getAttribute('data-value')) || '';
      const value = opt.getAttribute('data-value') || label;
      const disabled = opt.getAttribute('aria-disabled') === 'true';
      const selected = opt.getAttribute('aria-selected') === 'true';

      return {
        index,
        label,
        value,
        disabled,
        selected,
        selector: getUniqueSelector(opt),
      };
    });

    if (!options.length) continue;

    controls.push({
      id: makeDropdownControlId('google-forms', question, options, selector),
      kind: 'google-forms',
      selector,
      question,
      options,
    });
  }

  return controls;
}

/**
 * Read React Select's live option metadata from the field's component props.
 * This is the most reliable option source for Greenhouse custom comboboxes because
 * the menu is not mounted in the field DOM until the user opens it, and a global
 * country listbox can otherwise pollute the scan.
 */
function readReactSelectOptionsFromProps(node: HTMLElement): DropdownOption[] {
  const seen = new Set<object>();
  const queue: unknown[] = [node];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    const props = Object.getOwnPropertyNames(current as object)
      .filter((key) => key.startsWith('__reactProps'))
      .map((key) => (current as Record<string, unknown>)[key])
      .find((value) => value && typeof value === 'object');

    if (props && typeof props === 'object' && 'options' in props && Array.isArray((props as { options?: unknown[] }).options)) {
      const options = (props as { options: Array<{ label?: string | number; value?: string | number; disabled?: boolean; isDisabled?: boolean; isSelected?: boolean }> }).options;
      return options.map((option, index) => ({
        index,
        label: normalizeText(String(option?.label ?? '')) || normalizeText(String(option?.value ?? '')) || `Option ${index + 1}`,
        value: String(option?.value ?? option?.label ?? ''),
        disabled: Boolean(option?.disabled ?? option?.isDisabled),
        selected: Boolean(option?.isSelected),
      })).filter((option) => option.label.length > 0 && !isDropdownPlaceholder(option.label));
    }

    const children = 'children' in (current as Record<string, unknown>)
      ? (current as { children?: unknown[] }).children
      : undefined;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === 'object') queue.push(child);
      }
    }

    for (const value of Object.values(current as Record<string, unknown>)) {
      if (value && typeof value === 'object' && !('nodeType' in (value as object))) {
        queue.push(value);
      }
    }
  }

  return [];
}

/**
 * Find options strictly scoped to a specific combobox/React-Select instance.
 * NEVER does global document searches without scoping to avoid cross-field pollution.
 */
function findScopedOptions(container: HTMLElement, reactSelectId: string): DropdownOption[] {
  const triggerSelector = 'input[role="combobox"], input.select__input, input[data-uxi-widget-type="selectinput"], [aria-haspopup="listbox"]';
  const trigger = container.matches(triggerSelector)
    ? container
    : container.querySelector<HTMLElement>(triggerSelector);
  const input = trigger instanceof HTMLInputElement
    ? trigger
    : container.querySelector<HTMLInputElement>('input[role="combobox"], input.select__input, input[data-uxi-widget-type="selectinput"]');
  const listboxIds = new Set([
    ...(trigger?.getAttribute('aria-controls') ?? '').split(/\s+/),
    ...(trigger?.getAttribute('aria-owns') ?? '').split(/\s+/),
    ...(input?.getAttribute('aria-controls') ?? '').split(/\s+/),
    ...(input?.getAttribute('aria-owns') ?? '').split(/\s+/),
  ].filter(Boolean));
  if (reactSelectId) listboxIds.add(`${reactSelectId}-listbox`);
  let optionElements: HTMLElement[] = [];

  // Prefer the listbox explicitly associated with this input, including portaled menus.
  for (const listboxId of listboxIds) {
    const listbox = document.getElementById(listboxId);
    if (listbox) {
      optionElements = Array.from(listbox.querySelectorAll<HTMLElement>(
        '[role="option"], .select__option, [class*="-option"], [id*="__item-"]',
      )).filter(isRendered);
      if (optionElements.length) break;
    }
  }

  // Greenhouse's phone country selector uses a portaled iti country listbox.
  if (!optionElements.length && input?.closest('.phone-input__country') && input.getAttribute('aria-expanded') === 'true') {
    const countryListboxes = Array.from(document.querySelectorAll<HTMLElement>('[id$="__country-listbox"]')).filter(isRendered);
    if (countryListboxes.length === 1) {
      optionElements = Array.from(countryListboxes[0].querySelectorAll<HTMLElement>(
        '[role="option"], [id*="__item-"]',
      )).filter(isRendered);
    }
  }

  // Then check options mounted inside the field's own React Select menu.
  if (!optionElements.length) {
    const menu = container.querySelector<HTMLElement>('.select__menu, [class*="-menu"], [role="listbox"]');
    if (menu) {
      optionElements = Array.from(menu.querySelectorAll<HTMLElement>(
        '[role="option"], .select__option, [class*="-option"]',
      )).filter(isRendered);
    }
  }

  // Some React Select menus use ID prefixes even when the listbox has no explicit association.
  if (reactSelectId) {
    if (!optionElements.length) {
      optionElements = Array.from(document.querySelectorAll<HTMLElement>(
        `[id^="${CSS.escape(reactSelectId)}-option-"]`,
      )).filter(isRendered);
    }
  }

  // Legacy custom comboboxes may render options directly in the field container.
  if (!optionElements.length && container) {
    optionElements = Array.from(container.querySelectorAll<HTMLElement>(
      '.select__option, [class*="-option"]',
    )).filter(isRendered);
  }

  const renderedOptions = optionElements.map((opt, index) => {
    const label = normalizeText(opt.textContent);
    return {
      index,
      label,
      value: opt.getAttribute('data-value') || label,
      disabled: opt.getAttribute('aria-disabled') === 'true',
      selected: opt.getAttribute('aria-selected') === 'true',
      selector: getUniqueSelector(opt),
    };
  }).filter((opt) => opt.label.length > 0 && !isDropdownPlaceholder(opt.label));

  // Closed React Select menus expose their complete option set on the component props.
  // These entries are useful for LLM indexing but intentionally have no clickable selector.
  return renderedOptions.length ? renderedOptions : readReactSelectOptionsFromProps(container);
}

/**
 * Safely probe a closed combobox by opening it, reading options strictly scoped to this field, and closing it.
 */
async function probeComboboxOptionsCore(inputEl: HTMLElement, container: HTMLElement): Promise<DropdownOption[]> {
  const inputId = inputEl.id || '';
  const reactSelectId = inputId ? `react-select-${inputId}` : '';

  // 1. Check if options are already mounted in DOM for this specific field
  let options = findScopedOptions(container, reactSelectId);
  if (options.length > 0) return options;

  // 2. Locate the toggle flyout button or control within this container
  const toggleBtn = inputEl instanceof HTMLButtonElement && inputEl.getAttribute('aria-haspopup') === 'listbox'
    ? inputEl
    : container.querySelector<HTMLElement>(
      'button[aria-label*="flyout" i], button[aria-label*="toggle" i], .select__indicators button, .select__control, [class*="-control"]',
    ) ?? inputEl;

  try {
    simulateFullClick(toggleBtn);
    inputEl.focus({ preventScroll: true });

    // Wait 100ms for React to mount the flyout in the DOM
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 3. Find options strictly scoped to this field
    options = findScopedOptions(container, reactSelectId);

    // 4. Close the flyout to restore page state
    simulateFullClick(toggleBtn);
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    inputEl.blur();
    await new Promise((resolve) => setTimeout(resolve, 50));

    return options;
  } catch (err) {
    console.warn(`[JobFill Dropdown] Error probing dropdown for ${inputId}:`, err);
    return [];
  }
}

async function probeComboboxOptions(inputEl: HTMLElement, container: HTMLElement): Promise<DropdownOption[]> {
  return preservePageScroll(inputEl, () => probeComboboxOptionsCore(inputEl, container));
}

/**
 * Fallback for binary / boolean confirmation dropdowns.
 */
function getBooleanFallbackOptions(question: string): DropdownOption[] {
  const isConfirmation = /\b(?:confirm|please\s+confirm|are\s+you|do\s+you|will\s+you|have\s+you|authorized\s+to\s+work|sponsorship|non-compete)\b/i.test(question)
    || /\?$/i.test(question);
  if (isConfirmation) {
    return [
      { index: 0, label: 'Yes', value: 'Yes', disabled: false, selected: false },
      { index: 1, label: 'No', value: 'No', disabled: false, selected: false },
    ];
  }
  return [];
}

/**
 * Scan React-Select, Greenhouse comboboxes, and standard ARIA comboboxes.
 */
async function scanReactSelectAndComboboxDropdowns(existingSelectors: Set<string>): Promise<DropdownControl[]> {
  const controls: DropdownControl[] = [];

  const candidates = queryAcrossOpenShadowRoots<HTMLElement>(
    'input.select__input, input[data-uxi-widget-type="selectinput"], [role="combobox"], [aria-haspopup="listbox"], .select-shell, [class*="-control"][class*="select"]',
  ).filter(isRendered).filter((candidate) => !(
    candidate instanceof HTMLInputElement
    && candidate.matches('input[data-uxi-widget-type="selectinput"]')
    && candidate.closest('[data-automation-id="multiSelectContainer"][data-uxi-widget-type="multiselect"]')
  )).filter((candidate) => !(
    candidate instanceof HTMLButtonElement
    && candidate.getAttribute('aria-haspopup') === 'listbox'
    && !candidate.closest('[role="group"], form, [data-automation-id^="formField-"]')
  ));

  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    const inputEl = (candidate instanceof HTMLInputElement || candidate instanceof HTMLButtonElement
      ? candidate
      : candidate.querySelector<HTMLElement>('input.select__input, input[data-uxi-widget-type="selectinput"], [role="combobox"], [aria-haspopup="listbox"]')) ?? candidate;
    const selector = getUniqueSelector(inputEl);
    if (existingSelectors.has(selector) || seenKeys.has(selector)) continue;
    seenKeys.add(selector);

    const container = getDropdownContainer(inputEl);
    if (!container) continue;

    const reactSelectId = inputEl.id ? `react-select-${inputEl.id}` : '';

    const question = questionForDropdown(inputEl, container);
    if (!question) continue;

    // First prefer the live React Select option metadata attached to this field.
    // This is the reliable source for Greenhouse/React-Select inputs because the flyout
    // often lives outside the field DOM and the global country list can otherwise win.
    let options = findScopedOptions(container, reactSelectId);

    if (!options.length) {
      options = await probeComboboxOptions(inputEl, container);
    }

    // Fallback for boolean confirmation questions
    if (!options.length) {
      options = getBooleanFallbackOptions(question);
    }

    if (!options.length) continue;

    controls.push({
      id: makeDropdownControlId('combobox', question, options, selector),
      kind: 'combobox',
      selector,
      question,
      options,
    });
  }

  return controls;
}

/**
 * Main scan function: detect all dropdowns (native <select>, Google Forms, React-Select / ARIA comboboxes).
 */
async function scanDropdownControlsCore(): Promise<DropdownControl[]> {
  const controls: DropdownControl[] = [];

  // 1. Native <select>
  controls.push(...scanNativeSelects());

  // 2. Google Forms custom dropdowns
  controls.push(...scanGoogleFormsDropdowns());

  // 3. React-Select and ARIA comboboxes
  const existingSelectors = new Set(controls.map((c) => c.selector));
  const comboboxes = await scanReactSelectAndComboboxDropdowns(existingSelectors);
  controls.push(...comboboxes);

  console.info(`[JobFill Dropdown] DOM scan detected ${controls.length} dropdown controls`, controls.map((c) => ({
    id: c.id,
    kind: c.kind,
    question: c.question,
    optionsCount: c.options.length,
    options: c.options.map((o) => o.label).slice(0, 10),
  })));

  return controls;
}

export function scanDropdownControls(): Promise<DropdownControl[]> {
  return preservePageScroll(document.documentElement, scanDropdownControlsCore);
}

/**
 * Apply a single dropdown decision to the DOM.
 */
async function applySingleDropdownCore(decision: DropdownDecision): Promise<boolean> {
  let element = decision.selector ? (getElementBySelector(decision.selector) as HTMLElement | null) : null;
  if (!element) {
    element = queryAcrossOpenShadowRoots<HTMLElement>('select, [role="listbox"], [role="combobox"], input.select__input, input[data-uxi-widget-type="selectinput"], [aria-haspopup="listbox"]').find((el) => {
      const selector = getUniqueSelector(el);
      return selector === decision.selector || decision.controlId.includes(hash(selector));
    }) ?? null;
  }

  if (!element) {
    console.warn(`[JobFill Dropdown] Target element not found for selector "${decision.selector}"`);
    return false;
  }

  // 1. Native select handling
  if (element instanceof HTMLSelectElement) {
    let targetIndex = decision.selectedIndex;
    if (targetIndex < 0 || targetIndex >= element.options.length) {
      targetIndex = Array.from(element.options).findIndex((opt) =>
        normalizeText(opt.textContent).toLowerCase() === decision.selectedLabel.toLowerCase()
        || normalizeText(opt.value).toLowerCase() === decision.selectedLabel.toLowerCase(),
      );
    }

    if (targetIndex >= 0 && targetIndex < element.options.length) {
      const targetOption = element.options[targetIndex];
      element.focus({ preventScroll: true });
      element.selectedIndex = targetIndex;

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(element, targetOption.value);
      } else {
        element.value = targetOption.value;
      }

      for (let i = 0; i < element.options.length; i++) {
        element.options[i].selected = (i === targetIndex);
      }

      element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));

      console.info(`[JobFill Dropdown] Successfully applied native select: "${targetOption.textContent?.trim()}" (index ${targetIndex})`);
      return true;
    }
  }

  // 2. Google Forms custom dropdown listbox
  const isGoogleFormsCard = element.closest<HTMLElement>('.Qr7Oae, [jsmodel="CP1oW"], [role="listitem"]');
  if (isGoogleFormsCard && element.getAttribute('role') === 'listbox') {
    const options = Array.from(isGoogleFormsCard.querySelectorAll<HTMLElement>('[role="option"]'));
    let targetOptionEl = (decision.optionSelector ? (getElementBySelector(decision.optionSelector) as HTMLElement | null) : null)
      ?? options[decision.selectedIndex];

    if (!targetOptionEl || normalizeText(targetOptionEl.textContent).toLowerCase() !== decision.selectedLabel.toLowerCase()) {
      const byLabel = options.find((opt) =>
        normalizeText(opt.querySelector('.vRMGwf, span')?.textContent || opt.getAttribute('data-value') || opt.textContent).toLowerCase() === decision.selectedLabel.toLowerCase(),
      );
      if (byLabel) targetOptionEl = byLabel;
    }

    if (targetOptionEl) {

      simulateFullClick(element);
      await new Promise((resolve) => setTimeout(resolve, 80));

      simulateFullClick(targetOptionEl);
      await new Promise((resolve) => setTimeout(resolve, 60));

      console.info(`[JobFill Dropdown] Successfully applied Google Forms dropdown option: "${decision.selectedLabel}"`);
      return true;
    }
  }

  // 3. React-Select and Custom Comboboxes (Greenhouse, Workday, etc.)
  const isReactSelectOrCombobox =
    element.getAttribute('role') === 'combobox'
    || element.getAttribute('aria-haspopup') === 'listbox'
    || element.classList.contains('select__input')
    || element.getAttribute('data-uxi-widget-type') === 'selectinput'
    || Boolean(element.closest('.select-shell, .select__control, .select__container, [data-automation-id^="formField-"]'));

  if (isReactSelectOrCombobox) {
    const container = element.closest<HTMLElement>('.select-shell, .select__container, .field-wrapper, [class*="-container"], [data-automation-id^="formField-"]') ?? element.parentElement;
    const inputId = element.id || '';
    const reactSelectId = inputId ? `react-select-${inputId}` : '';

    const control = container?.querySelector<HTMLElement>('.select__control, [class*="-control"]')
      ?? element.closest<HTMLElement>('.select__control, [class*="-control"]')
      ?? element;

    if (element instanceof HTMLInputElement) element.focus({ preventScroll: true });

    // Step A: Open the flyout
    const toggleBtn = element.getAttribute('aria-haspopup') === 'listbox'
      ? element
      : container?.querySelector<HTMLElement>(
        'button[aria-label*="flyout" i], button[aria-label*="toggle" i], .select__indicators button, .select__control, [class*="-control"]',
      ) ?? control;
    if (element.getAttribute('aria-haspopup') === 'listbox') {
      if (element.getAttribute('aria-expanded') !== 'true') {
        simulateFullClick(toggleBtn);
      }
    } else {
      simulateFullClick(toggleBtn);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step B: Locate the option in the opened flyout (strictly scoped)
    const optionElements = findScopedOptions(container ?? control, reactSelectId);

    const targetOption = optionElements.find((opt) =>
      normalizeText(opt.label).toLowerCase() === decision.selectedLabel.toLowerCase()
      || normalizeText(opt.value).toLowerCase() === decision.selectedLabel.toLowerCase(),
    );

    // Step C: Click the option
    let selectionAttempted = false;
    if (targetOption?.selector) {
      let optEl: HTMLElement | null;
      if (element.getAttribute('aria-haspopup') === 'listbox') {
        const listboxId = element.getAttribute('aria-controls') ?? element.getAttribute('aria-owns');
        const listbox = listboxId ? document.getElementById(listboxId) : null;
        optEl = Array.from(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? []).find((option) =>
          normalizeText(option.textContent).toLowerCase() === decision.selectedLabel.toLowerCase(),
        ) ?? null;
      } else {
        optEl = getElementBySelector(targetOption.selector) as HTMLElement | null;
      }
      if (optEl) {
        if (element.getAttribute('aria-haspopup') === 'listbox') {
          simulateFullClick(optEl);
          await new Promise((resolve) => setTimeout(resolve, 150));

          if (normalizeText(element.textContent).toLowerCase() !== normalizeText(decision.selectedLabel).toLowerCase()) {
            safeClick(optEl);
            const reactPropsKey = Object.keys(optEl).find((key) => key.startsWith('__reactProps'));
            const reactProps = reactPropsKey
              ? (optEl as HTMLElement & Record<string, unknown>)[reactPropsKey] as { onClick?: (event: { preventDefault: () => void }) => void }
              : undefined;
            reactProps?.onClick?.({ preventDefault() { } });
          }
          if (element.getAttribute('aria-expanded') === 'true') {
            element.focus({ preventScroll: true });
            element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
            element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        } else {
          simulateFullClick(optEl);
        }
        await new Promise((resolve) => setTimeout(resolve, 60));
        selectionAttempted = true;
        console.info(`[JobFill Dropdown] Successfully clicked React-Select option: "${decision.selectedLabel}"`);
      }
    }

    if (!selectionAttempted) {
      // Step D: Fallback keyboard entry
      if (element instanceof HTMLInputElement) {
        element.focus({ preventScroll: true });
        const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputSetter) {
          nativeInputSetter.call(element, decision.selectedLabel);
        } else {
          element.value = decision.selectedLabel;
        }
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        selectionAttempted = true;
        console.info(`[JobFill Dropdown] Typed and confirmed combobox option: "${decision.selectedLabel}"`);
      }
    }

    // Step E: Update hidden required input in the container (e.g. remix-css-...-requiredInput)
    if (container) {
      const hiddenRequired = container.querySelector<HTMLInputElement>(
        'input[tabindex="-1"], input[type="hidden"], .remix-css-1a0ro4n-requiredInput, [class*="-requiredInput"]',
      );
      if (hiddenRequired) {
        hiddenRequired.value = decision.selectedLabel;
        hiddenRequired.dispatchEvent(new Event('input', { bubbles: true }));
        hiddenRequired.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    const selectionVisible = await waitForDropdownValue(element, container, decision.selectedLabel);
    return selectionAttempted && selectionVisible;
  }

  return false;
}

async function applySingleDropdown(decision: DropdownDecision): Promise<boolean> {
  let element = decision.selector ? (getElementBySelector(decision.selector) as HTMLElement | null) : null;
  if (!element) {
    element = queryAcrossOpenShadowRoots<HTMLElement>('select, [role="listbox"], [role="combobox"], input.select__input, input[data-uxi-widget-type="selectinput"], [aria-haspopup="listbox"]').find((el) => {
      const selector = getUniqueSelector(el);
      return selector === decision.selector || decision.controlId.includes(hash(selector));
    }) ?? null;
  }

  if (!element) return applySingleDropdownCore(decision);
  return preservePageScroll(element, () => applySingleDropdownCore(decision));
}

/**
 * Apply dropdown decisions to the DOM.
 */
export async function applyDropdownDecisions(decisions: DropdownDecision[]): Promise<{ applied: string[]; unresolved: string[] }> {
  return withScrollLock(async () => {
    const applied: string[] = [];
    const unresolved: string[] = [];

    for (const decision of decisions) {
      try {
        let ok = await applySingleDropdown(decision);
        if (!ok) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          ok = await applySingleDropdown(decision);
        }
        if (ok) {
          applied.push(decision.controlId);
        } else {
          unresolved.push(decision.controlId);
        }
        await new Promise((resolve) => setTimeout(resolve, DROPDOWN_APPLY_SETTLE_MS));
      } catch (err) {
        console.warn(`[JobFill Dropdown] Failed to apply decision for ${decision.controlId}:`, err);
        unresolved.push(decision.controlId);
        await new Promise((resolve) => setTimeout(resolve, DROPDOWN_APPLY_SETTLE_MS));
      }
    }

    console.info('[JobFill Dropdown] Apply results:', { applied: applied.length, unresolved: unresolved.length });
    return { applied, unresolved };
  });
}
