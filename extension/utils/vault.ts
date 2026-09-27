// ============================================================
// Vault — Encrypted IndexedDB Storage
// ============================================================
// Manages the encrypted vault lifecycle: init, lock, unlock,
// read, write, and migration from chrome.storage.local.
// ============================================================

import type { UserProfile } from '../types/profile';
import type { VaultMetadata, EncryptedPayload, VaultState, VaultRecord } from '../types/vault';
import {
  generateSalt,
  deriveKey,
  createVerificationHash,
  encrypt,
  decrypt,
  exportKey,
  importKey,
} from './crypto';

const DB_NAME = 'personal_copilot_vault';
const DB_VERSION = 2;
const STORE_NAME = 'vault';
const DOCS_META_STORE = 'documents_meta';
const DOCS_DATA_STORE = 'documents_data';
const RECORD_ID = 'primary';

// ---- In-memory state (never persisted) ----

let cachedKey: CryptoKey | null = null;
let cachedState: VaultState = 'uninitialized';

const SESSION_KEY_NAME = 'vault_session_key';

// ---- Session Key Caching ----

/**
 * Cache the derived CryptoKey to chrome.storage.session.
 * Session storage is in-memory only and cleared when the browser exits.
 */
async function cacheKeyToSession(key: CryptoKey): Promise<void> {
  try {
    const exported = await exportKey(key);
    await chrome.storage.session.set({ [SESSION_KEY_NAME]: exported });
  } catch (err) {
    // Silently fail — session caching is a convenience, not critical
    console.warn('[PersonalCopilot] Failed to cache session key:', err);
  }
}

/**
 * Try to restore a CryptoKey from chrome.storage.session.
 * Returns null if no cached key exists or restoration fails.
 */
export async function tryRestoreSession(): Promise<CryptoKey | null> {
  try {
    const result = await chrome.storage.session.get(SESSION_KEY_NAME);
    const exported = result[SESSION_KEY_NAME] as string | undefined;
    if (!exported) return null;

    const key = await importKey(exported);
    // Verify the key actually works by trying to decrypt
    cachedKey = key;
    cachedState = 'unlocked';
    return key;
  } catch (err) {
    console.warn('[PersonalCopilot] Session key restoration failed:', err);
    // Clear invalid session data
    await clearSessionKey();
    return null;
  }
}

/**
 * Clear the cached session key.
 */
async function clearSessionKey(): Promise<void> {
  try {
    await chrome.storage.session.remove(SESSION_KEY_NAME);
  } catch {
    // Ignore
  }
}

// ---- IndexedDB Helpers ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      // Phase 4: Document stores
      if (!db.objectStoreNames.contains(DOCS_META_STORE)) {
        db.createObjectStore(DOCS_META_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(DOCS_DATA_STORE)) {
        db.createObjectStore(DOCS_DATA_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get the cached encryption key (for use by document storage).
 * Returns null if the vault is locked.
 */
export function getCachedKey(): CryptoKey | null {
  return cachedKey;
}

async function getRecord(): Promise<VaultRecord | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(RECORD_ID);

    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function putRecord(record: VaultRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(record);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function deleteRecord(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(RECORD_ID);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ---- Public API ----

/**
 * Check the current vault state.
 */
export async function getVaultState(): Promise<VaultState> {
  if (cachedState === 'unlocked') return 'unlocked';

  const record = await getRecord();
  if (!record) {
    cachedState = 'uninitialized';
  } else {
    cachedState = cachedKey ? 'unlocked' : 'locked';
  }
  return cachedState;
}

/**
 * Initialize a new vault with a password.
 * Encrypts the provided profile data (or an empty profile).
 */
export async function initVault(
  password: string,
  initialData: UserProfile,
): Promise<void> {
  const salt = generateSalt();
  const key = await deriveKey(password, salt);
  const verificationHash = await createVerificationHash(password, salt);

  const encrypted = await encrypt(initialData, key);

  const now = new Date().toISOString();
  const record: VaultRecord = {
    id: RECORD_ID,
    metadata: {
      salt,
      verificationHash,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    data: encrypted,
  };

  await putRecord(record);

  // Cache the key in memory and session
  cachedKey = key;
  cachedState = 'unlocked';
  await cacheKeyToSession(key);
}

/**
 * Unlock the vault with a password.
 * Verifies the password and caches the key in memory.
 * Returns the decrypted profile data.
 */
export async function unlockVault(password: string): Promise<UserProfile> {
  const record = await getRecord();
  if (!record) {
    throw new Error('Vault is not initialized');
  }

  // Verify password
  const hash = await createVerificationHash(password, record.metadata.salt);
  if (hash !== record.metadata.verificationHash) {
    throw new Error('Incorrect password');
  }

  // Derive key and decrypt
  const key = await deriveKey(password, record.metadata.salt);
  const profile = await decrypt<UserProfile>(record.data, key);

  // Cache the key in memory and session
  cachedKey = key;
  cachedState = 'unlocked';
  await cacheKeyToSession(key);

  return profile;
}

/**
 * Lock the vault — clear the in-memory key.
 */
export async function lockVault(): Promise<void> {
  cachedKey = null;
  cachedState = 'locked';
  await clearSessionKey();
}

/**
 * Save profile data to the vault (must be unlocked).
 */
export async function saveToVault(profile: UserProfile): Promise<void> {
  if (!cachedKey) {
    throw new Error('Vault is locked');
  }

  const record = await getRecord();
  if (!record) {
    throw new Error('Vault is not initialized');
  }

  const encrypted = await encrypt(profile, cachedKey);

  record.data = encrypted;
  record.metadata.updatedAt = new Date().toISOString();

  await putRecord(record);
}

/**
 * Load profile data from the vault (must be unlocked).
 */
export async function loadFromVault(): Promise<UserProfile> {
  if (!cachedKey) {
    throw new Error('Vault is locked');
  }

  const record = await getRecord();
  if (!record) {
    throw new Error('Vault is not initialized');
  }

  return decrypt<UserProfile>(record.data, cachedKey);
}

/**
 * Check if there is existing plain-text data in chrome.storage.local
 * that needs to be migrated.
 */
export async function hasLegacyData(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get('personal_copilot_profile');
    return !!result['personal_copilot_profile'];
  } catch {
    return false;
  }
}

/**
 * Migrate existing plain-text profile data from chrome.storage.local
 * into the encrypted vault, then delete the plain-text data.
 */
export async function migrateFromChromeStorage(): Promise<UserProfile | null> {
  try {
    const result = await chrome.storage.local.get('personal_copilot_profile');
    const profile = result['personal_copilot_profile'] as UserProfile | undefined;

    if (profile) {
      // Delete the plain-text data after successful read
      await chrome.storage.local.remove('personal_copilot_profile');
      return profile;
    }
  } catch (err) {
    console.error('[PersonalCopilot] Migration read failed:', err);
  }
  return null;
}

/**
 * Completely destroy the vault — delete all data from IndexedDB.
 * This is irreversible.
 */
export async function destroyVault(): Promise<void> {
  await deleteRecord();
  cachedKey = null;
  cachedState = 'uninitialized';
}
