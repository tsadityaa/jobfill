// ============================================================
// Profile Cache — short-lived, memory-only
// ============================================================
// Autofill pipelines (question, choice, dropdown, prescan, late mapping) each need the
// user profile. Without a cache every call costs two Supabase round trips.
//
// Stored in chrome.storage.session: shared between the popup and the background service
// worker, kept in memory only (never written to disk), and cleared when the browser closes.
// Entries are keyed by user id so one account can never read another account's profile.
// ============================================================

import type { UserProfile } from '../types/profile';

const CACHE_KEY = 'jobfill_profile_cache';
/** Short TTL: bounds staleness even if an invalidation signal is ever missed. */
const CACHE_TTL_MS = 60_000;

export interface CachedProfile {
  userId: string;
  profile: UserProfile;
  hasSavedProfile: boolean;
  fetchedAt: number;
}

function sessionStorageArea(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' ? chrome.storage?.session ?? null : null;
}

export async function readProfileCache(userId: string): Promise<CachedProfile | null> {
  const area = sessionStorageArea();
  if (!area) return null;
  try {
    const stored = (await area.get(CACHE_KEY))[CACHE_KEY] as CachedProfile | undefined;
    if (!stored || stored.userId !== userId) return null;
    if (Date.now() - stored.fetchedAt > CACHE_TTL_MS) return null;
    return stored;
  } catch {
    return null;
  }
}

export async function writeProfileCache(userId: string, profile: UserProfile, hasSavedProfile: boolean): Promise<void> {
  const area = sessionStorageArea();
  if (!area) return;
  try {
    const entry: CachedProfile = { userId, profile, hasSavedProfile, fetchedAt: Date.now() };
    await area.set({ [CACHE_KEY]: entry });
  } catch {
    // A cache failure must never break autofill; the next read simply goes to Supabase.
  }
}

export async function clearProfileCache(): Promise<void> {
  const area = sessionStorageArea();
  if (!area) return;
  try {
    await area.remove(CACHE_KEY);
  } catch {
    // Ignore: see writeProfileCache.
  }
}
