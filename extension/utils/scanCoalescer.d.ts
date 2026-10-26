export function shouldSkipDuplicateScan(
  lastRunAt: number | null,
  now: number,
  minGapMs: number,
): boolean;