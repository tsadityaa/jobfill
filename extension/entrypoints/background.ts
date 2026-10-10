// ============================================================
// Background Service Worker
// ============================================================
// Orchestrates the pre-scan pipeline:
//   1. Content script sends PAGE_READY on load
//   2. Background sends DETECT_JOB_PAGE → local scorer
//   3. If JOB_APPLICATION → send PRESCAN → get regex + sanitized fields + fingerprint
//   4. Check fingerprint cache — if hit, use cached AI mappings
//   5. If miss → call AI mapper for UNKNOWN fields only
//   6. Store full result in tab result cache (keyed by tabId)
//   7. Popup reads result instantly on Scan button click
// ============================================================

/// <reference types="chrome" />

import { mapFieldsWithAI } from '../utils/aiMapper';
import { ALL_INTENT_KEYS } from '../types/aiMapper';
import { resolveProfileValue } from '../utils/fieldMapper';
import { cloudGetProfile, cloudLoadAllDocumentMetadata, cloudLoadDocumentBlob } from '../utils/cloudStorage';
import { getCurrentUser } from '../utils/supabase';
import { searchMemory } from '../utils/memory';
import { extractProfileFieldFromDocuments, formatProfileAnswerContext, generateApplicationAnswer } from '../utils/answerGenerator';
import { detectApplicationQuestions } from '../utils/questionDetector';
import {
  cacheChoice,
  getCachedChoice,
  getRelevantChoiceFormAnswers,
  getRelevantProfileFacts,
  resolveChoiceFromEvidence,
  resolveChoiceFromProfile,
  resolveChoicesWithAI,
  resolveOptimisticJobAvailability,
} from '../utils/choiceResolver';
import { classifyDocumentField, selectDocumentForUpload } from '../utils/documentMatcher';
import { clearQuestionState, getQuestionState, setQuestionAutofillRequested, setQuestionState, updateQuestionTask } from '../utils/questionTaskStore';
import { clearFileUploadState, getFileUploadState, setFileAutofillRequested, setFileUploadState, updateFileUploadTask } from '../utils/fileUploadTaskStore';
import {
  getCachedMapping,
  setCachedMapping,
  setTabResult,
  getTabResult,
  clearTabResult,
  GOOGLE_FORM_MAPPING_VERSION,
} from '../utils/mappingCache';
import type { DetectJobPageResponse, PrescanResponse, WaitForFormReadyResponse } from '../types/messages';
import type { FieldMapping } from '../types/autofill';
import type { ProfileFieldKey } from '../types/autofill';
import type { SanitizedField, FieldIdLookup, GoogleFormLabelField } from '../types/aiMapper';
import type { QuestionTask } from '../types/questionTask';
import type { FileUploadTask } from '../types/fileUploadTask';
import type { StoredDocument } from '../types/document';
import type { ChoiceControl, ChoiceDecision, ChoiceEvidence } from '../types/choice';
import type { UserProfile } from '../types/profile';

/** In-memory guard: prevent concurrent pre-scans for the same tab */
const runningTabs = new Set<number>();
const pendingPrescanTabs = new Set<number>();
const pendingGoogleFormFrames = new Map<number, number>();
const pendingQuestionAutofillTabs = new Map<number, boolean>();
const runningChoiceTabs = new Set<number>();
const pendingChoiceApplyTabs = new Set<number>();
const choiceApplyRequestedTabs = new Set<number>();
interface ChoiceProgress {
  url: string;
  frameId: number;
  applyRequested: boolean;
  resolvedControlIds: string[];
  appliedControlIds: string[];
  decisions: ChoiceDecision[];
}

const choiceProgressByTab = new Map<number, ChoiceProgress>();
const CHOICE_PROGRESS_KEY_PREFIX = 'jf_radio_checkbox_progress_v2_';

function choiceProgressKey(tabId: number): string {
  return `${CHOICE_PROGRESS_KEY_PREFIX}${tabId}`;
}

async function getChoiceProgress(tabId: number, url: string, frameId: number): Promise<ChoiceProgress> {
  const current = choiceProgressByTab.get(tabId);
  if (current?.url === url) {
    current.frameId = frameId;
    return current;
  }
  const key = choiceProgressKey(tabId);
  const stored = await new Promise<ChoiceProgress | undefined>((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key] as ChoiceProgress | undefined));
  });
  const progress = stored?.url === url
    ? { ...stored, frameId }
    : { url, frameId, applyRequested: false, resolvedControlIds: [], appliedControlIds: [], decisions: [] };
  choiceProgressByTab.set(tabId, progress);
  return progress;
}

async function saveChoiceProgress(tabId: number, progress: ChoiceProgress): Promise<void> {
  const key = choiceProgressKey(tabId);
  await new Promise<void>((resolve) => chrome.storage.local.set({ [key]: progress }, resolve));
}

async function clearChoiceProgress(tabId: number): Promise<void> {
  choiceProgressByTab.delete(tabId);
  choiceApplyRequestedTabs.delete(tabId);
  pendingChoiceApplyTabs.delete(tabId);
  await new Promise<void>((resolve) => chrome.storage.local.remove(choiceProgressKey(tabId), resolve));
}

