import { useState, useEffect, useRef, useCallback } from 'react';
import type { StoredDocument, DocumentCategory } from '../types/document';
import {
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  SUPPORTED_DOCUMENT_TYPES,
  isImageType,
  guessCategoryFromFile,
  formatFileSize,
} from '../types/document';
import { generateThumbnail, getImageDimensions } from '../utils/documentProcessor';
import {
  saveDocument,
  loadAllDocumentMetadata,
  loadDocumentBlob,
  deleteDocument,
} from '../utils/documentStorage';
import { generateId } from '../types/profile';
import DocumentCard from './DocumentCard';
import ImageEditor from './ImageEditor';
import PdfViewer from './PdfViewer';

const CATEGORIES: Array<'all' | DocumentCategory> = ['all', 'resume', 'photo', 'id', 'certificate', 'other'];

export default function DocumentsSection() {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'all' | DocumentCategory>('all');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image editor state
  const [editorDoc, setEditorDoc] = useState<StoredDocument | null>(null);
  const [editorBlob, setEditorBlob] = useState<Blob | null>(null);

  // PDF viewer state
  const [previewDoc, setPreviewDoc] = useState<StoredDocument | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  // Load documents on mount
  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const docs = await loadAllDocumentMetadata();
      docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setDocuments(docs);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setLoading(false);
    }
  };

  // Handle file upload
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setUploading(true);

    for (const file of Array.from(files)) {
      if (!SUPPORTED_DOCUMENT_TYPES.includes(file.type)) {
        console.warn(`Unsupported file type: ${file.type}`);
        continue;
      }

      try {
        const id = generateId();
        const category = guessCategoryFromFile(file);
        const isImage = isImageType(file.type);

        let width: number | undefined;
        let height: number | undefined;
        let thumbnail: string | undefined;

        if (isImage) {
          const dims = await getImageDimensions(file);
          width = dims.width;
          height = dims.height;
          thumbnail = await generateThumbnail(file, 80);
        }

        const now = new Date().toISOString();
        const metadata: StoredDocument = {
          id,
          name: file.name.replace(/\.[^.]+$/, ''), // Strip extension for display name
          originalName: file.name,
          mimeType: file.type,
          category,
          sizeBytes: file.size,
          width,
          height,
          thumbnail,
          createdAt: now,
          updatedAt: now,
        };

        await saveDocument(metadata, file);
        setDocuments((prev) => [metadata, ...prev]);
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
      }
    }

    setUploading(false);
  }, []);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  // Download original
  const handleDownload = useCallback(async (doc: StoredDocument) => {
    try {
      const blob = await loadDocumentBlob(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.originalName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, []);

  // Open image editor
  const handleEdit = useCallback(async (doc: StoredDocument) => {
    try {
      const blob = await loadDocumentBlob(doc.id);
      setEditorDoc(doc);
      setEditorBlob(blob);
    } catch (err) {
      console.error('Failed to load document for editing:', err);
    }
  }, []);

  // Open PDF viewer
  const handlePreview = useCallback(async (doc: StoredDocument) => {
    try {
      const blob = await loadDocumentBlob(doc.id);
      setPreviewDoc(doc);
      setPreviewBlob(blob);
    } catch (err) {
      console.error('Failed to load document for preview:', err);
    }
  }, []);

  // Delete document
  const handleDelete = useCallback(async (doc: StoredDocument) => {
    try {
      await deleteDocument(doc.id);
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, []);

  // Filter by category
  const filteredDocs = activeCategory === 'all'
    ? documents
    : documents.filter((d) => d.category === activeCategory);

  // ---- Render ----

  if (loading) {
    return (
      <div className="empty-state">
        Loading documents...
      </div>
    );
  }

  return (
    <div className="docs-section">
      {/* Upload Area */}
      <div
        className={`docs-upload-area ${dragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={SUPPORTED_DOCUMENT_TYPES.join(',')}
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) {
              handleFiles(e.target.files);
              e.target.value = ''; // Reset so same file can be uploaded again
            }
          }}
        />
        <div className="docs-upload-icon">
          {uploading ? '⏳' : '📁'}
        </div>
        <div className="docs-upload-text">
          {uploading
            ? 'Encrypting & saving...'
            : 'Drop files here or click to upload'}
        </div>
        <div className="docs-upload-hint">
          Images (JPEG, PNG, WebP) & PDF
        </div>
      </div>

      {/* Category Filter */}
      {documents.length > 0 && (
        <div className="docs-filter">
          {CATEGORIES.map((cat) => {
            const count = cat === 'all'
              ? documents.length
              : documents.filter((d) => d.category === cat).length;
            if (cat !== 'all' && count === 0) return null;
            return (
              <button
                key={cat}
                className={`docs-filter-chip ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat === 'all' ? '📋' : CATEGORY_ICONS[cat]} {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]}
                <span className="docs-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Document List */}
      {filteredDocs.length > 0 ? (
        <div className="docs-list">
          {filteredDocs.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              onDownload={handleDownload}
              onEdit={handleEdit}
              onPreview={handlePreview}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : documents.length > 0 ? (
        <div className="empty-state">
          No documents in this category
        </div>
      ) : (
        <div className="empty-state">
          No documents yet — upload your resume, photos, or certificates above
        </div>
      )}

      {/* Image Editor Modal */}
      {editorDoc && editorBlob && (
        <ImageEditor
          imageBlob={editorBlob}
          fileName={editorDoc.originalName}
          onClose={() => {
            setEditorDoc(null);
            setEditorBlob(null);
          }}
        />
      )}

      {/* PDF Viewer Modal */}
      {previewDoc && previewBlob && (
        <PdfViewer
          pdfBlob={previewBlob}
          fileName={previewDoc.originalName}
          onClose={() => {
            setPreviewDoc(null);
            setPreviewBlob(null);
          }}
        />
      )}
    </div>
  );
}
