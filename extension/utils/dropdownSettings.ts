// User setting: let AI choose answers for dropdowns that no rule or cache can answer (default: on).
// Rule-based answers (Workday presets, degree, country code) and cached answers are not affected.

export const DROPDOWN_AI_ENABLED_KEY = 'jobfill_dropdown_ai_enabled';

export async function isDropdownAIEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(DROPDOWN_AI_ENABLED_KEY);
  return stored[DROPDOWN_AI_ENABLED_KEY] !== false;
}

export async function setDropdownAIEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [DROPDOWN_AI_ENABLED_KEY]: enabled });
}