async function requestChoiceApply(tabId: number): Promise<void> {
  console.info(`[JobFill Choice] Tab ${tabId}: 🔔 requestChoiceApply called`);
  choiceApplyRequestedTabs.add(tabId);
  let progress = choiceProgressByTab.get(tabId);
  if (!progress) {
    const key = choiceProgressKey(tabId);
    progress = await new Promise<ChoiceProgress | undefined>((resolve) => {
      chrome.storage.local.get([key], (result) => resolve(result[key] as ChoiceProgress | undefined));
    });
    if (progress) {
      choiceProgressByTab.set(tabId, progress);
      console.info(`[JobFill Choice] Tab ${tabId}: restored progress from storage`, {
        url: progress.url,
        resolvedCount: progress.resolvedControlIds.length,
        appliedCount: progress.appliedControlIds.length,
        decisionCount: progress.decisions.length,
      });
    }
  }
  if (!progress) {
    if (runningChoiceTabs.has(tabId)) {
      pendingChoiceApplyTabs.add(tabId);
      console.info(`[JobFill Choice] Tab ${tabId}: Scan click queued while choice preparation restores state`);
      return;
    }
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab?.url) {
      choiceApplyRequestedTabs.delete(tabId);
      console.info(`[JobFill Choice] Tab ${tabId}: cannot start choice scan without an active page URL`);
      return;
    }
    const frameId = await findGoogleFormsFrameId(tabId) ?? 0;
    progress = {
      url: tab.url,
      frameId,
      applyRequested: true,
      resolvedControlIds: [],
      appliedControlIds: [],
      decisions: [],
    };
    choiceProgressByTab.set(tabId, progress);
    console.info(`[JobFill Choice] Tab ${tabId}: starting fresh choice pipeline from autofill request`, { url: tab.url, frameId });
  }
  progress.applyRequested = true;
  await saveChoiceProgress(tabId, progress);
  console.info(`[JobFill Choice] Tab ${tabId}: ✅ Scan Current Page authorized radio/checkbox answers`, {
    pipelineAlreadyRunning: runningChoiceTabs.has(tabId),
    existingDecisions: progress.decisions.length,
  });
  if (runningChoiceTabs.has(tabId)) pendingChoiceApplyTabs.add(tabId);
  else void runChoicePipeline(tabId, progress.frameId, progress.url);
}
const GOOGLE_FORM_INTENT_KEYS: ProfileFieldKey[] = [
  ...ALL_INTENT_KEYS,
  'education.latest.registrationNo',
  'addresses.primary.cityState',
];
const GOOGLE_FORM_INTENT_DESCRIPTIONS: Partial<Record<ProfileFieldKey, string>> = {
  'addresses.primary.full': 'The user\'s complete primary mailing or home address, combining street lines, city, state or region, postal code, and country when a form asks for one address field.',
  'addresses.primary.line1': 'The street address or first address line, such as house number and street name.',
  'education.latest.registrationNo': 'A student identifier recorded with education, such as an academic registration, enrollment, or roll identifier assigned by a school, college, or university.',
  'addresses.primary.cityState': 'The primary address city and state combined into a single text value.',
  'education.latest.institution': 'The school, college, university, or other educational institution attended by the user.',
  'education.latest.field': 'The user\'s academic department, department of study, major, discipline, specialization, program, or field of study.',
};

function isGoogleFormsUrl(url: string): boolean {
  return /^https:\/\/docs\.google\.com\/forms\//i.test(url);
}

function getGoogleFormAICandidates(
  fields: SanitizedField[],
  selectorLookup: FieldIdLookup,
  fallbackSelectors: Set<string>,
): { fields: GoogleFormLabelField[]; intentKeys: ProfileFieldKey[] } {
  const candidates: GoogleFormLabelField[] = [];

  for (const field of fields) {
    const selector = selectorLookup[field.fieldId];
    if (!selector || !fallbackSelectors.has(selector)) continue;

    const label = (field.label ?? field.ariaLabel ?? field.placeholder ?? '')
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) continue;
    candidates.push({ fieldId: field.fieldId, label });
  }

  return { fields: candidates, intentKeys: GOOGLE_FORM_INTENT_KEYS };
}

async function findGoogleFormsFrameId(tabId: number): Promise<number | null> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const formFrame = frames?.find((frame) => isGoogleFormsUrl(frame.url));
    return formFrame?.frameId ?? null;
  } catch {
    return null;
  }
}

async function getTabFrameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames && frames.length > 0) {
      const frameIds: number[] = [];
      for (const frame of frames as Array<{ frameId: number }>) {
        if (!frameIds.includes(frame.frameId)) frameIds.push(frame.frameId);
      }
      return frameIds.sort((a, b) => {
        if (a === 0) return -1;
        if (b === 0) return 1;
        return a - b;
      });
    }
  } catch {
    // Some tabs/pages may not expose webNavigation frame metadata; keep it simple.
  }
  return [0];
}

async function detectJobFrame(tabId: number): Promise<{ frameId: number; response: DetectJobPageResponse } | null> {
  const frameIds = await getTabFrameIds(tabId);
  let best: { frameId: number; response: DetectJobPageResponse } | null = null;

  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_JOB_PAGE' }, { frameId }) as DetectJobPageResponse;
      if (!response) continue;
      if (response.classification === 'NOT_JOB') continue;
      if (!best || response.score > best.response.score) {
        best = { frameId, response };
      }
    } catch {
      // Frame may not have the content script yet or may be a blank shell.
    }
  }

  if (best) return best;

  // Final fallback: main frame only. This preserves the original not-job logic.
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'DETECT_JOB_PAGE' }, { frameId: 0 }) as DetectJobPageResponse;
    if (response && response.classification !== 'NOT_JOB') {
      return { frameId: 0, response };
    }
  } catch {
    // No main content script available.
  }

  return null;
}

async function fillQuestionTask(tabId: number, task: QuestionTask): Promise<boolean> {
  if (!task.answer) return false;
  await updateQuestionTask(tabId, task.fieldId, { status: 'FILLING' });
  try {
    const result = await chrome.tabs.sendMessage(
      tabId,
      { type: 'FILL_QUESTION_ANSWER', selector: task.selector, answer: task.answer },
      { frameId: task.frameId },
    ) as { success?: boolean };
    await updateQuestionTask(tabId, task.fieldId, { status: result?.success ? 'FILLED' : 'ERROR' });
    if (!result?.success) {
      await chrome.tabs.sendMessage(
        tabId,
        { type: 'SET_QUESTION_PENDING', selectors: [task.selector], pending: false },
        { frameId: task.frameId },
      ).catch(() => undefined);
    }
    return result?.success === true;
  } catch (error) {
    await updateQuestionTask(tabId, task.fieldId, {
      status: 'ERROR',
      error: error instanceof Error ? error.message : 'Could not reach the question field.',
    });
    await chrome.tabs.sendMessage(
      tabId,
      { type: 'SET_QUESTION_PENDING', selectors: [task.selector], pending: false },
      { frameId: task.frameId },
    ).catch(() => undefined);
    return false;
  }
}

async function runQuestionPipeline(
  tabId: number,
  frameId: number,
  url: string,
  fields: PrescanResponse['scanResult']['fields'],
): Promise<void> {
  const detected = detectApplicationQuestions(fields);
  const tasks: QuestionTask[] = detected.map(({ field }, index) => ({
    fieldId: `q${index}`,
    selector: field.selector,
    frameId,
    question: detected[index].question,
    type: 'application_question',
    status: 'RETRIEVING',
  }));
  const pendingAutofill = pendingQuestionAutofillTabs.get(tabId) ?? false;
  pendingQuestionAutofillTabs.delete(tabId);
  const state = { tabId, url, frameId, autofillRequested: pendingAutofill, tasks };
  await setQuestionState(state);
  console.log(`[JobFill BG] Tab ${tabId}: detected ${tasks.length} application question fields`);
  if (tasks.length === 0) return;

  void processQuestionTasks(tabId, tasks);
}

