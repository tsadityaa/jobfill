import { useState, useEffect, useRef } from 'react';
import type { StoredDocument, DocumentType } from '../types/document';
import { formatFileSize, isImageType, isWordType } from '../types/document';
import { cloudLoadDocumentBlob } from '../utils/cloudStorage';
import { generateThumbnail } from '../utils/documentProcessor';
import { saveDocumentRegistryMetadata } from '../utils/documentRegistry';

// Global in-memory cache so thumbnails render instantaneously across tab switches and re-renders
const thumbnailMemoryCache = new Map<string, string>();

interface DocumentCardProps {
  doc: StoredDocument;
  onDownload: (doc: StoredDocument) => void;
  onEdit: (doc: StoredDocument) => void;
  onPreview: (doc: StoredDocument) => void;
  onProcess: (doc: StoredDocument) => void;
  onConvertToPdf: (doc: StoredDocument) => void;
  converting?: boolean;
  onDelete: (doc: StoredDocument) => void;
  onDocumentTypeChange: (doc: StoredDocument, documentType: DocumentType) => void;
  onUploadToPage?: (doc: StoredDocument) => void;
  onReplace?: (doc: StoredDocument, file: File) => void;
}

function getDocDisplayTag(doc: StoredDocument): string {
  const name = (doc.originalName || doc.name || '').toLowerCase();
  if (doc.documentType === 'resume' || /resume|cv|curriculum/i.test(name)) return 'Resume';
  if (doc.documentType === 'cover_letter' || /cover\s*letter/i.test(name)) return 'Cover letter';
  if (doc.documentType === 'photo' || /photo|headshot|profile/i.test(name) || isImageType(doc.mimeType)) return 'Photo';
  if (doc.documentType === 'id' || /passport|license|aadhaar|id\b/i.test(name)) return 'ID';
  if (doc.documentType === 'transcript' || /transcript|mark\s*sheet/i.test(name)) return 'Transcript';
  if (doc.documentType === 'degree_certificate' || /degree|diploma/i.test(name)) return 'Degree';
  if (doc.documentType === 'certificate' || /certificate|cert/i.test(name)) return 'Certificate';
  if (doc.documentType === 'portfolio' || /portfolio/i.test(name)) return 'Portfolio';
  if (/offer\s*letter/i.test(name)) return 'Offer letter';
  if (doc.tags && doc.tags[0]) return doc.tags[0];
  if (doc.category === 'resume') return 'Resume';
  if (doc.category === 'photo') return 'Photo';
  if (doc.category === 'id') return 'ID';
  if (doc.category === 'certificate') return 'Certificate';
  return 'Document';
}

function DocMiniPage({
  name,
  isPdf,
  isWord,
  isSquare = false,
}: {
  name: string;
  isPdf: boolean;
  isWord: boolean;
  isSquare?: boolean;
}) {
  const isResume = /resume|cv|curriculum/i.test(name);
  const isOffer = /offer|letter|appointment/i.test(name);

  return (
    <div className={`doc-mini-sheet ${isSquare ? 'doc-mini-sheet--square' : ''}`}>
      <div className="doc-mini-sheet-inner">
        {isResume ? (
          <div className="doc-mini-header doc-mini-header--resume">
            <div className="doc-mini-avatar-dot" />
            <div className="doc-mini-header-text">
              <div className="doc-mini-title-line" />
              <div className="doc-mini-sub-line" />
            </div>
          </div>
        ) : isOffer ? (
          <div className="doc-mini-header doc-mini-header--offer">
            <div className="doc-mini-crest" />
            <div className="doc-mini-header-text">
              <div className="doc-mini-title-line" />
            </div>
          </div>
        ) : (
          <div className="doc-mini-header">
            <div className={`doc-mini-accent-bar ${isWord ? 'doc-mini-accent--word' : 'doc-mini-accent--pdf'}`} />
            <div className="doc-mini-header-text">
              <div className="doc-mini-title-line" />
            </div>
          </div>
        )}

        <div className="doc-mini-divider" />

        <div className="doc-mini-lines">
          <div className="doc-mini-line w-95" />
          <div className="doc-mini-line w-80" />
          <div className="doc-mini-line w-100" />
          <div className="doc-mini-line w-70" />
          {!isSquare && (
            <>
              <div className="doc-mini-spacer" />
              <div className="doc-mini-line w-90" />
              <div className="doc-mini-line w-60" />
            </>
          )}
        </div>
      </div>

      <div className={`doc-mini-badge ${isWord ? 'doc-mini-badge--word' : 'doc-mini-badge--pdf'}`}>
        {isWord ? 'DOC' : 'PDF'}
      </div>
    </div>
  );
}

