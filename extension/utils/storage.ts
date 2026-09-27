// ============================================================
// Profile Storage
// ============================================================
// Phase 3: Encrypted IndexedDB vault via Web Crypto API.
// The public API (getProfile, saveProfile, etc.) is unchanged
// so all consumers continue to work without modification.
// ============================================================

import { type UserProfile, createEmptyProfile } from '../types/profile';
import {
  initVault,
  saveToVault,
  loadFromVault,
  migrateFromChromeStorage,
  destroyVault,
} from './vault';

/**
 * Initialize the vault with a password.
 * If there's existing plain-text data, it will be migrated automatically.
 */
export async function setupVault(password: string): Promise<UserProfile> {
  // Check for legacy data to migrate
  const legacyProfile = await migrateFromChromeStorage();
  const initialData = legacyProfile ?? createEmptyProfile();

  await initVault(password, initialData);
  return initialData;
}

/**
 * Load the user's profile from the vault.
 * The vault must be unlocked first.
 */
export async function getProfile(): Promise<UserProfile> {
  try {
    return await loadFromVault();
  } catch (err) {
    console.error('[PersonalCopilot] Failed to load profile:', err);
    return createEmptyProfile();
  }
}

/**
 * Save the full profile to the vault.
 */
export async function saveProfile(profile: UserProfile): Promise<void> {
  try {
    await saveToVault(profile);
  } catch (err) {
    console.error('[PersonalCopilot] Failed to save profile:', err);
    throw err;
  }
}

/**
 * Update a specific section of the profile without overwriting the rest.
 */
export async function updateProfileSection<K extends keyof UserProfile>(
  section: K,
  data: UserProfile[K],
): Promise<UserProfile> {
  const profile = await getProfile();
  profile[section] = data;
  await saveProfile(profile);
  return profile;
}

/**
 * Clear all stored profile data by destroying the vault.
 */
export async function clearProfile(): Promise<void> {
  await destroyVault();
}