async function processQuestionTasks(tabId: number, tasks: QuestionTask[]): Promise<void> {
  let userId: string | null = null;
  let profileContext = '';
  try {
    userId = (await getCurrentUser())?.id ?? null;
  } catch (error) {
    console.warn(`[JobFill BG] Tab ${tabId}: could not identify user for question memory retrieval`, error);
  }
  try {
    profileContext = formatProfileAnswerContext(await cloudGetProfile());
  } catch (error) {
    console.warn(`[JobFill BG] Tab ${tabId}: could not load profile context for question answers`, error);
  }

  await Promise.all(tasks.map(async (task) => {
    try {
      const memories = userId ? await searchMemory(userId, task.question) : [];
      await updateQuestionTask(tabId, task.fieldId, { status: 'GENERATING' });
      const answer = await generateApplicationAnswer(task.question, memories, profileContext);
      if (!answer) throw new Error('No grounded answer was available from saved memories.');
      await updateQuestionTask(tabId, task.fieldId, { status: 'READY_TO_FILL', answer });

      const currentState = await getQuestionState(tabId);
      if (currentState?.autofillRequested) {
        await fillQuestionTask(tabId, { ...task, answer, status: 'READY_TO_FILL' });
      }
    } catch (error) {
      await updateQuestionTask(tabId, task.fieldId, {
        status: 'ERROR',
        error: error instanceof Error ? error.message : 'Question answer generation failed.',
      });
      await chrome.tabs.sendMessage(
        tabId,
        { type: 'SET_QUESTION_PENDING', selectors: [task.selector], pending: false },
        { frameId: task.frameId },
      ).catch(() => undefined);
    }
  }));
}

function isAvailabilityChoice(control: ChoiceControl): boolean {
  return !control.multiple
    && /\b(?:available|availability|immediate|immediately|joining|join|start|onsite|on site|internship|relocat(?:e|ion))\b/i.test(control.question)
    && control.options.some((option) => /^(?:yes|true|available|no|false|unavailable)$/i.test(option.label.trim()));
}

function hasSelectedChoice(control: ChoiceControl): boolean {
  return control.options.some((option) => option.selected && !option.disabled
    && !/^(?:choose(?: one)?|select(?: one)?|please select|select\.\.\.|--|)$/i.test(option.label.trim()));
}

async function applyPreparedChoiceDecisions(
  tabId: number,
  frameId: number,
  progress: ChoiceProgress,
): Promise<void> {
  const appliedIds = new Set(progress.appliedControlIds);
  const decisions = progress.decisions.filter((decision) => !appliedIds.has(decision.controlId));
  if (!decisions.length) {
    progress.applyRequested = false;
    await saveChoiceProgress(tabId, progress);
    console.info(`[JobFill Choice] Tab ${tabId}: no prepared radio/checkbox decisions are waiting to apply`);
    return;
  }

  console.info(`[JobFill Choice] Tab ${tabId}: applying ${decisions.length} prepared radio/checkbox decisions`, decisions.map((decision) => ({
    controlId: decision.controlId,
    selectedOptionIds: decision.selectedOptionIds,
    source: decision.source,
    confidence: decision.confidence,
  })));
  const result = await chrome.tabs.sendMessage(
    tabId,
    { type: 'CHOICE_APPLY', decisions },
    { frameId },
  ) as { applied?: string[]; unresolved?: string[] };
  console.info(`[JobFill Choice] Tab ${tabId}: radio/checkbox apply result`, {
    applied: result?.applied ?? [],
    unresolved: result?.unresolved ?? [],
    expected: decisions.map((decision) => decision.controlId),
  });
  const unresolvedIds = new Set(result?.unresolved ?? []);
  progress.appliedControlIds = [...new Set([
    ...progress.appliedControlIds,
    ...decisions.filter((decision) => !unresolvedIds.has(decision.controlId)).map((decision) => decision.controlId),
  ])];
  progress.applyRequested = false;
  await saveChoiceProgress(tabId, progress);
}