export default function DocumentCard({
  doc,
  onDownload,
  onEdit,
  onPreview,
  onProcess,
  onConvertToPdf,
  converting = false,
  onDelete,
  onDocumentTypeChange,
  onUploadToPage,
  onReplace,
}: DocumentCardProps) {
  const [isActive, setIsActive] = useState(false);
  const [localThumb, setLocalThumb] = useState<string | null>(() => {
    return doc.thumbnail || thumbnailMemoryCache.get(doc.id) || null;
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isImage = isImageType(doc.mimeType) || /\.(png|jpe?g|webp|gif|svg)$/i.test(doc.originalName);
  const isPdf = doc.mimeType === 'application/pdf' || /\.pdf$/i.test(doc.originalName);
  const isWord = isWordType(doc.mimeType) || /\.docx?$/i.test(doc.originalName);
  const typeLabel = doc.mimeType.split('/')[1]?.toUpperCase() || doc.originalName.split('.').pop()?.toUpperCase() || 'FILE';
  const tagLabel = getDocDisplayTag(doc);

  // Instant or cached thumbnail loader
  useEffect(() => {
    const existing = doc.thumbnail || thumbnailMemoryCache.get(doc.id);
    if (existing) {
      if (localThumb !== existing) setLocalThumb(existing);
      return;
    }

    if (isImage) {
      let active = true;
      cloudLoadDocumentBlob(doc.id)
        .then(async (blob) => {
          if (!active || !blob) return;
          // Generate lightweight base64 thumbnail (80px, ~2-3KB) for instantaneous caching
          try {
            const thumb = await generateThumbnail(blob, 80);
            if (!active) return;
            thumbnailMemoryCache.set(doc.id, thumb);
            setLocalThumb(thumb);
            // Persist into chrome.storage.local so it NEVER has to download over the network again!
            saveDocumentRegistryMetadata({ ...doc, thumbnail: thumb }).catch(() => {});
          } catch {
            if (!active) return;
            const url = URL.createObjectURL(blob);
            thumbnailMemoryCache.set(doc.id, url);
            setLocalThumb(url);
          }
        })
        .catch(() => { });
      return () => {
        active = false;
      };
    }
  }, [doc.id, doc.thumbnail, isImage]);

  // Close on Escape key
  useEffect(() => {
    if (!isActive) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setIsActive(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive]);

  const handleAction = (e: React.MouseEvent, action: () => void) => {
    e.stopPropagation();
    setIsActive(false);
    action();
  };

  const handleReplaceClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onReplace) {
      onReplace(doc, file);
      setIsActive(false);
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsActive(false);
    if (isImage) {
      onEdit(doc);
    } else if (isWord) {
      onConvertToPdf(doc);
    } else {
      onProcess(doc);
    }
  };

  const renderThumbnail = (isSquare = false) => {
    if (localThumb) {
      return <img src={localThumb} alt={doc.name} className="doc-card-thumb-img" />;
    }
    if (isImage) {
      return (
        <div className="doc-photo-placeholder doc-thumb-loading">
          <div className="doc-thumb-shimmer" />
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="doc-thumb-loading-icon">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
      );
    }
    return (
      <DocMiniPage
        name={doc.originalName || doc.name}
        isPdf={isPdf}
        isWord={isWord}
        isSquare={isSquare}
      />
    );
  };

  return (
    <div
      className={`doc-card-v3 ${isActive ? 'doc-card-v3--active' : ''}`}
      onClick={() => setIsActive((prev) => !prev)}
    >
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileChosen}
        accept={isImage ? 'image/*' : isPdf ? 'application/pdf' : isWord ? '.doc,.docx' : undefined}
      />

      {isActive ? (
        /* ================= ACTIVE STATE WITH RADIAL MENU ================= */
        <div className="doc-card-v3-active-body">
          {/* Left: Radial Cluster */}
          <div className="doc-radial-cluster" onClick={(e) => e.stopPropagation()}>
            {/* Background Multi-tier Glowing Neon Arc + Circuit Connectors */}
            <svg className="doc-radial-arc-svg" viewBox="0 0 136 104">
              <defs>
                <linearGradient id="neonArcGradient" x1="0%" y1="100%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.4" />
                  <stop offset="25%" stopColor="#00d4ff" stopOpacity="0.95" />
                  <stop offset="50%" stopColor="#e0f9ff" stopOpacity="1" />
                  <stop offset="75%" stopColor="#00d4ff" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#00d4ff" stopOpacity="0.4" />
                </linearGradient>

                <filter id="neonBeamGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="sharpBlur" />
                  <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="wideBlur" />
                  <feMerge>
                    <feMergeNode in="wideBlur" />
                    <feMergeNode in="sharpBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>

                <filter id="connectorGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" />
                </filter>
              </defs>

              {/* Circuit connector lines: each button → center (68, 70) */}
              {/* Download (68, 18) → center */}
              <line x1="68" y1="32" x2="68" y2="48" stroke="#00d4ff" strokeWidth="0.6" strokeOpacity="0.35" strokeDasharray="2 2" filter="url(#connectorGlow)" />
              {/* Preview (22, 28) → center */}
              <line x1="28" y1="42" x2="48" y2="58" stroke="#00d4ff" strokeWidth="0.6" strokeOpacity="0.3" strokeDasharray="2 2" filter="url(#connectorGlow)" />
              {/* Replace (114, 28) → center */}
              <line x1="108" y1="42" x2="88" y2="58" stroke="#00d4ff" strokeWidth="0.6" strokeOpacity="0.3" strokeDasharray="2 2" filter="url(#connectorGlow)" />
              {/* Delete (16, 72) → center */}
              <line x1="30" y1="78" x2="48" y2="72" stroke="#ff4455" strokeWidth="0.5" strokeOpacity="0.25" strokeDasharray="2 2" filter="url(#connectorGlow)" />
              {/* Edit (122, 72) → center */}
              <line x1="108" y1="78" x2="88" y2="72" stroke="#00d4ff" strokeWidth="0.6" strokeOpacity="0.3" strokeDasharray="2 2" filter="url(#connectorGlow)" />

              {/* Ambient glow track */}
              <path
                d="M 15 70 C 18 36, 42 6, 68 6 C 94 6, 118 36, 121 70"
                fill="none"
                stroke="#00d4ff"
                strokeWidth="3.5"
                strokeOpacity="0.2"
                filter="url(#neonBeamGlow)"
              />

              {/* Core electric laser beam */}
              <path
                className="doc-radial-arc-beam"
                d="M 15 70 C 18 36, 42 6, 68 6 C 94 6, 118 36, 121 70"
                fill="none"
                stroke="url(#neonArcGradient)"
                strokeWidth="1.8"
                filter="url(#neonBeamGlow)"
              />
            </svg>

            {/* Center: Document / Image Thumbnail */}
            <div className="doc-radial-thumb" onClick={() => setIsActive(false)}>
              {renderThumbnail(true)}
            </div>

            {/* Button 1: Download (Top Center) */}
            <div className="doc-radial-item doc-radial-item--download">
              <button
                className="doc-radial-btn doc-radial-btn--hero"
                title="Download"
                onClick={(e) => handleAction(e, () => onDownload(doc))}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <span className="doc-radial-label">Download</span>
            </div>

            {/* Button 2: Preview (Upper Left) */}
            <div className="doc-radial-item doc-radial-item--preview">
              <button
                className="doc-radial-btn"
                title="Preview"
                onClick={(e) => handleAction(e, () => onPreview(doc))}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <span className="doc-radial-label">Preview</span>
            </div>

            {/* Button 3: Replace (Upper Right) */}
            <div className="doc-radial-item doc-radial-item--replace">
              <button
                className="doc-radial-btn"
                title="Replace file"
                onClick={handleReplaceClick}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </button>
              <span className="doc-radial-label">Replace</span>
            </div>

            {/* Button 4: Delete (Lower Left - with red ring) */}
            <div className="doc-radial-item doc-radial-item--delete">
              <div className="doc-radial-ring--danger">
                <button
                  className="doc-radial-btn doc-radial-btn--danger"
                  title="Delete document"
                  onClick={(e) => handleAction(e, () => onDelete(doc))}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
              <span className="doc-radial-label">Delete</span>
            </div>

            {/* Button 5: Edit (Lower Right) */}
            <div className="doc-radial-item doc-radial-item--edit">
              <button
                className="doc-radial-btn"
                title="Edit / Process"
                onClick={handleEditClick}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
              <span className="doc-radial-label">Edit</span>
            </div>
          </div>

          {/* Right: Active Document Details */}
          <div className="doc-card-v3-details">
            <div className="doc-card-v3-title-row">
              <span className="doc-card-v3-title" title={doc.originalName || doc.name}>
                {doc.originalName || doc.name}
              </span>
              {doc.isPrimary && (
                <span className="doc-card-v3-primary-pill">Primary</span>
              )}
            </div>

            <div className="doc-card-v3-meta-row">
              <span className="doc-card-v3-meta-text">
                {formatFileSize(doc.sizeBytes)} &nbsp;·&nbsp; {typeLabel}
              </span>
              <span className="doc-card-v3-tag-pill">{tagLabel}</span>
            </div>

            <div
              className="doc-card-v3-esc"
              onClick={(e) => {
                e.stopPropagation();
                setIsActive(false);
              }}
            >
              <kbd className="doc-card-v3-kbd">Esc</kbd>
              <span>to close</span>
            </div>
          </div>
        </div>
      ) : (
        /* ================= INACTIVE / NORMAL STATE ================= */
        <div className="doc-card-v3-normal-body">
          {/* Thumbnail */}
          <div className="doc-card-v3-thumb-box">
            {renderThumbnail(false)}
          </div>

          {/* Info */}
          <div className="doc-card-v3-info">
            <div className="doc-card-v3-title-row">
              <span className="doc-card-v3-title" title={doc.originalName || doc.name}>
                {doc.originalName || doc.name}
              </span>
              {doc.isPrimary && (
                <span className="doc-card-v3-primary-pill">Primary</span>
              )}
            </div>
            <div className="doc-card-v3-meta-text">
              {formatFileSize(doc.sizeBytes)} &nbsp;·&nbsp; {typeLabel}
            </div>
            <div className="doc-card-v3-tags-area">
              <span className="doc-card-v3-tag-pill">{tagLabel}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
