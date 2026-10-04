import type { StoredDocument, DocumentType } from '../types/document';
import { inferDocumentType } from '../types/document';

const REGISTRY_KEY = 'jf_document_registry';

type RegistryMetadata = Pick<StoredDocument, 'documentType' | 'tags' | 'version' | 'isPrimary'>;
type RegistryStore = Record<string, RegistryMetadata>;

function readRegistry(): Promise<RegistryStore> {
  return new Promise((resolve) => {
    chrome.storage.local.get([REGISTRY_KEY], (result) => {
      resolve((result[REGISTRY_KEY] as RegistryStore) ?? {});
    });
  });
}

function writeRegistry(registry: RegistryStore): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [REGISTRY_KEY]: registry }, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function inferTags(document: StoredDocument, documentType: DocumentType): string[] {
  const words = `${document.originalName} ${document.name}`
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  return [...new Set([documentType.replace(/_/g, ' '), ...words])];
}

function inferVersion(document: StoredDocument): string | undefined {
  return document.originalName.match(/\b(?:20\d{2}|v\d+(?:\.\d+)*)\b/i)?.[0];
}

export function withInferredDocumentMetadata(document: StoredDocument): StoredDocument {
  const documentType = document.documentType ?? inferDocumentType(document.originalName || document.name, document.category);
  return {
    ...document,
    documentType,
    tags: document.tags?.length ? document.tags : inferTags(document, documentType),
    version: document.version ?? inferVersion(document),
    isPrimary: document.isPrimary ?? false,
  };
}

export async function saveDocumentRegistryMetadata(document: StoredDocument): Promise<void> {
  try {
    const registry = await readRegistry();
    const metadata = withInferredDocumentMetadata(document);
    registry[document.id] = {
      documentType: metadata.documentType,
      tags: metadata.tags,
      version: metadata.version,
      isPrimary: metadata.isPrimary,
    };
    await writeRegistry(registry);
  } catch (error) {
    console.warn('[Documents] Could not persist local registry metadata:', error);
  }
}

export async function mergeDocumentRegistryMetadata(documents: StoredDocument[]): Promise<StoredDocument[]> {
  const registry = await readRegistry();
  const enriched = documents.map((document) => withInferredDocumentMetadata({
    ...document,
    ...registry[document.id],
  }));
  const types = [...new Set(enriched.map((document) => document.documentType))];

  for (const documentType of types) {
    const sameType = enriched.filter((document) => document.documentType === documentType);
    const primary = sameType.find((document) => document.isPrimary)
      ?? [...sameType].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0];
    for (const document of sameType) {
      document.isPrimary = document.id === primary?.id;
      registry[document.id] = {
        documentType: document.documentType,
        tags: document.tags,
        version: document.version,
        isPrimary: document.isPrimary,
      };
    }
  }

  await writeRegistry(registry);
  return enriched;
}

export async function deleteDocumentRegistryMetadata(documentId: string): Promise<void> {
  const registry = await readRegistry();
  delete registry[documentId];
  await writeRegistry(registry);
}