async function runChoicePipeline(tabId: number, frameId: number, url: string): Promise<void> {
  if (runningChoiceTabs.has(tabId)) {
    console.info(`[JobFill Choice] Tab ${tabId}: pipeline already running, skipping duplicate invocation`);
    return;
  }
  runningChoiceTabs.add(tabId);
  console.info(`[JobFill Choice] Tab ${tabId}: ▶ starting choice pipeline`, { frameId, url, applyRequested: choiceApplyRequestedTabs.has(tabId) });
  try {
    const progress = await getChoiceProgress(tabId, url, frameId);
    if (choiceApplyRequestedTabs.has(tabId)) {
      progress.applyRequested = true;
      await saveChoiceProgress(tabId, progress);
    }
    console.info(`[JobFill Choice] Tab ${tabId}: sending CHOICE_SCAN to frame ${frameId}`);
    const response = await chrome.tabs.sendMessage(
      tabId,
      { type: 'CHOICE_SCAN' },
      { frameId },
    ) as { controls?: ChoiceControl[]; formAnswers?: Array<{ question: string; answer: string }> };
    const controls = response?.controls ?? [];
    const formAnswers = response?.formAnswers ?? [];
    console.info(`[JobFill Choice] Tab ${tabId}: CHOICE_SCAN returned ${controls.length} controls, ${formAnswers.length} form answers`);
    const resolvedIds = new Set(progress.resolvedControlIds);
    const appliedIds = new Set(progress.appliedControlIds);

    for (const control of controls) {
      if (!hasSelectedChoice(control)) continue;
      const selected = control.options.find((option) => option.selected && !option.disabled);
      if (isAvailabilityChoice(control) && selected && /^(?:no|false|unavailable)$/i.test(selected.label.trim())) {
        resolvedIds.delete(control.id);
        appliedIds.delete(control.id);
        progress.decisions = progress.decisions.filter((decision) => decision.controlId !== control.id);
      } else {
        resolvedIds.add(control.id);
        appliedIds.add(control.id);
      }
    }

    const candidates = controls.filter((control) => !resolvedIds.has(control.id));
    console.info(`[JobFill Choice] Tab ${tabId}: detected ${controls.length} radio/checkbox controls; preparing ${candidates.length} candidates (${resolvedIds.size} already resolved)`, controls.map((control) => ({
      id: control.id,
      kind: control.kind,
      question: control.question,
      isCandidate: !resolvedIds.has(control.id),
      options: control.options.map((option) => ({ label: option.label, disabled: option.disabled, selected: option.selected })),
    })));

    if (candidates.length) {
      let profile: UserProfile | undefined;
      let userId: string | null = null;
      try {
        profile = await cloudGetProfile();
        console.info(`[JobFill Choice] Tab ${tabId}: profile loaded successfully`);
      } catch (error) {
        console.warn(`[JobFill Choice] Tab ${tabId}: profile unavailable for choice pipeline`, error);
      }
      try {
        userId = (await getCurrentUser())?.id ?? null;
        console.info(`[JobFill Choice] Tab ${tabId}: user ID ${userId ? 'available' : 'unavailable'}`);
      } catch (error) {
        console.warn(`[JobFill Choice] Tab ${tabId}: user unavailable for choice document/memory lookup`, error);
      }

      const decisions: ChoiceDecision[] = [];
      const unresolved: ChoiceControl[] = [];
      const evidenceByControl = new Map<string, ChoiceEvidence>();
      for (const control of candidates) {
        const profileFacts = profile ? getRelevantProfileFacts(profile, control.question) : [];
        const relevantFormAnswers = getRelevantChoiceFormAnswers(
          control,
          formAnswers.map(({ question, answer }) => `${question}: ${answer}`),
        );
        const evidence: ChoiceEvidence = { profileFacts, memories: [], formAnswers: relevantFormAnswers };
        evidenceByControl.set(control.id, evidence);
        console.info(`[JobFill Choice] Tab ${tabId}: evaluating ${control.id}`, {
          kind: control.kind,
          question: control.question,
          profileFactCount: profileFacts.length,
          profileFacts: profileFacts.slice(0, 5),
          relevantFormAnswerCount: relevantFormAnswers.length,
          relevantFormAnswers,
        });

        const cached = await getCachedChoice(control, evidence);
        if (cached) {
          decisions.push(cached);
          console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✓ resolved from choice cache`, { selectedOptionIds: cached.selectedOptionIds, confidence: cached.confidence });
          continue;
        }
        const profileDecision = profile ? resolveChoiceFromProfile(control, profile) : null;
        if (profileDecision && profileDecision.confidence >= 0.9) {
          decisions.push(profileDecision);
          await cacheChoice(control, evidence, profileDecision);
          console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✓ resolved from profile`, { selectedOptionIds: profileDecision.selectedOptionIds, confidence: profileDecision.confidence });
          continue;
        }
        console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✗ profile resolver ${profileDecision ? `returned low confidence (${profileDecision.confidence})` : 'returned null'}`);
        const formDecision = resolveChoiceFromEvidence(control, relevantFormAnswers, 'form');
        if (formDecision && formDecision.confidence >= 0.85) {
          decisions.push(formDecision);
          await cacheChoice(control, evidence, formDecision);
          console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✓ resolved from same-form evidence`, { selectedOptionIds: formDecision.selectedOptionIds, confidence: formDecision.confidence });
          continue;
        }
        console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✗ form evidence resolver ${formDecision ? `returned low confidence (${formDecision.confidence})` : 'returned null'} → will try memory + AI`);
        unresolved.push(control);
      }

      console.info(`[JobFill Choice] Tab ${tabId}: after local resolvers: ${decisions.length} resolved, ${unresolved.length} unresolved → querying memory for unresolved`, {
        resolvedIds: decisions.map((d) => d.controlId),
        unresolvedIds: unresolved.map((c) => c.id),
      });

      const memoryResults = await Promise.all(unresolved.map(async (control) => {
        if (!userId) return { control, matches: [] as string[] };
        const options = control.options.filter((option) => !option.disabled).map((option) => option.label);
        const query = `Job application ${control.kind} question: ${control.question}. Options: ${options.join('; ')}`;
        return { control, matches: await searchMemory(userId, query) };
      }));
      const aiRequests: Array<{ control: ChoiceControl; evidence: ChoiceEvidence }> = [];
      for (const { control, matches } of memoryResults) {
        const evidence = evidenceByControl.get(control.id)!;
        evidence.memories = matches.slice(0, 5);
        console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} memory search returned ${matches.length} matches`, { matches: matches.slice(0, 3) });
        const cached = await getCachedChoice(control, evidence);
        if (cached) {
          decisions.push(cached);
          console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✓ resolved from cache (with memory key)`);
          continue;
        }
        const memoryDecision = resolveChoiceFromEvidence(control, evidence.memories);
        if (memoryDecision && memoryDecision.confidence >= 0.85) {
          decisions.push(memoryDecision);
          await cacheChoice(control, evidence, memoryDecision);
          console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✓ resolved from hybrid memory/document evidence`);
        } else {
          console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✗ memory resolver ${memoryDecision ? `returned low confidence (${memoryDecision.confidence})` : 'returned null'} → sending to AI`);
          aiRequests.push({ control, evidence });
        }
      }

      console.info(`[JobFill Choice] Tab ${tabId}: sending ${aiRequests.length} controls to AI resolver`, aiRequests.map(({ control }) => ({ id: control.id, question: control.question })));
      const aiDecisions = await resolveChoicesWithAI(aiRequests);
      console.info(`[JobFill Choice] Tab ${tabId}: OpenRouter resolved ${aiDecisions.length}/${aiRequests.length} radio/checkbox controls`, aiDecisions.map((d) => ({ controlId: d.controlId, selectedOptionIds: d.selectedOptionIds, confidence: d.confidence })));
      for (const decision of aiDecisions) {
        const control = candidates.find((item) => item.id === decision.controlId);
        const evidence = evidenceByControl.get(decision.controlId);
        if (control && evidence) await cacheChoice(control, evidence, decision);
        decisions.push(decision);
      }

      // Log controls that AI also couldn't resolve
      const decisionIds = new Set(decisions.map((decision) => decision.controlId));
      const stillUnresolved = candidates.filter((c) => !decisionIds.has(c.id));
      if (stillUnresolved.length) {
        console.warn(`[JobFill Choice] Tab ${tabId}: ${stillUnresolved.length} controls remain unresolved after all resolvers`, stillUnresolved.map((c) => ({ id: c.id, question: c.question })));
      }

      for (const control of candidates) {
        if (decisionIds.has(control.id)) continue;
        const evidence = evidenceByControl.get(control.id);
        if (!evidence) continue;
        const preference = resolveOptimisticJobAvailability(control, [
          ...evidence.profileFacts,
          ...evidence.memories,
          ...evidence.formAnswers,
        ]);
        if (preference) {
          console.info(`[JobFill Choice] Tab ${tabId}: ${control.id} ✓ resolved via optimistic job availability`, { selectedOptionIds: preference.selectedOptionIds });
          decisions.push(preference);
          decisionIds.add(control.id);
        }
      }

      const decisionsById = new Map(progress.decisions.map((decision) => [decision.controlId, decision]));
      for (const decision of decisions) decisionsById.set(decision.controlId, decision);
      progress.decisions = [...decisionsById.values()];
      progress.resolvedControlIds = [...new Set([...resolvedIds, ...decisions.map((decision) => decision.controlId)])];
      progress.appliedControlIds = [...appliedIds];
      await saveChoiceProgress(tabId, progress);
      console.info(`[JobFill Choice] Tab ${tabId}: ✅ prepared and stored ${decisions.length} decisions`, {
        decisions: decisions.map((d) => ({ controlId: d.controlId, source: d.source, confidence: d.confidence, selectedOptionIds: d.selectedOptionIds })),
      });
    } else {
      progress.resolvedControlIds = [...resolvedIds];
      progress.appliedControlIds = [...appliedIds];
      await saveChoiceProgress(tabId, progress);
      console.info(`[JobFill Choice] Tab ${tabId}: no candidates to resolve (all ${controls.length} controls already resolved)`);
    }

    if (progress.applyRequested || choiceApplyRequestedTabs.has(tabId)) {
      console.info(`[JobFill Choice] Tab ${tabId}: ▶ applying decisions (applyRequested=${progress.applyRequested})`);
      progress.applyRequested = true;
      await applyPreparedChoiceDecisions(tabId, frameId, progress);
      choiceApplyRequestedTabs.delete(tabId);
      pendingChoiceApplyTabs.delete(tabId);
    }
    else console.info(`[JobFill Choice] Tab ${tabId}: ⏸ waiting for Scan Current Page before applying prepared answers`);
  } catch (error) {
    console.warn(`[JobFill Choice] Tab ${tabId}: ❌ radio/checkbox pipeline failed`, error);
  } finally {
    runningChoiceTabs.delete(tabId);
    if (pendingChoiceApplyTabs.delete(tabId)) {
      const progress = choiceProgressByTab.get(tabId);
      if (progress?.applyRequested) {
        void applyPreparedChoiceDecisions(tabId, progress.frameId, progress).catch((error) => {
          console.warn(`[JobFill Choice] Tab ${tabId}: queued radio/checkbox apply failed`, error);
        });
      }
    }
  }
}

function getFileFieldLabel(field: PrescanResponse['scanResult']['fields'][number]): string {
  return [field.attributes.labelText, field.attributes.ariaLabel, field.attributes.name, field.attributes.id]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

async function uploadMatchedDocument(tabId: number, task: FileUploadTask): Promise<void> {
  if (!task.documentId) return;
  await updateFileUploadTask(tabId, task.fieldId, { status: 'UPLOADING' });
  try {
    const document = (await cloudLoadAllDocumentMetadata()).find((item) => item.id === task.documentId);
    if (!document) throw new Error('The matched document is no longer in your document library.');
    const blob = await cloudLoadDocumentBlob(document.id);
    const dataUrl = await blobToDataUrl(blob);
    const response = await chrome.tabs.sendMessage(
      tabId,
      {
        type: 'INJECT_FILE',
        selector: task.selector,
        fileName: document.originalName,
        mimeType: document.mimeType,
        dataUrl,
      },
      { frameId: task.frameId },
    ) as { success?: boolean; message?: string };
    if (!response?.success) throw new Error(response?.message || 'The selected file could not be attached.');
    await updateFileUploadTask(tabId, task.fieldId, { status: 'UPLOADED' });
  } catch (error) {
    await updateFileUploadTask(tabId, task.fieldId, {
      status: 'ERROR',
      error: error instanceof Error ? error.message : 'File upload failed.',
    });
  }
}

async function processFileUploadTasks(tabId: number, tasks: FileUploadTask[]): Promise<void> {
  let documents: StoredDocument[];
  try {
    documents = await cloudLoadAllDocumentMetadata();
  } catch (error) {
    await Promise.all(tasks.map((task) => updateFileUploadTask(tabId, task.fieldId, {
      status: 'ERROR',
      error: error instanceof Error ? error.message : 'Could not load your document library.',
    })));
    return;
  }

  await Promise.all(tasks.map(async (task) => {
    try {
      const expectedType = await classifyDocumentField(task.label, task.accept ?? '');
      if (!expectedType || expectedType === 'other') {
        throw new Error('Could not identify the document type requested by this upload field.');
      }

      const document = selectDocumentForUpload(documents, expectedType);
      if (!document) throw new Error(`No saved ${expectedType.replace(/_/g, ' ')} document was found.`);
      await updateFileUploadTask(tabId, task.fieldId, {
        expectedType,
        documentId: document.id,
        fileName: document.originalName,
        status: 'MATCHED',
        error: undefined,
      });

      if ((await getFileUploadState(tabId))?.autofillRequested) {
        await uploadMatchedDocument(tabId, { ...task, expectedType, documentId: document.id, fileName: document.originalName, status: 'MATCHED' });
      }
    } catch (error) {
      await updateFileUploadTask(tabId, task.fieldId, {
        status: 'ERROR',
        error: error instanceof Error ? error.message : 'Document matching failed.',
      });
    }
  }));
}

async function runFileUploadPipeline(
  tabId: number,
  frameId: number,
  url: string,
  fields: PrescanResponse['scanResult']['fields'],
): Promise<void> {
  const uploadFields = fields.filter((field) => field.category === 'FILE_UPLOAD');
  const tasks: FileUploadTask[] = uploadFields.map((field, index) => ({
    fieldId: `file${index}`,
    selector: field.selector,
    frameId,
    label: getFileFieldLabel(field),
    accept: field.attributes.accept,
    status: 'CLASSIFYING',
  }));
  await setFileUploadState({ tabId, url, autofillRequested: false, tasks });
  if (tasks.length > 0) void processFileUploadTasks(tabId, tasks);
}

async function triggerFileUploads(tabId: number): Promise<void> {
  const state = await getFileUploadState(tabId);
  if (!state) return;
  await setFileAutofillRequested(tabId, true);
  const readyState = await getFileUploadState(tabId);
  const matched = readyState?.tasks.filter((task) => task.status === 'MATCHED') ?? [];
  await Promise.all(matched.map((task) => uploadMatchedDocument(tabId, task)));
}

async function triggerQuestionAutofill(tabId: number, profileMappingPending: boolean): Promise<void> {
  const state = await getQuestionState(tabId);
  if (!state) {
    pendingQuestionAutofillTabs.set(tabId, true);
    return;
  }
  const retryTasks = state.tasks.filter((task) => task.status === 'ERROR');
  const animating = state.tasks.filter((task) =>
    ['RETRIEVING', 'GENERATING', 'READY_TO_FILL', 'ERROR'].includes(task.status),
  );
  const selectorsByFrame = new Map<number, string[]>();
  for (const task of animating) {
    const selectors = selectorsByFrame.get(task.frameId) ?? [];
    selectors.push(task.selector);
    selectorsByFrame.set(task.frameId, selectors);
  }
  for (const [frameId, selectors] of selectorsByFrame) {
    await chrome.tabs.sendMessage(tabId, { type: 'SET_QUESTION_PENDING', selectors, pending: true }, { frameId }).catch(() => undefined);
  }

  await Promise.all(retryTasks.map((task) => updateQuestionTask(tabId, task.fieldId, {
    status: 'RETRIEVING',
    answer: undefined,
    error: undefined,
  })));

  if (animating.some((task) => task.status === 'READY_TO_FILL')) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  await setQuestionAutofillRequested(tabId, true, profileMappingPending);
  const updatedState = await getQuestionState(tabId);
  if (!updatedState) return;
  if (profileMappingPending || isGoogleFormsUrl(updatedState.url)) {
    void fillLateProfileMappings(tabId, updatedState.frameId);
  }
  const ready = updatedState.tasks.filter((task) => task.status === 'READY_TO_FILL' && task.answer);
  await Promise.all(ready.map((task) => fillQuestionTask(tabId, task)));
  if (retryTasks.length > 0) {
    void processQuestionTasks(tabId, retryTasks.map((task) => ({
      ...task,
      status: 'RETRIEVING',
      answer: undefined,
      error: undefined,
    })));
  }
}

async function fillLateProfileMappings(tabId: number, frameId: number): Promise<void> {
  const questionState = await getQuestionState(tabId);
  if (!questionState?.autofillRequested) return;
  const result = await getTabResult(tabId);
  if (result?.status !== 'done' || !result.scanResult) return;
  await setQuestionAutofillRequested(tabId, true, false);
  const questionSelectors = new Set(result.scanResult.fields
    .filter((field) => field.category === 'FILE_UPLOAD')
    .map((field) => field.selector));
  const profileMappings = result.aiMappings.filter((mapping) => !questionSelectors.has(mapping.selector));
  if (profileMappings.length === 0) return;

  try {
    const profile = await cloudGetProfile();
    const userId = (await getCurrentUser())?.id ?? null;
    const mappings = await Promise.all(profileMappings.map(async (mapping) => {
      const profileValue = mapping.value || resolveProfileValue(profile, mapping.profileField);
      if (profileValue?.trim()) return { ...mapping, value: profileValue };
      if (!isGoogleFormsUrl(result.scanResult!.url) || !userId) return null;

      const field = result.scanResult!.fields.find((item) => item.selector === mapping.selector);
      const label = field?.attributes.labelText || field?.attributes.ariaLabel || mapping.profileField;
      const evidence = await searchMemory(userId, `${mapping.profileField} ${label}`);
      let documentValue: string | undefined;
      try {
        documentValue = await extractProfileFieldFromDocuments(label, mapping.profileField, evidence);
      } catch (error) {
        console.warn(`[JobFill BG] Tab ${tabId}: document evidence did not provide ${mapping.profileField}`, error);
      }
      return documentValue ? { ...mapping, value: documentValue } : null;
    }));
    const usableMappings = mappings.filter((mapping): mapping is FieldMapping => Boolean(mapping?.value.trim()));
    if (usableMappings.length > 0) {
      await chrome.tabs.sendMessage(tabId, { type: 'FILL_FIELDS', mappings: usableMappings }, { frameId });
    }
  } catch (error) {
    console.warn(`[JobFill BG] Tab ${tabId}: late profile mapping fill failed`, error);
  }
}

/**
 * Run the full pre-scan pipeline for a tab.
 * Errors are caught and stored as status:'error' — never crash the service worker.
 */
async function runPrescanPipeline(tabId: number, googleFormsFrameId?: number): Promise<void> {
  if (runningTabs.has(tabId)) {
    pendingPrescanTabs.add(tabId);
    return;
  }
  runningTabs.add(tabId);

  try {
    // Mark as running so popup knows to wait if it arrives early
    await setTabResult({
      tabId,
      scanResult: null,
      aiMappings: [],
      aiMappedCount: 0,
      status: 'running',
      fingerprint: null,
    });

    // Step 1: Detect job page on the relevant frame, not just the top-level shell.
    // Some ATS portals render the real application form inside a sub-frame, which
    // means main-frame detection can incorrectly classify the page as NOT_JOB.
    let frameId = googleFormsFrameId;
    if (frameId === undefined) {
      let detectedFrame: { frameId: number; response: DetectJobPageResponse } | null;
      try {
        detectedFrame = await detectJobFrame(tabId);
      } catch {
        await clearTabResult(tabId);
        return;
      }

      if (!detectedFrame || detectedFrame.response.classification === 'NOT_JOB') {
        console.log(`[JobFill BG] Tab ${tabId}: not a job page (no qualifying frame found), skipping pre-scan`);
        await setTabResult({
          tabId,
          scanResult: null,
          aiMappings: [],
          aiMappedCount: 0,
          status: 'not_job',
          fingerprint: null,
        });
        return;
      }
      frameId = detectedFrame.frameId;
      console.log(`[JobFill BG] Tab ${tabId}: job page detected (${detectedFrame.response.classification}) on frame ${frameId} — starting pre-scan`);
    } else {
      console.log(`[JobFill BG] Tab ${tabId}: using Google Forms frame ${frameId} — starting fast pre-scan`);
    }

    // Workday and other SPA forms can hydrate after document_idle. Wait for
    // visible controls and a short DOM quiet period before taking the one snapshot.
    let readiness: WaitForFormReadyResponse;
    try {
      readiness = await chrome.tabs.sendMessage(
        tabId,
        { type: 'WAIT_FOR_FORM_READY' },
        { frameId },
      ) as WaitForFormReadyResponse;
    } catch (err) {
      console.warn(`[JobFill BG] Tab ${tabId}: form readiness check failed on frame ${frameId}`, err);
      await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
      return;
    }

    if (!readiness?.ready) {
      console.warn(`[JobFill BG] Tab ${tabId}: no visible form became ready before timeout in frame ${frameId}`);
      await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
      return;
    }

    // Step 2: Pre-scan the relevant frame that actually holds the form.
    let prescanResp: PrescanResponse;
    try {
      prescanResp = await chrome.tabs.sendMessage(tabId, { type: 'PRESCAN' }, { frameId }) as PrescanResponse;
    } catch (err) {
      console.warn(`[JobFill BG] Tab ${tabId}: PRESCAN failed on frame ${frameId}`, err);
      await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
      return;
    }

    const { scanResult, sanitizedFields, selectorLookup, fingerprint } = prescanResp;
    const isGoogleForm = isGoogleFormsUrl(scanResult.url);

    if (isGoogleForm) await clearQuestionState(tabId);
    else await runQuestionPipeline(tabId, frameId, scanResult.url, scanResult.fields);
    void runChoicePipeline(tabId, frameId, scanResult.url);
    try {
      await runFileUploadPipeline(tabId, frameId, scanResult.url, scanResult.fields);
    } catch (error) {
      console.warn(`[JobFill BG] Tab ${tabId}: file upload pipeline setup failed`, error);
    }
    await setTabResult({
      tabId,
      scanResult,
      aiMappings: [],
      aiMappedCount: 0,
      aiMappingComplete: false,
      status: 'running',
      fingerprint,
    });

    let profile: UserProfile | undefined;
    try {
      profile = await cloudGetProfile();
    } catch (error) {
      console.warn(`[JobFill BG] Tab ${tabId}: profile unavailable before mapping`, error);
    }

    // Step 3: Check fingerprint cache for AI mappings
    const cached = await getCachedMapping(fingerprint);
    const cachedSelectors = new Set(cached?.aiMappings.map((mapping) => mapping.selector) ?? []);
    const hasUnmappedFallbackField = scanResult.fields.some((field) => {
      if ((field.category === 'UNKNOWN' || field.category === 'APPLICATION_QUESTION') && !cachedSelectors.has(field.selector)) return true;
      if (field.category !== 'SAFE_AUTO' || !field.profileField || cachedSelectors.has(field.selector)) return false;
      return !profile || !resolveProfileValue(profile, field.profileField)?.trim();
    });
    if (cached && !hasUnmappedFallbackField && (!isGoogleForm || (cached.googleFormMappingVersion === GOOGLE_FORM_MAPPING_VERSION && cached.aiMappingComplete))) {
      console.log(`[JobFill BG] Tab ${tabId}: fingerprint cache HIT (${fingerprint.slice(0, 8)}...) — no AI needed`);
      const fileSelectors = new Set(scanResult.fields
        .filter((field) => field.category === 'FILE_UPLOAD')
        .map((field) => field.selector));
      const cachedAiMappings = cached.aiMappings.filter((mapping) => !fileSelectors.has(mapping.selector));
      for (const mapping of cachedAiMappings) {
        const field = scanResult.fields.find((item) => item.selector === mapping.selector);
        if (!field) continue;
        field.profileField = mapping.profileField;
        field.category = 'SAFE_AUTO';
        field.confidence = mapping.confidence;
      }
      await setTabResult({
        tabId,
        scanResult,
        aiMappings: cachedAiMappings,
        aiMappedCount: cachedAiMappings.length,
        aiMappingComplete: true,
        googleFormMappingVersion: isGoogleForm ? GOOGLE_FORM_MAPPING_VERSION : undefined,
        status: 'done',
        fingerprint,
      });
      await fillLateProfileMappings(tabId, frameId);
      return;
    }

    if (isGoogleForm) {
      for (const field of scanResult.fields) {
        const normalizedLabel = (field.attributes.labelText ?? '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();
        if (/^(reg|registration|roll) no(?:mber)?$/.test(normalizedLabel) || normalizedLabel === 'name') {
          field.profileField = null;
          field.category = 'UNKNOWN';
          field.confidence = 0;
        }
      }

      const fallbackSelectors = new Set(scanResult.fields.flatMap((field) => {
        if (field.category === 'APPLICATION_QUESTION') return [field.selector];
        if (field.category === 'UNKNOWN') return [field.selector];
        if (field.category !== 'SAFE_AUTO' || !field.profileField) return [];
        const value = profile ? resolveProfileValue(profile, field.profileField) : undefined;
        return field.confidence >= 0.85 && value?.trim() ? [] : [field.selector];
      }));
      const aiCandidates = getGoogleFormAICandidates(sanitizedFields, selectorLookup, fallbackSelectors);
      let aiMappings: FieldMapping[] = [];
      let aiMappedCount = 0;
      let aiMappingComplete = aiCandidates.fields.length === 0;

      if (aiCandidates.fields.length > 0 && aiCandidates.intentKeys.length > 0) {
        try {
          console.info(`[JobFill BG] Tab ${tabId}: sending ${aiCandidates.fields.length} unmapped, low-confidence, or empty-value Google Forms fields to AI`, aiCandidates.fields.map((field) => field.label));
          const aiResponse = await mapFieldsWithAI(aiCandidates.fields, {
            googleForm: true,
            allowedIntentKeys: aiCandidates.intentKeys,
            intentDescriptions: GOOGLE_FORM_INTENT_DESCRIPTIONS,
            timeoutMs: 15000,
          });
          aiMappingComplete = aiResponse.completed === true;

          for (const [fieldId, profileField] of Object.entries(aiResponse.mappings)) {
            const selector = selectorLookup[fieldId];
            if (!selector) continue;
            const value = profile ? resolveProfileValue(profile, profileField) : undefined;
            if (!value?.trim()) continue;

            aiMappings.push({ selector, profileField, value, confidence: 0.75 });
            const mappedField = scanResult.fields.find((field) => field.selector === selector);
            if (mappedField) {
              mappedField.profileField = profileField;
              mappedField.category = 'SAFE_AUTO';
              mappedField.confidence = 0.75;
            }
          }

          aiMappedCount = aiMappings.length;
        } catch (error) {
          console.warn(`[JobFill BG] Tab ${tabId}: Google Forms AI mapping failed; keeping local matches`, error);
        }
      }

      if (aiMappingComplete) {
        await setCachedMapping({
          fingerprint,
          aiMappings,
          aiMappedCount,
          googleFormMappingVersion: GOOGLE_FORM_MAPPING_VERSION,
          aiMappingComplete: true,
          cachedAt: new Date().toISOString(),
        });
      }

      await setTabResult({
        tabId,
        scanResult,
        aiMappings,
        aiMappedCount,
        aiMappingComplete,
        googleFormMappingVersion: GOOGLE_FORM_MAPPING_VERSION,
        status: 'done',
        fingerprint,
      });
      await runQuestionPipeline(tabId, frameId, scanResult.url, scanResult.fields);
      await fillLateProfileMappings(tabId, frameId);
      if (scanResult.mappedFields > 0) {
        chrome.action.setBadgeText({ text: String(scanResult.mappedFields), tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6', tabId });
      }
      console.log(`[JobFill BG] Tab ${tabId}: Google Forms mapping ${aiMappingComplete ? 'complete' : 'incomplete'}. ${scanResult.mappedFields} fields ready; ${aiMappedCount} mapped by AI.`);
      return;
    }

    // Finish profile matching before scheduling any question-answer work.
    const fallbackSelectors = new Set(scanResult.fields.flatMap((field) => {
      if (field.category === 'UNKNOWN' || field.category === 'APPLICATION_QUESTION') return [field.selector];
      if (field.category !== 'SAFE_AUTO' || !field.profileField) return [];
      const value = profile ? resolveProfileValue(profile, field.profileField) : undefined;
      return value?.trim() ? [] : [field.selector];
    }));
    let aiMappings: FieldMapping[] = [];
    let aiMappedCount = 0;
    const aiCandidates = getGoogleFormAICandidates(sanitizedFields, selectorLookup, fallbackSelectors);
    if (aiCandidates.fields.length > 0) {
      console.log(`[JobFill BG] Tab ${tabId}: sending ${aiCandidates.fields.length} unmatched or empty-value fields to AI profile mapping`);
        try {
          const aiResponse = await mapFieldsWithAI(aiCandidates.fields, {
            allowedIntentKeys: ALL_INTENT_KEYS,
            timeoutMs: 15000,
          });

          for (const candidate of aiCandidates.fields) {
            const selector = selectorLookup[candidate.fieldId];
            if (!selector) continue;
            const profileField = aiResponse.mappings[candidate.fieldId];
            const value = profileField && profile ? resolveProfileValue(profile, profileField) : undefined;
            if (profileField && value?.trim()) {
              aiMappings.push({ selector, profileField, value, confidence: 0.75 });
              const field = scanResult.fields.find((item) => item.selector === selector);
              if (field) {
                field.profileField = profileField;
                field.category = 'SAFE_AUTO';
                field.confidence = 0.75;
              }
              continue;
            }

          }

          aiMappedCount = aiMappings.length;
          scanResult.mappedFields = scanResult.fields.filter((f) => f.category === 'SAFE_AUTO').length;
          scanResult.unknownFields = scanResult.fields.filter((f) => f.category === 'UNKNOWN').length;
        } catch (aiErr) {
          console.warn(`[JobFill BG] Tab ${tabId}: AI profile mapping failed; no Pipeline 2 tasks were started`, aiErr);
        }
    }

    // Step 5: Cache AI results by fingerprint so future visits are instant
    if (aiMappings.length > 0) {
      await setCachedMapping({
        fingerprint,
        aiMappings,
        aiMappedCount,
        cachedAt: new Date().toISOString(),
      });
    }

    // Step 6: Store final result for popup pickup
    await setTabResult({ tabId, scanResult, aiMappings, aiMappedCount, aiMappingComplete: true, status: 'done', fingerprint });
    await fillLateProfileMappings(tabId, frameId);
    console.log(`[JobFill BG] Tab ${tabId}: pre-scan complete. ${scanResult.mappedFields} fields ready.`);

    // Update badge
    if (scanResult.mappedFields > 0) {
      chrome.action.setBadgeText({ text: String(scanResult.mappedFields), tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6', tabId });
    }
  } catch (err) {
    console.error(`[JobFill BG] Tab ${tabId}: pipeline error`, err);
    await setTabResult({ tabId, scanResult: null, aiMappings: [], aiMappedCount: 0, status: 'error', fingerprint: null });
  } finally {
    runningTabs.delete(tabId);
    if (pendingPrescanTabs.delete(tabId)) {
      void runPrescanPipeline(tabId);
    } else if (pendingGoogleFormFrames.has(tabId)) {
      const pendingFrameId = pendingGoogleFormFrames.get(tabId)!;
      pendingGoogleFormFrames.delete(tabId);
      void getTabResult(tabId).then((result) => {
        if (!result || result.status === 'not_job' || result.status === 'error' || !result.scanResult?.totalFields) {
          void runPrescanPipeline(tabId, pendingFrameId);
        }
      });
    }
  }
}

export default defineBackground(() => {
  console.log('[JobFill] Background service worker started.');

  // Clear badge on tab switch
  chrome.tabs.onActivated.addListener(async () => {
    await chrome.action.setBadgeText({ text: '' });
  });

  // Clear cached result when user navigates away (new URL = new form)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      await clearTabResult(tabId);
      await clearQuestionState(tabId);
      await clearFileUploadState(tabId);
      await clearChoiceProgress(tabId);
      runningTabs.delete(tabId);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, _sendResponse) => {
    if (message.type === 'REQUEST_PRESCAN') {
      const tabId = message.tabId;
      if (Number.isInteger(tabId) && !runningTabs.has(tabId)) {
        void findGoogleFormsFrameId(tabId).then((frameId) => {
          if (!runningTabs.has(tabId)) void runPrescanPipeline(tabId, frameId ?? undefined);
        });
      }
      return false;
    }

    if (message.type === 'TRIGGER_AUTOFILL') {
      const tabId = message.tabId;
      if (Number.isInteger(tabId)) void triggerQuestionAutofill(tabId, message.profileMappingPending === true);
      return false;
    }

    if (message.type === 'TRIGGER_FILE_UPLOADS') {
      const tabId = message.tabId;
      if (Number.isInteger(tabId)) void triggerFileUploads(tabId);
      return false;
    }

    if (message.type === 'TRIGGER_CHOICE_AUTOFILL') {
      const tabId = message.tabId;
      if (Number.isInteger(tabId)) void requestChoiceApply(tabId);
      return false;
    }

    // Content script notifies us it's loaded and ready
    if (message.type === 'PAGE_READY') {
      const tabId = sender.tab?.id;
      if (tabId == null) return false;

      const frameId = sender.frameId ?? 0;
      const frameUrl = sender.url ?? (typeof message.url === 'string' ? message.url : '');
      const isGoogleFormsFrame = isGoogleFormsUrl(frameUrl);
      const isGoogleSitesShell = frameId === 0 && /^https:\/\/sites\.google\.com\//i.test(frameUrl);
      if (isGoogleSitesShell) return false;
      if (frameId !== 0 && !isGoogleFormsFrame) return false;
      if (runningTabs.has(tabId)) {
        if (isGoogleFormsFrame) pendingGoogleFormFrames.set(tabId, frameId);
        return false;
      }

      if (isGoogleFormsFrame) {
        void getTabResult(tabId).then((result) => {
          if (runningTabs.has(tabId)) {
            pendingGoogleFormFrames.set(tabId, frameId);
          } else if (!result || result.status === 'not_job' || result.status === 'error' || !result.scanResult?.totalFields) {
            void runPrescanPipeline(tabId, frameId);
          }
        });
        return false;
      }

      // Kick off background pre-scan pipeline (fire-and-forget — errors handled internally)
      runPrescanPipeline(tabId);
      return false;
    }

    if (message.type === 'FORM_STRUCTURE_CHANGED') {
      const tabId = sender.tab?.id;
      if (tabId == null || sender.frameId !== 0) return false;

      void Promise.all([clearTabResult(tabId), clearQuestionState(tabId), clearFileUploadState(tabId), clearChoiceProgress(tabId)]).then(async () => {
        await chrome.runtime.sendMessage({ type: 'FORM_STRUCTURE_UPDATED', tabId }).catch((err) => {
          console.warn(`[JobFill BG] Tab ${tabId}: popup update notification failed`, err);
        });
        await runPrescanPipeline(tabId);
      });
      return false;
    }

    if (message.type === 'UPDATE_BADGE') {
      chrome.action.setBadgeText({ text: message.count > 0 ? String(message.count) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#8b5cf6' });
    }

    return false;
  });
});
