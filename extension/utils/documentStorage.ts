// ============================================================
// Document Storage — Encrypted IndexedDB
// ============================================================
// Stores documents (metadata + file blobs) encrypted in
// separate IndexedDB stores from profile data.
// Uses the same encryption key from the vault.
// ============================================================

import type { StoredDocument } from '../types/document';
import { getCachedKey } from './vault';
import { encrypt, decrypt } from './crypto';

const DB_NAME = 'personal_copilot_vault';
const DB_VERSION = 2;
const DOCS_META_STORE = 'documents_meta';
const DOCS_DATA_STORE = 'documents_data';

// ---- IndexedDB Helpers ----

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requireKey(): CryptoKey {
  const key = getCachedKey();
  if (!key) throw new Error('Vault is locked — cannot access documents');
  return key;
}

// ---- Blob ↔ Base64 conversion ----

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

// ---- Public API ----

/**
 * Save a document (metadata + file blob) to encrypted storage.
 */
export async function saveDocument(
  metadata: StoredDocument,
  blob: Blob,
): Promise<void> {
  const key = requireKey();
  const db = await openDB();

  // Encrypt metadata
  const encryptedMeta = await encrypt(metadata, key);

  // Encrypt blob (convert to base64 first, then encrypt as string)
  const blobBase64 = await blobToBase64(blob);
  const encryptedData = await encrypt(blobBase64, key);

  // Write both in a single transaction
  return new Promise((resolve, reject) => {
    const tx = db.transaction([DOCS_META_STORE, DOCS_DATA_STORE], 'readwrite');

    tx.objectStore(DOCS_META_STORE).put({
      id: metadata.id,
      encrypted: encryptedMeta,
    });

    tx.objectStore(DOCS_DATA_STORE).put({
      id: metadata.id,
      encrypted: encryptedData,
    });

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

/**
 * Load and decrypt all document metadata (for listing in the UI).
 */
export async function loadAllDocumentMetadata(): Promise<StoredDocument[]> {
  const key = requireKey();
  const db = await openDB();

  const records: Array<{ id: string; encrypted: { iv: string; ciphertext: string } }> =
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DOCS_META_STORE, 'readonly');
      const store = tx.objectStore(DOCS_META_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });

  // Decrypt all metadata in parallel
  const decrypted = await Promise.all(
    records.map((r) => decrypt<StoredDocument>(r.encrypted, key)),
  );

  return decrypted;
}

/**
 * Load and decrypt a single document's file blob by ID.
 */
export async function loadDocumentBlob(id: string): Promise<Blob> {
  const key = requireKey();
  const db = await openDB();

  const record = await new Promise<{ id: string; encrypted: { iv: string; ciphertext: string } } | null>(
    (resolve, reject) => {
      const tx = db.transaction(DOCS_DATA_STORE, 'readonly');
      const store = tx.objectStore(DOCS_DATA_STORE);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    },
  );

  if (!record) throw new Error(`Document not found: ${id}`);

  const base64 = await decrypt<string>(record.encrypted, key);
  return base64ToBlob(base64);
}

/**
 * Delete a document (both metadata and blob).
 */
export async function deleteDocument(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([DOCS_META_STORE, DOCS_DATA_STORE], 'readwrite');

    tx.objectStore(DOCS_META_STORE).delete(id);
    tx.objectStore(DOCS_DATA_STORE).delete(id);

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

/**
 * Get the count of stored documents (without decryption).
 */
export async function getDocumentCount(): Promise<number> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_META_STORE, 'readonly');
    const store = tx.objectStore(DOCS_META_STORE);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
