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
        /* ================= ACTIVE STATE WITH DOCUMENT TOOLBAR ================= */
        <div className="doc-card-v3-expanded">
          <div className="doc-card-v3-expanded-header">
            <div className="doc-card-v3-expanded-thumb">{renderThumbnail(false)}</div>
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
            </div>
          </div>

          <div className="doc-card-v3-toolbar" aria-label="Document actions">
            <button type="button" className="doc-card-v3-toolbar-btn" title="Preview" onClick={(e) => handleAction(e, () => onPreview(doc))}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg><span>Preview</span>
            </button>
            <button type="button" className="doc-card-v3-toolbar-btn download" title="Download" onClick={(e) => handleAction(e, () => onDownload(doc))}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Download</span>
            </button>
            <button type="button" className="doc-card-v3-toolbar-btn" title="Edit / Process" onClick={handleEditClick}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg><span>Edit</span>
            </button>
            <button type="button" className="doc-card-v3-toolbar-btn" title="Replace file" onClick={handleReplaceClick} disabled={!onReplace}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span>Replace</span>
            </button>
            <span className="doc-card-v3-toolbar-divider" aria-hidden="true" />
            <button type="button" className="doc-card-v3-toolbar-btn delete" title="Delete document" onClick={(e) => handleAction(e, () => onDelete(doc))}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>Delete</span>
            </button>
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
