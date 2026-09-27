// ============================================================
// Vault Type Definitions
// ============================================================
// Data structures for the encrypted vault storage system.
// ============================================================

/**
 * Metadata stored alongside the encrypted vault.
 * This is NOT encrypted — it's needed to derive the key.
 */
export interface VaultMetadata {
  /** Random salt used for PBKDF2 key derivation (base64) */
  salt: string;
  /** Hash of the derived key for password verification (base64) */
  verificationHash: string;
  /** ISO 8601 timestamp of vault creation */
  createdAt: string;
  /** ISO 8601 timestamp of last modification */
  updatedAt: string;
  /** Schema version for future migrations */
  version: number;
}

/**
 * The encrypted data payload stored in IndexedDB.
 */
export interface EncryptedPayload {
  /** Initialization vector for AES-GCM (base64) */
  iv: string;
  /** Encrypted data (base64) */
  ciphertext: string;
}

/**
 * Current state of the vault.
 */
export type VaultState = 'uninitialized' | 'locked' | 'unlocked';

/**
 * Complete vault record stored in IndexedDB.
 */
export interface VaultRecord {
  id: 'primary';
  metadata: VaultMetadata;
  data: EncryptedPayload;
}
