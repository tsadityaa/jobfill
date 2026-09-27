// ============================================================
// Document Type Definitions
// ============================================================

/**
 * Metadata for a stored document.
 * The actual file data (blob) is stored separately.
 */
export interface StoredDocument {
  id: string;
  /** User-facing name, e.g. "My Resume" */
  name: string;
  /** Original filename from upload, e.g. "IMG_2024.jpg" */
  originalName: string;
  /** MIME type, e.g. "image/jpeg", "application/pdf" */
  mimeType: string;
  /** Document category */
  category: DocumentCategory;
  /** File size in bytes */
  sizeBytes: number;
  /** Image width in pixels (images only) */
  width?: number;
  /** Image height in pixels (images only) */
  height?: number;
  /** Small base64 data URL for card UI thumbnails */
  thumbnail?: string;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-modified timestamp */
  updatedAt: string;
}

export type DocumentCategory = 'resume' | 'photo' | 'id' | 'certificate' | 'other';

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  resume: 'Resume / CV',
  photo: 'Photo',
  id: 'ID Document',
  certificate: 'Certificate',
  other: 'Other',
};

export const CATEGORY_ICONS: Record<DocumentCategory, string> = {
  resume: '📄',
  photo: '📸',
  id: '🪪',
  certificate: '🎓',
  other: '📎',
};

/**
 * Options for processing an image.
 */
export interface ProcessingOptions {
  targetWidth?: number;
  targetHeight?: number;
  targetFormat?: 'image/jpeg' | 'image/png' | 'image/webp';
  quality?: number; // 0.0 - 1.0 for lossy formats
  cropRect?: CropRect;
  /** Max file size in KB. Uses binary search on quality to hit target. */
  maxSizeKB?: number;
}

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pre-built processing presets for common job portal requirements.
 */
export interface ProcessingPreset {
  name: string;
  description: string;
  options: ProcessingOptions;
}

export const PROCESSING_PRESETS: ProcessingPreset[] = [
  {
    name: 'LinkedIn Photo',
    description: '400×400 JPEG, under 8MB',
    options: { targetWidth: 400, targetHeight: 400, targetFormat: 'image/jpeg', quality: 0.92 },
  },
  {
    name: 'Passport Photo',
    description: '600×600 JPEG, under 1MB',
    options: { targetWidth: 600, targetHeight: 600, targetFormat: 'image/jpeg', quality: 0.85, maxSizeKB: 1024 },
  },
  {
    name: 'Small Thumbnail',
    description: '150×150 JPEG, compressed',
    options: { targetWidth: 150, targetHeight: 150, targetFormat: 'image/jpeg', quality: 0.8 },
  },
  {
    name: 'Job Portal Photo',
    description: '300×300 JPEG, under 500KB',
    options: { targetWidth: 300, targetHeight: 300, targetFormat: 'image/jpeg', quality: 0.85, maxSizeKB: 500 },
  },
  {
    name: 'High Quality PNG',
    description: 'Original size, PNG format',
    options: { targetFormat: 'image/png' },
  },
];

/**
 * Supported image MIME types for processing.
 */
export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
];

/**
 * All supported document MIME types.
 */
export const SUPPORTED_DOCUMENT_TYPES = [
  ...SUPPORTED_IMAGE_TYPES,
  'application/pdf',
];

export function isImageType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(mimeType);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function guessCategoryFromFile(file: File): DocumentCategory {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.includes('resume') || name.includes('cv')) {
    return 'resume';
  }
  if (name.includes('passport') || name.includes('license') || name.includes('id')) {
    return 'id';
  }
  if (name.includes('cert') || name.includes('diploma') || name.includes('degree')) {
    return 'certificate';
  }
  if (file.type.startsWith('image/')) {
    return 'photo';
  }
  return 'other';
}
