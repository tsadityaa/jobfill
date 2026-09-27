// ============================================================
// Crypto Engine — Web Crypto API
// ============================================================
// AES-256-GCM encryption with PBKDF2 key derivation.
// No keys or passwords are ever stored — only the salt and
// encrypted data live on disk.
// ============================================================

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH = 256; // bits
const SALT_LENGTH = 16; // bytes
const IV_LENGTH = 12; // bytes (recommended for AES-GCM)

// ---- Helpers: Base64 ↔ ArrayBuffer ----

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---- Key Derivation ----

/**
 * Generate a cryptographically random salt.
 */
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return bufferToBase64(salt.buffer);
}

/**
 * Derive an AES-256-GCM key from a password and salt using PBKDF2.
 */
export async function deriveKey(
  password: string,
  saltBase64: string,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  const salt = base64ToBuffer(saltBase64);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    true, // extractable — needed for session caching
    ['encrypt', 'decrypt'],
  );
}

// ---- Session Key Caching Helpers ----

/**
 * Export a CryptoKey to a base64 string for session storage.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

/**
 * Import a base64 string back into a CryptoKey.
 */
export async function importKey(base64: string): Promise<CryptoKey> {
  const raw = base64ToBuffer(base64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: KEY_LENGTH },
    true, // keep extractable for potential re-export
    ['encrypt', 'decrypt'],
  );
}

/**
 * Create a verification hash from the derived key.
 * Used to confirm the user entered the correct password
 * without storing the password itself.
 */
export async function createVerificationHash(
  password: string,
  saltBase64: string,
): Promise<string> {
  const encoder = new TextEncoder();
  // Use a different salt derivation for verification (append ':verify')
  const verifySalt = saltBase64 + ':verify';
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const salt = new TextEncoder().encode(verifySalt);

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );

  return bufferToBase64(bits);
}

// ---- Encryption / Decryption ----

/**
 * Encrypt a JSON-serializable object.
 * Returns base64-encoded IV and ciphertext.
 */
export async function encrypt(
  data: unknown,
  key: CryptoKey,
): Promise<{ iv: string; ciphertext: string }> {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(data));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );

  return {
    iv: bufferToBase64(iv.buffer),
    ciphertext: bufferToBase64(encrypted),
  };
}

/**
 * Decrypt an encrypted payload back to its original object.
 * Throws if the key is wrong (GCM auth tag will fail).
 */
export async function decrypt<T = unknown>(
  encryptedData: { iv: string; ciphertext: string },
  key: CryptoKey,
): Promise<T> {
  const iv = base64ToBuffer(encryptedData.iv);
  const ciphertext = base64ToBuffer(encryptedData.ciphertext);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    ciphertext,
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(decrypted)) as T;
}
