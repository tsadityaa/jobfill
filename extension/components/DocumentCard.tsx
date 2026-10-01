import type { StoredDocument } from '../types/document';
import { CATEGORY_ICONS, formatFileSize, isImageType, isWordType } from '../types/document';

interface DocumentCardProps {
  doc: StoredDocument;
  onDownload: (doc: StoredDocument) => void;
  onEdit: (doc: StoredDocument) => void;
  onPreview: (doc: StoredDocument) => void;
  onProcess: (doc: StoredDocument) => void;
  onDelete: (doc: StoredDocument) => void;
}

export default function DocumentCard({ doc, onDownload, onEdit, onPreview, onProcess, onDelete }: DocumentCardProps) {
  const isImage = isImageType(doc.mimeType);
  const isPdf = doc.mimeType === 'application/pdf';
  const isWord = isWordType(doc.mimeType);
  const icon = CATEGORY_ICONS[doc.category];

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
          <span> · {doc.mimeType.split('/')[1].toUpperCase()}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="doc-card-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => onDownload(doc)} title="Download original">⬇</button>
        {isImage && (
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(doc)} title="Edit / Resize image">✏️</button>
        )}
        {isPdf && (
          <button className="btn btn-ghost btn-sm" onClick={() => onPreview(doc)} title="Preview PDF">👁</button>
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
