import type { StoredDocument, DocumentType } from '../types/document';
import { CATEGORY_ICONS, DOCUMENT_TYPE_LABELS, formatFileSize, isImageType, isWordType } from '../types/document';

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
}

export default function DocumentCard({ doc, onDownload, onEdit, onPreview, onProcess, onConvertToPdf, converting = false, onDelete, onDocumentTypeChange, onUploadToPage }: DocumentCardProps) {
  const isImage = isImageType(doc.mimeType);
  const isPdf = doc.mimeType === 'application/pdf';
  const isWord = isWordType(doc.mimeType) || /\.docx?$/i.test(doc.originalName);
  const icon = CATEGORY_ICONS[doc.category];
  const typeLabel = doc.mimeType.split('/')[1]?.toUpperCase() || doc.originalName.split('.').pop()?.toUpperCase() || 'FILE';

  return (
    <div className="doc-card animate-fade-in">
      {/* Thumbnail */}
      <div className="doc-card-thumb">
        {doc.thumbnail ? (
          <img
            src={doc.thumbnail}
            alt={doc.name}
            className="doc-card-thumb-img"
          />
        ) : (
          <div className="doc-card-thumb-placeholder">
            <span>{icon}</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="doc-card-info">
        <div className="doc-card-name" title={doc.name}>{doc.name}</div>
        <div className="doc-card-meta">
          <span>{formatFileSize(doc.sizeBytes)}</span>
          {doc.width && doc.height && <span> · {doc.width}×{doc.height}</span>}
          <span> · {typeLabel}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '5px', fontSize: '0.68rem', color: 'var(--color-pc-text-muted)' }}>
            Type
            <select
              value={doc.documentType ?? 'other'}
              onChange={(event) => onDocumentTypeChange(doc, event.target.value as DocumentType)}
              style={{ maxWidth: '170px', padding: '2px 4px', fontSize: '0.68rem' }}
            >
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {doc.isPrimary ? <span title="Preferred document for this type">Primary</span> : null}
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="doc-card-actions">
        {onUploadToPage && (
          <button className="btn btn-ghost btn-sm" onClick={() => onUploadToPage(doc)} title="Upload to current page" style={{ color: 'var(--color-pc-success)' }}>📤</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => onDownload(doc)} title="Download original">⬇</button>
        {isImage && (
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(doc)} title="Edit / Resize image">✏️</button>
        )}
        {isPdf && (
          <button className="btn btn-ghost btn-sm" onClick={() => onPreview(doc)} title="Preview PDF">👁</button>
        )}
        {isWord && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => onConvertToPdf(doc)}
            title="Convert Word document to PDF with PDF.co"
            aria-label={`Convert ${doc.originalName} to PDF`}
            disabled={converting}
            style={{ color: 'var(--color-pc-accent-mid)' }}
          >
            {converting ? '…' : 'PDF'}
          </button>
        )}
        {(isPdf || isWord) && (
          <button className="btn btn-ghost btn-sm" onClick={() => onProcess(doc)} title="PDF Tools — compress, convert, edit…" style={{ color: 'var(--color-pc-accent-mid)' }}>
            ⚙️
          </button>
        )}
        <button className="btn btn-danger btn-sm" onClick={() => onDelete(doc)} title="Delete">🗑</button>
      </div>
    </div>
  );
}
