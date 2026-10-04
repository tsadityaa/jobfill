import type { QuestionTask, TabQuestionState } from '../types/questionTask';

const QUESTION_TASKS_KEY = 'jf_question_tasks';
type QuestionTaskStore = Record<number, TabQuestionState>;
let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<QuestionTaskStore> {
  return new Promise((resolve) => {
    chrome.storage.local.get([QUESTION_TASKS_KEY], (result) => {
      resolve((result[QUESTION_TASKS_KEY] as QuestionTaskStore) ?? {});
    });
  });
}

async function writeStore(store: QuestionTaskStore): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [QUESTION_TASKS_KEY]: store }, resolve);
  });
}

function mutateStore(mutator: (store: QuestionTaskStore) => void): Promise<void> {
  const operation = writeQueue.then(async () => {
    const store = await readStore();
    mutator(store);
    await writeStore(store);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function getQuestionState(tabId: number): Promise<TabQuestionState | null> {
  await writeQueue;
  return (await readStore())[tabId] ?? null;
}

export async function setQuestionState(state: TabQuestionState): Promise<void> {
  return mutateStore((store) => {
    store[state.tabId] = state;
  });
}

export async function updateQuestionTask(tabId: number, fieldId: string, patch: Partial<QuestionTask>): Promise<void> {
  return mutateStore((store) => {
    const state = store[tabId];
    if (!state) return;
    state.tasks = state.tasks.map((task) => task.fieldId === fieldId ? { ...task, ...patch } : task);
    store[tabId] = state;
  });
}

export async function setQuestionAutofillRequested(tabId: number, requested: boolean, profileMappingPending = false): Promise<void> {
  return mutateStore((store) => {
    const state = store[tabId];
    if (state) {
      state.autofillRequested = requested;
      state.profileMappingPending = profileMappingPending;
    }
  });
}

export async function clearQuestionState(tabId: number): Promise<void> {
  return mutateStore((store) => {
    delete store[tabId];
  });
}