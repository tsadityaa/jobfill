// Workday only: before "Scan Current Page" scans, click "Add" in an empty
// Work Experience / Education section and wait for its fields to render.
// Equivalent to:
//   page.getByRole('group', { name: 'Work Experience' }).getByRole('button', { name: 'Add', exact: true }).click()

import { decideSectionAction, isExactName, isSettled, isWorkdayHost } from './workdayRules';

const SECTIONS = ['Work Experience', 'Education'] as const;
type Section = (typeof SECTIONS)[number];

export interface WorkdayPrepareResult {
  ok: boolean;
  added: string[];
  existing: string[];
  error?: string;
}

const SETTLE_TIMEOUT_MS = 6000;
const QUIET_MS = 300;
const POLL_MS = 100;

const FIELD_SELECTOR =
  'input:not([type="hidden"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]), select, textarea, [aria-haspopup="listbox"]';

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
}

function accessibleName(el: HTMLElement): string {
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return text;
  }
  return el.getAttribute('aria-label') ?? '';
}

/** getByRole('group', { name }) */
function findSectionGroup(name: Section): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="group"]'))
    .find((group) => isExactName(accessibleName(group), name) && isVisible(group)) ?? null;
}

/** Visible button inside `group` whose accessible name is exactly `name`. */
function findButton(group: HTMLElement, name: string): HTMLElement | null {
  return Array.from(group.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .find((button) => isVisible(button) && isExactName(button.getAttribute('aria-label') ?? button.textContent, name))
    ?? null;
}

function countFields(group: HTMLElement): number {
  return Array.from(group.querySelectorAll<HTMLElement>(FIELD_SELECTOR)).filter(isVisible).length;
}

function waitUntilSettled(section: Section): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let lastMutationAt = Date.now();
    let previousFieldCount = -1;

    // Only structural changes inside this section count; Workday mutates attributes
    // page-wide continuously, which would keep the DOM from ever looking "quiet".
    const observer = new MutationObserver(() => { lastMutationAt = Date.now(); });
    observer.observe(findSectionGroup(section) ?? document.body, { subtree: true, childList: true });

    const timer = setInterval(() => {
      const group = findSectionGroup(section);
      const fieldCount = group ? countFields(group) : 0;
      const busy = Boolean(group?.querySelector('[aria-busy="true"]'));
      const now = Date.now();
      const settled = isSettled({ fieldCount, previousFieldCount, busy, lastMutationAt, now, quietMs: QUIET_MS });
      previousFieldCount = fieldCount;
      if (settled || now - startedAt >= SETTLE_TIMEOUT_MS) {
        clearInterval(timer);
        observer.disconnect();
        resolve(settled);
      }
    }, POLL_MS);
  });
}

export async function prepareWorkdaySections(): Promise<WorkdayPrepareResult> {
  const result: WorkdayPrepareResult = { ok: true, added: [], existing: [] };
  if (!isWorkdayHost(window.location.hostname)) return result;

  for (const section of SECTIONS) {
    const group = findSectionGroup(section);
    if (!group) continue;

    const hasEntry = countFields(group) > 0 || findButton(group, 'Add Another') !== null;
    const addButton = hasEntry ? null : findButton(group, 'Add');
    const action = decideSectionAction({ hasEntry, hasAddButton: addButton !== null });
    if (action === 'none') continue;

    if (action === 'add') {
      addButton!.click();
      result.added.push(section);
      if (!(await waitUntilSettled(section))) {
        return { ...result, ok: false, error: `Timed out waiting for the Workday "${section}" fields to load. Please retry.` };
      }
    } else {
      result.existing.push(section);
    }
  }

  return result;
}
