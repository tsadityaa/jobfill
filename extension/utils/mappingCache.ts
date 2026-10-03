// ============================================================
// Mapping Cache
// ============================================================
// Persists AI field mappings keyed by form fingerprint in
// chrome.storage.local. This means:
//   - Same form on /jobs/123 and /jobs/456 → one AI call ever
//   - Popup reopened on same page → instant, no AI
//   - Cleared on extension update or user request
//
// Storage schema:
//   "jf_map_cache" → { [fingerprint: string]: CachedMapping }
//
// Also stores in-progress pre-scan results keyed by tabId so
// the popup can retrieve them without waiting.
// ============================================================

import type { ScanResult, FieldMapping } from '../types/autofill';

const CACHE_KEY = 'jf_map_cache';
const TAB_RESULT_KEY = 'jf_tab_results';
const MAX_CACHE_ENTRIES = 50; // keep storage bounded

export interface CachedMapping {
  fingerprint: string;
  aiMappings: FieldMapping[];
  aiMappedCount: number;
  /** ISO timestamp for TTL — mappings expire after 30 days */
  cachedAt: string;
}

export interface TabPrescanResult {
  tabId: number;
  /** null while still computing */
  scanResult: ScanResult | null;
  aiMappings: FieldMapping[];
  aiMappedCount: number;
  /** 'running' | 'done' | 'error' | 'not_job' */
  status: 'running' | 'done' | 'error' | 'not_job';
  fingerprint: string | null;
}

// ---- Fingerprint cache (AI mappings per form structure) ----

type FingerprintCache = Record<string, CachedMapping>;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function readFingerprintCache(): Promise<FingerprintCache> {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY], (result) => {
      resolve((result[CACHE_KEY] as FingerprintCache) ?? {});
    });
  });
}

async function writeFingerprintCache(cache: FingerprintCache): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

/** Look up a cached AI mapping by fingerprint. Returns null if not found or expired. */
export async function getCachedMapping(fingerprint: string): Promise<CachedMapping | null> {
  const cache = await readFingerprintCache();
  const entry = cache[fingerprint];
  if (!entry) return null;

  const age = Date.now() - new Date(entry.cachedAt).getTime();
  if (age > TTL_MS) {
    // Expired — purge it
    delete cache[fingerprint];
    await writeFingerprintCache(cache);
    return null;
  }

  return entry;
}

/** Store an AI mapping result for a fingerprint. Evicts oldest if over limit. */
export async function setCachedMapping(entry: CachedMapping): Promise<void> {
  const cache = await readFingerprintCache();
  cache[entry.fingerprint] = entry;

  // Evict oldest entries if over limit
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    const sorted = keys.sort(
      (a, b) => new Date(cache[a].cachedAt).getTime() - new Date(cache[b].cachedAt).getTime(),
    );
    delete cache[sorted[0]];
  }

  await writeFingerprintCache(cache);
}

// ---- Tab pre-scan result (background → popup handoff) ----

type TabResultStore = Record<number, TabPrescanResult>;

async function readTabResults(): Promise<TabResultStore> {
  return new Promise((resolve) => {
    chrome.storage.local.get([TAB_RESULT_KEY], (result) => {
      resolve((result[TAB_RESULT_KEY] as TabResultStore) ?? {});
    });
  });
}

async function writeTabResults(store: TabResultStore): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [TAB_RESULT_KEY]: store }, resolve);
  });
}

/** Store a pre-scan result (or in-progress placeholder) for a tab. */
export async function setTabResult(result: TabPrescanResult): Promise<void> {
  const store = await readTabResults();
  store[result.tabId] = result;
  await writeTabResults(store);
}

/** Get the pre-scan result for a tab. Returns null if not found. */
export async function getTabResult(tabId: number): Promise<TabPrescanResult | null> {
  const store = await readTabResults();
  return store[tabId] ?? null;
}

/** Clear the result for a specific tab (e.g. on navigation). */
export async function clearTabResult(tabId: number): Promise<void> {
  const store = await readTabResults();
  delete store[tabId];
  await writeTabResults(store);
}
