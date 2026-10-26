export function shouldSkipDuplicateScan(lastRunAt, now, minGapMs) {
  if (!Number.isFinite(lastRunAt)) return false;
  return now - lastRunAt < minGapMs;
}
