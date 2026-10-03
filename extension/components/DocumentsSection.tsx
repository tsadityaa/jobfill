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
  cloudSaveDocument as saveDocument,
  cloudLoadAllDocumentMetadata as loadAllDocumentMetadata,
  cloudLoadDocumentBlob as loadDocumentBlob,
  cloudDeleteDocument as deleteDocument,
} from '../utils/cloudStorage';
import { generateId } from '../types/profile';
import DocumentCard from './DocumentCard';
import ImageEditor from './ImageEditor';
import PdfViewer from './PdfViewer';
import PdfProcessor from './PdfProcessor';
import { getCurrentUser } from '../utils/supabase';
import { addMemory } from '../utils/memory';
import { downloadResult, uploadToPdfCo, pdfToText, wordToPdf } from '../utils/pdfco';

const CATEGORIES: Array<'all' | DocumentCategory> = ['all', 'resume', 'photo', 'id', 'certificate', 'other'];

function getUploadMimeType(file: File): string | null {
  if (SUPPORTED_DOCUMENT_TYPES.includes(file.type.toLowerCase())) return file.type.toLowerCase();
  if (/\.docx$/i.test(file.name)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (/\.doc$/i.test(file.name)) return 'application/msword';
  return null;
}

export default function DocumentsSection() {
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'all' | DocumentCategory>('all');
  const [dragOver, setDragOver] = useState(false);
  const [convertingDocId, setConvertingDocId] = useState<string | null>(null);
  const [conversionNotice, setConversionNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image editor state
  const [editorDocId, setEditorDocId] = useState<string | null>(() => sessionStorage.getItem('pc_editorDocId'));
  const [editorBlob, setEditorBlob] = useState<Blob | null>(null);

  // PDF viewer state
  const [previewDocId, setPreviewDocId] = useState<string | null>(() => sessionStorage.getItem('pc_previewDocId'));
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  // PDF processor state
  const [processorDocId, setProcessorDocId] = useState<string | null>(() => sessionStorage.getItem('pc_processorDocId'));

  useEffect(() => {
    if (editorDocId) sessionStorage.setItem('pc_editorDocId', editorDocId);
    else sessionStorage.removeItem('pc_editorDocId');
  }, [editorDocId]);

  useEffect(() => {
    if (previewDocId) sessionStorage.setItem('pc_previewDocId', previewDocId);
    else sessionStorage.removeItem('pc_previewDocId');
  }, [previewDocId]);

  useEffect(() => {
    if (processorDocId) sessionStorage.setItem('pc_processorDocId', processorDocId);
    else sessionStorage.removeItem('pc_processorDocId');
  }, [processorDocId]);

  const editorDoc = documents.find(d => d.id === editorDocId) || null;
  const previewDoc = documents.find(d => d.id === previewDocId) || null;
  const processorDoc = documents.find(d => d.id === processorDocId) || null;

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
      const mimeType = getUploadMimeType(file);
      if (!mimeType) {
        console.warn(`Unsupported file type: ${file.type}`);
        continue;
      }

      try {
        const id = generateId();
        const category = mimeType.includes('word') || mimeType.includes('officedocument')
          ? 'resume'
          : guessCategoryFromFile(file);
        const isImage = isImageType(mimeType);
        // Word files get a document icon thumbnail placeholder

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
          mimeType,
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
        
        // --- Memory Engine: Ingest Resume ---
        if (category === 'resume' && mimeType === 'application/pdf') {
          try {
            const user = await getCurrentUser();
            if (user) {
              console.log('[Memory] Extracting resume text...');
              const url = await uploadToPdfCo(file, file.name);
              const text = await pdfToText(url);
              
              if (text && text.trim().length > 0) {
                const contentToStore = `Document Category: ${category}\nFile Name: ${file.name}\n\nContent:\n${text}`;
                await addMemory(user.id, contentToStore, { type: category, filename: file.name });
                console.log('[Memory] Document successfully saved to memory graph.');
              }
            }
          } catch (memErr) {
            console.error('[Memory] Failed to extract/save resume memory:', memErr);
          }
        }
        
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
      setEditorDocId(doc.id);
      setEditorBlob(blob);
    } catch (err) {
      console.error('Failed to load document for editing:', err);
    }
  }, []);

  // Open PDF viewer
  const handlePreview = useCallback(async (doc: StoredDocument) => {
    try {
      const blob = await loadDocumentBlob(doc.id);
      setPreviewDocId(doc.id);
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

  // Upload document to current page's file input
  const handleUploadToPage = useCallback(async (doc: StoredDocument) => {
    try {
      const blob = await loadDocumentBlob(doc.id);

      // Convert blob to base64 data URL
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });

      // Get the active tab and send the file data to the content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        console.error('No active tab found');
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'INJECT_FILE',
        fileName: doc.originalName,
        mimeType: doc.mimeType,
        dataUrl,
      });

      if (response?.success) {
        console.log(`[Docs] File "${doc.originalName}" uploaded to page.`);
      } else {
        console.warn(`[Docs] File upload failed: ${response?.message}`);
      }
    } catch (err) {
      console.error('Upload to page failed:', err);
    }
  }, []);

  const handleConvertWordToPdf = useCallback(async (doc: StoredDocument) => {
    setConvertingDocId(doc.id);
    setConversionNotice(null);
    try {
      setConversionNotice({ type: 'success', message: `Uploading ${doc.originalName} to PDF.co…` });
      const sourceBlob = await loadDocumentBlob(doc.id);
      const sourceUrl = await uploadToPdfCo(sourceBlob, doc.originalName);
      setConversionNotice({ type: 'success', message: 'Converting Word document to PDF…' });
      const resultUrl = await wordToPdf(sourceUrl);
      const resultBlob = await downloadResult(resultUrl);
      const pdfBlob = resultBlob.type === 'application/pdf'
        ? resultBlob
        : new Blob([resultBlob], { type: 'application/pdf' });
      const outputName = `${doc.originalName.replace(/\.docx?$/i, '')}.pdf`;
      const now = new Date().toISOString();
      const pdfDocument: StoredDocument = {
        id: generateId(),
        name: outputName.replace(/\.pdf$/i, ''),
        originalName: outputName,
        mimeType: 'application/pdf',
        category: doc.category,
        sizeBytes: pdfBlob.size,
        createdAt: now,
        updatedAt: now,
      };

      await saveDocument(pdfDocument, pdfBlob);
      setDocuments((current) => [pdfDocument, ...current]);
      setConversionNotice({ type: 'success', message: `Saved ${outputName} to Documents.` });
    } catch (err) {
      setConversionNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Word-to-PDF conversion failed.',
      });
    } finally {
      setConvertingDocId(null);
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
          accept={`${SUPPORTED_DOCUMENT_TYPES.join(',')},.doc,.docx`}
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
          Images, PDF, Word (.doc, .docx)
        </div>
      </div>

      {conversionNotice && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: '8px',
            padding: '8px 10px',
            border: `1px solid ${conversionNotice.type === 'error' ? 'var(--color-pc-error)' : 'var(--color-pc-border)'}`,
            borderRadius: '6px',
            color: conversionNotice.type === 'error' ? 'var(--color-pc-error)' : 'var(--color-pc-text-secondary)',
            fontSize: '0.74rem',
          }}
        >
          {conversionNotice.message}
        </div>
      )}

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
              onProcess={(d) => setProcessorDocId(d.id)}
              onConvertToPdf={handleConvertWordToPdf}
              converting={convertingDocId !== null}
              onDelete={handleDelete}
              onUploadToPage={handleUploadToPage}
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
            setEditorDocId(null);
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
            setPreviewDocId(null);
            setPreviewBlob(null);
          }}
        />
      )}

      {/* PDF Processor Modal */}
      {processorDoc && (
        <PdfProcessor
          doc={processorDoc}
          onClose={() => setProcessorDocId(null)}
        />
      )}
    </div>
  );
}
