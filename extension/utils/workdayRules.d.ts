export function isWorkdayHost(hostname: string | null | undefined): boolean;
export function isExactName(name: string | null | undefined, expected: string): boolean;
export function decideSectionAction(state: { hasEntry: boolean; hasAddButton: boolean }): 'exists' | 'add' | 'none';
export function isSettled(state: {
  fieldCount: number;
  previousFieldCount: number;
  busy: boolean;
  lastMutationAt: number;
  now: number;
  quietMs: number;
}): boolean;
