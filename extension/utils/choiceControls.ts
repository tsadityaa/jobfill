import { getElementBySelector, getLabelText, getUniqueSelector, queryAcrossOpenShadowRoots } from './fieldDetector';
import type { ChoiceControl, ChoiceDecision, ChoiceFormAnswer, ChoiceOption } from '../types/choice';

const GROUP_SELECTOR = 'fieldset, [role="radiogroup"], [role="group"]';

function isRendered(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function isWithinForm(element: HTMLElement): boolean {
  let current: Element | null = element;
  while (current) {
    if (current instanceof HTMLFormElement) return true;
    if (current.parentElement) {
      current = current.parentElement;
    } else {
      const root = current.getRootNode();
      current = root instanceof ShadowRoot ? root.host : null;
    }
  }
  return false;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function makeControlId(kind: ChoiceControl['kind'], question: string, options: ChoiceOption[], selector: string): string {
  const signature = JSON.stringify({
    kind,
    selector,
    question: normalizeText(question).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
    options: options.map((option) => [normalizeText(option.label).toLowerCase(), option.value, option.disabled]),
  });
  return `choice_${kind}_${hash(signature)}`;
}

function makeOptionId(index: number, label: string, value: string): string {
  return `option_${index}_${hash(`${label}\u0000${value}`)}`;
}

function labelForOption(element: HTMLElement): string {
  const directLabel = normalizeText(
    element.getAttribute('aria-label')
    || element.getAttribute('data-label'),
  );
  if (directLabel) return directLabel;

  // For native <input type="radio/checkbox">, the visible label text lives in
  // an associated <label> element or a sibling — NOT in the input's value
  // attribute. Try getLabelText() first (reads <label for="...">, wrapping
  // <label>, aria-labelledby, preceding siblings, etc.).
  if (element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox')) {
    const associatedLabel = normalizeText(getLabelText(element));
    if (associatedLabel) return associatedLabel;
    // Fall back to value only if no visible label was found
    const val = normalizeText(element.value);
    if (val) return val;
    return '';
  }

  // Google Forms nests the label text inside a span/div child alongside the
  // radio circle. Walk children to find the best text-bearing node, avoiding
  // picking up an empty circle or icon container.
  if (element.getAttribute('role') === 'radio' || element.getAttribute('role') === 'checkbox') {
    const labelSpan = element.querySelector('[dir="auto"], [data-value], span');
    if (labelSpan) {
      const spanText = normalizeText(labelSpan.textContent);
      if (spanText) return spanText;
    }
  }

  const textContent = normalizeText(element.textContent);
  if (textContent) return textContent;

  return normalizeText(getLabelText(element)) || normalizeText((element as HTMLInputElement).value) || '';
}

function questionFor(element: HTMLElement, group?: HTMLElement | null): string {
  const legend = group?.querySelector('legend');
  const labelledBy = group?.getAttribute('aria-labelledby') ?? element.getAttribute('aria-labelledby');
  const describedBy = group?.getAttribute('aria-describedby') ?? element.getAttribute('aria-describedby');
  const root = group?.getRootNode() ?? element.getRootNode();
  const queryRoot = root instanceof ShadowRoot ? root : document;
  const labelledText = labelledBy
    ?.split(/\s+/)
    .map((id) => queryRoot.getElementById(id)?.textContent ?? '')
    .join(' ');
  const helpText = describedBy
    ?.split(/\s+/)
    .map((id) => queryRoot.getElementById(id)?.textContent ?? '')
    .join(' ');
  const groupLabel = normalizeText(
    legend?.textContent
    || group?.getAttribute('aria-label')
    || labelledText,
  );

  // Google Forms: walk up to the question card ([role="listitem"]) and grab
  // the heading text if no label/legend was found via standard ARIA attributes.
  let cardHeading = '';
  if (!groupLabel) {
    const anchor = group ?? element;
    const card = anchor.closest<HTMLElement>('[role="listitem"]');
    if (card) {
      const heading = card.querySelector<HTMLElement>('[role="heading"], h1, h2, h3, h4');
      if (heading) cardHeading = normalizeText(heading.textContent);
    }
  }

  const questionLabel = groupLabel || cardHeading;
  const isGroupOption = element.getAttribute('role') === 'radio'
    || element.getAttribute('role') === 'checkbox'
    || element instanceof HTMLInputElement && ['radio', 'checkbox'].includes(element.type);
  const isStandaloneCheckbox = element instanceof HTMLInputElement
    && element.type === 'checkbox'
    && !group;
  const ownLabel = isGroupOption && !isStandaloneCheckbox ? '' : normalizeText(
    getLabelText(element)
    || element.getAttribute('aria-label')
    || element.getAttribute('placeholder')
    || element.getAttribute('name')
    || element.id,
  );
  return normalizeText([questionLabel, ownLabel, helpText].filter(Boolean).join(' '));
}

function makeOption(
  index: number,
  label: string,
  value: string,
  disabled: boolean,
  selected: boolean,
  selector?: string,
): ChoiceOption {
  return { id: makeOptionId(index, label, value), label, value, disabled, selected, selector };
}

function getGroupedInputControls(): ChoiceControl[] {
  const hasForms = queryAcrossOpenShadowRoots<HTMLFormElement>('form').length > 0;
  const inputs = queryAcrossOpenShadowRoots<HTMLElement>(
    'input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]',
  ).filter(isRendered).filter((input) =>
    !hasForms || isWithinForm(input) || Boolean(input.closest('.form-group.field')),
  );
  const groups = new Map<string, { root: HTMLElement | null; kind: 'radio' | 'checkbox'; inputs: HTMLElement[] }>();

  for (const input of inputs) {
    const kind = input.getAttribute('type') === 'radio' || input.getAttribute('role') === 'radio' ? 'radio' : 'checkbox';
    const name = input.getAttribute('name');
    const explicitRoleGroup = input.closest<HTMLElement>('[role="radiogroup"], [role="group"]');
    const root = kind === 'checkbox' && !name
      ? explicitRoleGroup
      : input.closest<HTMLElement>(`${GROUP_SELECTOR}, .form-group.field`);
    const scope = root
      ? getUniqueSelector(root)
      : name
        ? `${input.closest('form') ? getUniqueSelector(input.closest('form')!) : 'document'}::${name}`
        : getUniqueSelector(input);
    const key = `${kind}::${scope}${name && root ? `::${name}` : ''}`;
    const group = groups.get(key) ?? { root, kind, inputs: [] };
    group.inputs.push(input);
    groups.set(key, group);
  }

  return Array.from(groups.values()).flatMap(({ root, kind, inputs: members }) => {
    const selector = getUniqueSelector(members[0]);
    const question = questionFor(members[0], root);
    const options = members.map((input, index) => {
      const checked = input instanceof HTMLInputElement
        ? input.checked
        : input.getAttribute('aria-checked') === 'true';
      const disabled = input instanceof HTMLInputElement
        ? input.disabled
        : input.getAttribute('aria-disabled') === 'true';
      const label = labelForOption(input);
      const value = input instanceof HTMLInputElement ? input.value : input.getAttribute('data-value') || label;
      return makeOption(index, label, value, disabled, checked, getUniqueSelector(input));
    });
    if (!options.length) return [];
    return [{
      id: makeControlId(kind, question, options, selector),
      kind,
      selector,
      question,
      options,
      multiple: kind === 'checkbox',
    }];
  });
}

function getSelectControls(): ChoiceControl[] {
  const hasForms = queryAcrossOpenShadowRoots<HTMLFormElement>('form').length > 0;
  return queryAcrossOpenShadowRoots<HTMLSelectElement>('select')
    .filter(isRendered)
    .filter((select) => !hasForms || isWithinForm(select) || Boolean(select.closest('.form-group.field')))
    .map((select) => {
      const selector = getUniqueSelector(select);
      const options = Array.from(select.options).map((option, index) => makeOption(
        index,
        normalizeText(option.label || option.textContent),
        option.value,
        option.matches(':disabled'),
        option.selected,
        selector,
      ));
      return {
        id: makeControlId('select', questionFor(select), options, selector),
        kind: 'select',
        selector,
        question: questionFor(select),
        options,
        multiple: select.multiple,
      };
    });
}

function getGoogleFormsDropdownControls(): ChoiceControl[] {
  return queryAcrossOpenShadowRoots<HTMLElement>('[role="listbox"]')
    .filter((listbox) => isRendered(listbox) && Boolean(listbox.closest('[role="listitem"]')))
    .flatMap((listbox) => {
      const selector = getUniqueSelector(listbox);
      const options = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')).map((option, index) => {
        const label = normalizeText(option.getAttribute('aria-label') || option.textContent);
        return makeOption(
          index,
          label,
          option.getAttribute('data-value') || label,
          option.getAttribute('aria-disabled') === 'true',
          option.getAttribute('aria-selected') === 'true',
          selector,
        );
      }).filter((option) => option.label);
      if (!options.length) return [];

      return [{
        id: makeControlId('select', questionFor(listbox), options, selector),
        kind: 'select' as const,
        selector,
        question: questionFor(listbox),
        options,
        multiple: listbox.getAttribute('aria-multiselectable') === 'true',
      }];
    });
}

