import type { FileUploadTask, TabFileUploadState } from '../types/fileUploadTask';

const FILE_UPLOAD_TASKS_KEY = 'jf_file_upload_tasks';
type FileUploadTaskStore = Record<number, TabFileUploadState>;
let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<FileUploadTaskStore> {
  return new Promise((resolve) => {
    chrome.storage.local.get([FILE_UPLOAD_TASKS_KEY], (result) => {
      resolve((result[FILE_UPLOAD_TASKS_KEY] as FileUploadTaskStore) ?? {});
    });
  });
}

async function writeStore(store: FileUploadTaskStore): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [FILE_UPLOAD_TASKS_KEY]: store }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function mutateStore(mutator: (store: FileUploadTaskStore) => void): Promise<void> {
  const operation = writeQueue.then(async () => {
    const store = await readStore();
    mutator(store);
    await writeStore(store);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function getFileUploadState(tabId: number): Promise<TabFileUploadState | null> {
  await writeQueue;
  return (await readStore())[tabId] ?? null;
}

export async function setFileUploadState(state: TabFileUploadState): Promise<void> {
  return mutateStore((store) => {
    store[state.tabId] = state;
  });
}

export async function updateFileUploadTask(tabId: number, fieldId: string, patch: Partial<FileUploadTask>): Promise<void> {
  return mutateStore((store) => {
    const state = store[tabId];
    if (!state) return;
    state.tasks = state.tasks.map((task) => task.fieldId === fieldId ? { ...task, ...patch } : task);
    store[tabId] = state;
  });
}

export async function setFileAutofillRequested(tabId: number, requested: boolean): Promise<void> {
  return mutateStore((store) => {
    const state = store[tabId];
    if (state) state.autofillRequested = requested;
  });
}

export async function clearFileUploadState(tabId: number): Promise<void> {
  return mutateStore((store) => {
    delete store[tabId];
  });
}