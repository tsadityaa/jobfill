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

export async function scanChoiceControls(): Promise<ChoiceControl[]> {
  const controls: ChoiceControl[] = [];
  controls.push(...getGroupedInputControls());

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
function simulateFullClick(element: HTMLElement): void {
  // Scroll into view to ensure the element is interactable
  element.scrollIntoView({ block: 'nearest', behavior: 'instant' });

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
        const checked = element instanceof HTMLInputElement
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
        if (!checked) {
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
        const verified = await waitForCheckedState(element, true);
        console.info('[JobFill Choice] group option verification', {
          controlId: control.id,
          option: option.label,
          verified,
          checked: element instanceof HTMLInputElement ? element.checked : element.getAttribute('aria-checked'),
        });
        if (!verified) {
          failureReason = `checked-state-not-confirmed:${option.id}`;
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