function getComboboxListbox(element: HTMLElement): HTMLElement | null {
  const ids = [
    ...(element.getAttribute('aria-controls') ?? '').split(/\s+/),
    ...(element.getAttribute('aria-owns') ?? '').split(/\s+/),
    element.id ? `react-select-${element.id}-listbox` : '',
  ].filter(Boolean);
  const listboxes = queryAcrossOpenShadowRoots<HTMLElement>('[role="listbox"]');
  return listboxes.find((listbox) => ids.includes(listbox.id))
    ?? listboxes.find((listbox) => element.contains(listbox))
    ?? null;
}

function captureWindowScroll(): { left: number; top: number } {
  return { left: window.scrollX, top: window.scrollY };
}

function restoreWindowScroll(position: { left: number; top: number }): void {
  window.scrollTo({ left: position.left, top: position.top, behavior: 'instant' });
}

async function openComboboxListbox(element: HTMLElement): Promise<HTMLElement | null> {
  const existing = getComboboxListbox(element);
  if (element.getAttribute('aria-expanded') === 'true' && existing) return existing;

  const scrollPosition = captureWindowScroll();
  const control = element.closest<HTMLElement>('[class*="select__control"]') ?? element;
  simulateFullClick(control, false);
  const deadline = Date.now() + 800;
  while (Date.now() < deadline) {
    const listbox = getComboboxListbox(element);
    if (listbox?.querySelector('[role="option"]')) {
      restoreWindowScroll(scrollPosition);
      return listbox;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  restoreWindowScroll(scrollPosition);
  return getComboboxListbox(element);
}

function getComboboxSelectedLabels(element: HTMLElement): string[] {
  const control = element.closest<HTMLElement>('[class*="select__control"]');
  const values = control?.querySelectorAll<HTMLElement>('[class*="single-value"], [class*="multi-value__label"]');
  const labels = Array.from(values ?? []).map((value) => normalizeText(value.textContent)).filter(Boolean);
  if (labels.length) return labels;
  const inputValue = element instanceof HTMLInputElement ? normalizeText(element.value) : '';
  return inputValue ? [inputValue] : [];
}

function isComboboxOptionSelected(element: HTMLElement, option: ChoiceOption): boolean {
  return getComboboxSelectedLabels(element).some((label) => normalizeText(label) === normalizeText(option.label));
}

async function waitForComboboxOption(element: HTMLElement, option: ChoiceOption, timeoutMs = 1200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isComboboxOptionSelected(element, option)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return isComboboxOptionSelected(element, option);
}

async function getComboboxControls(): Promise<ChoiceControl[]> {
  const inputs = queryAcrossOpenShadowRoots<HTMLElement>('[role="combobox"]')
    .filter((element) => element instanceof HTMLInputElement && element.type !== 'search' && isRendered(element));
  const controls: ChoiceControl[] = [];

  for (const element of inputs) {
    const question = questionFor(element);
    if (!question) continue;
    const wasExpanded = element.getAttribute('aria-expanded') === 'true';
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollPosition = captureWindowScroll();
    const listbox = await openComboboxListbox(element);
    const optionElements = Array.from(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const selectedLabels = getComboboxSelectedLabels(element);
    const selector = getUniqueSelector(element);
    const options = optionElements.map((option, index) => {
      const label = normalizeText(option.getAttribute('aria-label') || option.textContent);
      return makeOption(
        index,
        label,
        option.getAttribute('data-value') || option.id || label,
        option.getAttribute('aria-disabled') === 'true',
        selectedLabels.some((selected) => normalizeText(selected) === normalizeText(label)),
        selector,
      );
    }).filter((option) => option.label);

    if (!wasExpanded) {
      if (element.getAttribute('aria-expanded') === 'true') {
        const control = element.closest<HTMLElement>('[class*="select__control"]') ?? element;
        simulateFullClick(control, false);
      }
      if (previousFocus && previousFocus !== element) previousFocus.focus({ preventScroll: true });
      else element.blur();
    }
    restoreWindowScroll(scrollPosition);
    if (!options.length) continue;

    controls.push({
      id: makeControlId('select', question, options, selector),
      kind: 'select',
      selector,
      question,
      options,
      multiple: listbox?.getAttribute('aria-multiselectable') === 'true',
    });
  }
  return controls;
}

export async function scanChoiceControls(): Promise<ChoiceControl[]> {
  const controls: ChoiceControl[] = [];
  controls.push(...getGroupedInputControls());
  controls.push(...getSelectControls());
  controls.push(...getGoogleFormsDropdownControls());
  controls.push(...await getComboboxControls());

  console.info(`[JobFill Choice] DOM scan detected ${controls.length} controls`, controls.map((control) => ({
    id: control.id,
    kind: control.kind,
    question: control.question,
    options: control.options.map((option) => ({ label: option.label, disabled: option.disabled, selected: option.selected })),
  })));
  if (!controls.length) console.warn('[JobFill Choice] no radio or checkbox controls detected');
  return controls;
}

export function extractChoiceFormAnswers(): ChoiceFormAnswer[] {
  const answers: ChoiceFormAnswer[] = [];
  const answerSelector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]), textarea, [role="textbox"], [contenteditable="true"]';
  const isRelevantAnswerQuestion = (question: string) =>
    /\b(relocat|availability|available|immediate|joining|notice period|on[ -]?site)\b/i.test(question);
  const readAnswer = (element: HTMLElement): string => normalizeText(
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element.value
      : element.innerText || element.textContent,
  );

  const googleCards = queryAcrossOpenShadowRoots<HTMLElement>('[role="listitem"]');
  for (const card of googleCards) {
    const question = normalizeText(card.querySelector<HTMLElement>('[role="heading"], h1, h2, h3, h4')?.textContent);
    if (!question || !isRelevantAnswerQuestion(question)) continue;

    const answerControls = Array.from(card.querySelectorAll<HTMLElement>(answerSelector)).filter((element) => {
      if (!isRendered(element)) return false;
      if (element instanceof HTMLInputElement && ['radio', 'checkbox', 'date', 'password', 'email', 'tel'].includes(element.type)) return false;
      return true;
    });
    if (!answerControls.length) {
      console.info('[JobFill Choice] relevant form question has no readable text answer control', { question });
      continue;
    }

    const answerControl = answerControls[0];
    const answer = readAnswer(answerControl);
    if (!answer) {
      console.info('[JobFill Choice] relevant form answer is currently empty', {
        question,
        tag: answerControl.tagName,
        type: answerControl.getAttribute('type'),
      });
      continue;
    }
    answers.push({ question, answer: answer.slice(0, 600) });
  }

  const elements = queryAcrossOpenShadowRoots<HTMLElement>(answerSelector).filter(isRendered);

  for (const element of elements) {
    if (element instanceof HTMLInputElement && ['radio', 'checkbox', 'date', 'password', 'email', 'tel'].includes(element.type)) continue;
    const card = element.closest<HTMLElement>('[role="listitem"]');
    if (card) continue;
    const question = normalizeText(
      getLabelText(element)
      || element.getAttribute('aria-label'),
    );
    if (!question || !isRelevantAnswerQuestion(question)) continue;
    const answer = readAnswer(element);
    if (answer) answers.push({ question, answer: answer.slice(0, 600) });
  }

  const deduped = [...new Map(answers.map((answer) => [`${answer.question.toLowerCase()}\u0000${answer.answer}`, answer])).values()];
  const limitedAnswers = deduped.slice(0, 12);
  console.info(`[JobFill Choice] contextual form evidence detected ${limitedAnswers.length} answers`, limitedAnswers.map(({ question }) => question));
  return limitedAnswers;
}

/**
 * Simulate a full user-click event sequence on an element.
 * Google Forms' Material Design radio/checkbox widgets listen for
 * pointerdown → mousedown → pointerup → mouseup → click — a bare
 * element.click() only fires the last event, which the Closure-based
 * handlers silently ignore.
 */
function simulateFullClick(element: HTMLElement, scrollIntoView = true): void {
  // Scroll into view to ensure the element is interactable
  if (scrollIntoView) element.scrollIntoView({ block: 'nearest', behavior: 'instant' });

  const rect = element.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const shared: Partial<MouseEventInit> = {
    bubbles: true,
    cancelable: true,
    composed: true,
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

/**
 * Find the React fiber key on a DOM node (differs across React versions).
 */
function getReactFiberKey(el: Element): string | undefined {
  return Object.keys(el).find(
    (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
  );
}

/**
 * Walk the React fiber tree upward and invoke the first onChange/onClick
 * prop found with a synthetic-event-like object. This handles React 16/17/18
 * controlled radio/checkbox components (e.g. Meta/Facebook career pages)
 * where a bare element.click() fires a native event but React's internal
 * state tracker never updates, causing reconciliation to revert the checked
 * state.
 */
function triggerReactCheckChange(el: HTMLInputElement): boolean {
  const fiberKey = getReactFiberKey(el);
  if (!fiberKey) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node = (el as any)[fiberKey];
  let triggered = false;
  while (node) {
    const onChange =
      node.memoizedProps?.onChange ?? node.pendingProps?.onChange;
    if (typeof onChange === 'function') {
      const syntheticEvent = {
        target: el,
        currentTarget: el,
        type: 'change',
        nativeEvent: new Event('change', { bubbles: true }),
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
        persist: () => {},
      };
      try {
        onChange(syntheticEvent);
        triggered = true;
      } catch { /* swallow — the handler may throw before committing */ }
      break;
    }
    const onClick =
      node.memoizedProps?.onClick ?? node.pendingProps?.onClick;
    if (typeof onClick === 'function') {
      const syntheticClick = {
        target: el,
        currentTarget: el,
        type: 'click',
        nativeEvent: new MouseEvent('click', { bubbles: true }),
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
        persist: () => {},
      };
      try {
        onClick(syntheticClick);
        triggered = true;
      } catch { /* swallow */ }
      break;
    }
    node = node.return;
  }
  return triggered;
}

/**
 * Find the nearest <label> element that wraps or is associated with the input.
 */
function findAssociatedLabel(input: HTMLInputElement): HTMLLabelElement | null {
  // 1. Wrapping <label>
  const parentLabel = input.closest<HTMLLabelElement>('label');
  if (parentLabel) return parentLabel;
  // 2. <label for="...">
  if (input.id) {
    const root = input.getRootNode();
    const queryRoot = root instanceof ShadowRoot ? root : document;
    const forLabel = queryRoot.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`);
    if (forLabel) return forLabel;
  }
  return null;
}

/**
 * Robust click strategy for HTMLInputElement radios/checkboxes.
 * Tries multiple approaches in order of reliability:
 * 1. Native .click()
 * 2. Set checked via prototype setter + dispatch events + React fiber onChange
 * 3. Click the associated <label> element
 * 4. simulateFullClick on the input itself
 * 5. simulateFullClick on the label
 */
async function clickCheckableInput(element: HTMLInputElement, controlId: string, optionLabel: string): Promise<void> {
  // --- Strategy 1: Native .click() ---
  element.click();
  if (await waitForCheckedState(element, true, 300)) return;

  console.warn('[JobFill Choice] native .click() did not change checked state; trying React fiber + setter', {
    controlId,
    option: optionLabel,
  });

  // --- Strategy 2: Set checked via prototype setter + React fiber ---
  const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
  if (checkedSetter) {
    checkedSetter.call(element, true);
  } else {
    element.checked = true;
  }
  // Fire native events so any framework picks up the change
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  // Also try React fiber direct onChange invocation
  triggerReactCheckChange(element);
  if (await waitForCheckedState(element, true, 300)) return;

  console.warn('[JobFill Choice] React fiber approach did not stick; trying associated <label> click', {
    controlId,
    option: optionLabel,
  });

  // --- Strategy 3: Click the associated <label> ---
  const label = findAssociatedLabel(element);
  if (label) {
    label.click();
    if (await waitForCheckedState(element, true, 300)) return;

    console.warn('[JobFill Choice] label.click() did not work; trying simulateFullClick on label', {
      controlId,
      option: optionLabel,
    });

    // --- Strategy 5: simulateFullClick on label ---
    simulateFullClick(label);
    if (await waitForCheckedState(element, true, 300)) return;
  }

  // --- Strategy 4: simulateFullClick on input ---
  console.warn('[JobFill Choice] trying simulateFullClick on the input element itself', {
    controlId,
    option: optionLabel,
  });
  simulateFullClick(element);

  // Also walk up to the closest interactive container (div, span wrapping the
  // radio circle + label text) and try clicking it — some React component
  // libraries (Meta's FDS, MUI) attach the handler on a wrapper element.
  if (!await waitForCheckedState(element, true, 300)) {
    let container = element.parentElement;
    let depth = 0;
    while (container && depth < 4) {
      if (container.tagName === 'FORM' || container.tagName === 'FIELDSET') break;
      const isClickable = container.getAttribute('role') === 'radio'
        || container.getAttribute('role') === 'checkbox'
        || container.tagName === 'LABEL'
        || container.classList.length > 0; // styled wrapper
      if (isClickable && container instanceof HTMLElement) {
        console.warn('[JobFill Choice] trying ancestor wrapper click', {
          controlId,
          option: optionLabel,
          wrapperTag: container.tagName,
          wrapperRole: container.getAttribute('role'),
        });
        simulateFullClick(container);
        if (await waitForCheckedState(element, true, 200)) return;
      }
      container = container.parentElement;
      depth++;
    }
  }
}

async function waitForCheckedState(element: HTMLElement, expected: boolean, timeoutMs = 1200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const checked = element instanceof HTMLInputElement
      ? element.checked
      : element.getAttribute('aria-checked') === 'true';
    if (checked === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return false;
}

function isSelectOptionSelected(element: HTMLSelectElement, option: ChoiceOption): boolean {
  return Array.from(element.options).some((nativeOption) =>
    nativeOption.selected
      && nativeOption.value === option.value
      && normalizeText(nativeOption.label || nativeOption.textContent) === option.label,
  );
}

async function waitForSelectOption(element: HTMLSelectElement, option: ChoiceOption, timeoutMs = 1200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isSelectOptionSelected(element, option)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return isSelectOptionSelected(element, option);
}

async function selectComboboxOption(element: HTMLElement, option: ChoiceOption): Promise<boolean> {
  const listbox = await openComboboxListbox(element);
  const target = Array.from(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    .find((candidate) => normalizeText(candidate.getAttribute('aria-label') || candidate.textContent) === normalizeText(option.label));
  if (!target || target.getAttribute('aria-disabled') === 'true') return false;
  const scrollPosition = captureWindowScroll();
  simulateFullClick(target, false);
  restoreWindowScroll(scrollPosition);
  return waitForComboboxOption(element, option);
}

async function waitForGoogleOption(listbox: HTMLElement, option: ChoiceOption, timeoutMs = 1200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findGoogleFormsOption(listbox, option)?.getAttribute('aria-selected') === 'true') return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return findGoogleFormsOption(listbox, option)?.getAttribute('aria-selected') === 'true';
}

function findGoogleFormsOption(listbox: HTMLElement, option: ChoiceOption): HTMLElement | undefined {
  return Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]')).find((candidate) =>
    normalizeText(candidate.getAttribute('aria-label') || candidate.textContent) === normalizeText(option.label),
  );
}

async function selectGoogleFormsOption(listbox: HTMLElement, option: ChoiceOption): Promise<boolean> {
  let target = findGoogleFormsOption(listbox, option);
  if (!target || target.getAttribute('aria-disabled') === 'true') return false;
  if (target.getAttribute('aria-selected') === 'true') return true;

  const scrollPosition = captureWindowScroll();
  const trigger = listbox.querySelector<HTMLElement>('[jsname="LgbsSe"]') ?? listbox;
  if (listbox.getAttribute('aria-expanded') !== 'true') simulateFullClick(trigger, false);
  const opened = await waitUntil(() => {
    const current = findGoogleFormsOption(listbox, option);
    return Boolean(current && current.getBoundingClientRect().height > 0);
  }, 800);
  if (!opened) {
    if (listbox.getAttribute('aria-expanded') === 'true') simulateFullClick(trigger, false);
    restoreWindowScroll(scrollPosition);
    return false;
  }
  target = findGoogleFormsOption(listbox, option);
  if (!target) {
    restoreWindowScroll(scrollPosition);
    return false;
  }
  simulateFullClick(target, false);
  restoreWindowScroll(scrollPosition);
  return waitForGoogleOption(listbox, option);
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return predicate();
}

export async function applyChoiceDecisions(decisions: ChoiceDecision[]): Promise<{ applied: string[]; unresolved: string[] }> {
  const controls = await scanChoiceControls();
  const controlsById = new Map(controls.map((control) => [control.id, control]));
  const applied: string[] = [];
  const unresolved: string[] = [];
  console.info(`[JobFill Choice] DOM apply received ${decisions.length} decisions`, decisions.map((decision) => ({
    id: decision.controlId,
    source: decision.source,
    confidence: decision.confidence,
    selectedOptionIds: decision.selectedOptionIds,
  })));

  for (const decision of decisions) {
    const control = controlsById.get(decision.controlId);
    const selectedIds = new Set(decision.selectedOptionIds);
    if (!control) {
      console.warn('[JobFill Choice] apply failed: decision control no longer matches the DOM scan', {
        id: decision.controlId,
        availableControlIds: controls.map((item) => item.id),
      });
      unresolved.push(decision.controlId);
      continue;
    }
    const isAvailabilityChoice = /\b(?:available|availability|immediate|immediately|joining|join|start|onsite|on site|internship|relocat(?:e|ion))\b/i.test(control.question)
      && control.options.some((option) => /^(?:yes|true|available|no|false|unavailable)$/i.test(option.label.trim()));
    if (!isAvailabilityChoice && !control.multiple && control.options.some((option) => option.selected
      && !selectedIds.has(option.id)
      && !/^(?:choose(?: one)?|select(?: one)?|please select|select\.\.\.|--|)$/i.test(option.label.trim()))) {
      console.info("[JobFill Choice] preserving the user's existing single-choice selection", {
        controlId: control.id,
        selectedOption: control.options.find((option) => option.selected)?.label,
      });
      applied.push(decision.controlId);
      continue;
    }
    if (!selectedIds.size || selectedIds.size > 1 && !control.multiple) {
      console.warn('[JobFill Choice] apply rejected: decision has no options or too many options for a single-choice control', {
        id: control.id,
        kind: control.kind,
        selectedOptionIds: decision.selectedOptionIds,
        multiple: control.multiple,
      });
      unresolved.push(decision.controlId);
      continue;
    }
    const selectedOptions = control.options.filter((option) => selectedIds.has(option.id) && !option.disabled);
    if (selectedOptions.length !== selectedIds.size || selectedOptions.length > 1 && !control.multiple) {
      console.warn('[JobFill Choice] apply rejected: selected option is missing or disabled in the current DOM', {
        id: control.id,
        question: control.question,
        kind: control.kind,
        requestedOptionIds: decision.selectedOptionIds,
        availableOptions: control.options.map((option) => ({ id: option.id, label: option.label, disabled: option.disabled })),
      });
      unresolved.push(decision.controlId);
      continue;
    }

    let success = true;
    let failureReason = 'selection-not-verified';
      for (const option of selectedOptions) {
        const element = option.selector ? getElementBySelector(option.selector) : null;
        if (!(element instanceof HTMLElement)) {
          failureReason = `option-selector-did-not-resolve:${option.id}`;
          success = false;
          break;
        }
        const googleFormsOption = element.getAttribute('role') === 'listbox'
          ? findGoogleFormsOption(element, option)
          : null;
        const checked = element instanceof HTMLSelectElement
          ? isSelectOptionSelected(element, option)
          : element.getAttribute('role') === 'combobox'
            ? isComboboxOptionSelected(element, option)
            : googleFormsOption
              ? googleFormsOption.getAttribute('aria-selected') === 'true'
          : element instanceof HTMLInputElement
            ? element.checked
            : element.getAttribute('aria-checked') === 'true';
        console.info('[JobFill Choice] applying group option', {
          controlId: control.id,
          kind: control.kind,
          question: control.question,
          option: option.label,
          selector: option.selector,
          alreadyChecked: checked,
          role: element.getAttribute('role'),
          tag: element.tagName,
        });
        if (!checked && googleFormsOption && element.getAttribute('role') === 'listbox') {
          if (!await selectGoogleFormsOption(element, option)) {
            failureReason = `google-forms-option-not-verified:${option.id}`;
            success = false;
            break;
          }
        } else if (!checked && element.getAttribute('role') === 'combobox') {
          if (!await selectComboboxOption(element, option)) {
            failureReason = `combobox-option-not-verified:${option.id}`;
            success = false;
            break;
          }
        } else if (!checked && element instanceof HTMLSelectElement) {
          if (element.multiple) {
            const nativeOption = Array.from(element.options).find((candidate) =>
              candidate.value === option.value
                && normalizeText(candidate.label || candidate.textContent) === option.label,
            );
            if (!nativeOption) {
              failureReason = `select-option-not-found:${option.id}`;
              success = false;
              break;
            }
            nativeOption.selected = true;
          } else {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            if (setter) setter.call(element, option.value);
            else element.value = option.value;
          }
          element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          if (!await waitForSelectOption(element, option)) {
            failureReason = `select-option-not-verified:${option.id}`;
            success = false;
            break;
          }
        } else if (!checked) {
          if (element instanceof HTMLInputElement) {
            // Use the robust multi-strategy click for native radio/checkbox inputs.
            // Handles React controlled components (Meta/Facebook), plain HTML, and
            // other framework-managed inputs that ignore bare .click().
            await clickCheckableInput(element, control.id, option.label);
          } else {
            // Use the full pointer/mouse event sequence for ARIA role-based
            // widgets (Google Forms, Material Design) that ignore bare .click().
            simulateFullClick(element);

            // If the state didn't change, try clicking the parent label container.
            // Google Forms sometimes routes the handler through a wrapper div.
            const firstClickWorked = await waitForCheckedState(element, true, 400);
            if (!firstClickWorked) {
              const wrapper = element.closest('[role="radio"], [role="checkbox"]') !== element
                ? null
                : element.parentElement;
              if (wrapper && wrapper instanceof HTMLElement) {
                console.warn('[JobFill Choice] first click did not change checked state; trying parent wrapper', {
                  controlId: control.id,
                  option: option.label,
                  role: element.getAttribute('role'),
                  ariaChecked: element.getAttribute('aria-checked'),
                });
                simulateFullClick(wrapper);
              } else {
                console.warn('[JobFill Choice] first click did not change checked state and no wrapper was available', {
                  controlId: control.id,
                  option: option.label,
                  role: element.getAttribute('role'),
                  ariaChecked: element.getAttribute('aria-checked'),
                });
              }
            }
          }
        }
        const verified = element.getAttribute('role') === 'combobox'
          ? await waitForComboboxOption(element, option)
          : googleFormsOption && element.getAttribute('role') === 'listbox'
            ? await waitForGoogleOption(element, option)
          : element instanceof HTMLSelectElement
            ? await waitForSelectOption(element, option)
            : await waitForCheckedState(element, true);
        console.info('[JobFill Choice] group option verification', {
          controlId: control.id,
          option: option.label,
          verified,
          checked: element.getAttribute('role') === 'combobox'
            ? getComboboxSelectedLabels(element)
            : googleFormsOption
              ? googleFormsOption.getAttribute('aria-selected')
            : element instanceof HTMLSelectElement
              ? element.value
            : element instanceof HTMLInputElement
              ? element.checked
              : element.getAttribute('aria-checked'),
        });
        if (!verified) {
          failureReason = element.getAttribute('role') === 'combobox'
            ? `combobox-option-not-confirmed:${option.id}`
            : googleFormsOption
              ? `google-forms-option-not-confirmed:${option.id}`
            : element instanceof HTMLSelectElement
              ? `select-option-not-confirmed:${option.id}`
              : `checked-state-not-confirmed:${option.id}`;
          success = false;
        }
    }

    if (success) {
      console.info('[JobFill Choice] selection applied and verified', {
        controlId: control.id,
        kind: control.kind,
        question: control.question,
        selectedOptions: selectedOptions.map((option) => option.label),
      });
    } else {
      console.warn('[JobFill Choice] selection failed', {
        controlId: control.id,
        kind: control.kind,
        question: control.question,
        selectedOptions: selectedOptions.map((option) => option.label),
        reason: failureReason,
      });
    }
    (success ? applied : unresolved).push(decision.controlId);
  }

  console.info('[JobFill Choice] DOM apply complete', { applied, unresolved });
  return { applied, unresolved };
}