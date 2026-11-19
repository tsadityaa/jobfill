import { useState, useCallback, useMemo, useEffect, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { StoredDocument } from '../types/document';
import { formatFileSize } from '../types/document';
import {
  uploadToPdfCo,
  downloadResult,
  compressPdf,
  mergePdfs,
  splitPdf,
  rotatePdf,
  protectPdf,
  unlockPdf,
  wordToPdf,
  pdfToWord,
  pdfToImages,
  pdfToText,
  ocrPdf,
  addPageNumbers,
  deletePdfPages,
  getPdfInfo,
  saveExtraKey,
  getExtraKeys,
  removeExtraKey,
} from '../utils/pdfco';
import { cloudLoadDocumentBlob as loadDocumentBlob, cloudLoadAllDocumentMetadata as loadAllDocumentMetadata } from '../utils/cloudStorage';

interface PdfProcessorProps {
  doc: StoredDocument;
  onClose: () => void;
}

type TabId = 'compress' | 'convert' | 'edit' | 'protect' | 'ocr' | 'info' | 'settings';

/* SVG icon components for the glass tab bar */
const TabIcons: Record<TabId, ReactElement> = {
  compress: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  convert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M21 21v-5h-5" />
    </svg>
  ),
  edit: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  protect: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
      <path d="M12 14v4M10 16h4" />
    </svg>
  ),
  ocr: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.5" cy="10.5" r="7.5" /><line x1="21" y1="21" x2="15.8" y2="15.8" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <line x1="12" y1="16" x2="12" y2="11" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
};

const TAB_LABELS: Record<TabId, string> = {
  compress: 'Compress',
  convert: 'Convert',
  edit: 'Edit',
  protect: 'Protect',
  ocr: 'OCR',
  info: 'Info',
  settings: 'Keys',
};

const TAB_ORDER: TabId[] = ['compress', 'convert', 'edit', 'protect', 'ocr', 'info', 'settings'];

export default function PdfProcessor({ doc, onClose }: PdfProcessorProps) {
  const [activeTab, setActiveTab] = useState<TabId>('convert');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);

  // Lock body height & scroll when PDF tools modal is open to ensure full popup takeover
  useEffect(() => {
    document.body.classList.add('pdf-tools-open');
    return () => {
      document.body.classList.remove('pdf-tools-open');
    };
  }, []);

  // ---- Shared helpers ----

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  /** Store a result blob for preview-before-download */
  const storeResult = useCallback((blobs: Blob[], filenames: string[], mimeType: string) => {
    setPreviewResult({ blobs, filenames, mimeType, previewOpened: false });
  }, []);

  /** Upload the current doc blob to PDF.co, run an operation, show result for preview */
  const processAndPreview = useCallback(async (
    operation: (url: string) => Promise<string | string[]>,
    outputName: string,
    mimeType = 'application/pdf',
  ) => {
    const blob = await loadDocumentBlob(doc.id);
    setStatus({ type: 'info', msg: 'Uploading to PDF.co…' });
    const uploadedUrl = await uploadToPdfCo(blob, doc.originalName);

    setStatus({ type: 'info', msg: 'Processing…' });
    const result = await operation(uploadedUrl);

    const ext = getResultExt(mimeType);

    if (Array.isArray(result)) {
      // Multiple outputs (e.g. split, images) — collect each for preview
      const blobs: Blob[] = [];
      const filenames: string[] = [];
      for (let i = 0; i < result.length; i++) {
        const outBlob = await downloadResult(result[i]);
        blobs.push(outBlob);
        filenames.push(`${outputName}_${i + 1}.${ext}`);
      }
      storeResult(blobs, filenames, mimeType);
      setStatus({ type: 'success', msg: `✓ Processed ${result.length} file(s)` });
    } else {
      const outBlob = await downloadResult(result);
      storeResult([outBlob], [`${outputName}.${ext}`], mimeType);
      setStatus({ type: 'success', msg: `✓ Ready! Size: ${formatFileSize(outBlob.size)}` });
    }
  }, [doc, storeResult]);

  const base = doc.name.replace(/\.[^.]+$/, '');

  // ---- Tab content ----

  return createPortal(
    <div className="pdf-proc-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pdf-proc-modal animate-fade-in">

        {/* Header */}
        <div className="pdf-proc-header">
          <div className="pdf-proc-header-left">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.4))' }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div className="pdf-proc-title">PDF Tools</div>
              <div className="pdf-proc-subtitle" title={doc.originalName}>{doc.originalName}</div>
            </div>
          </div>
          <button className="pdf-proc-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar — glass pill strip */}
        <div className="pdf-proc-tabs">
          <div className="pdf-proc-tabs-inner">
            {TAB_ORDER.map((tabId) => (
              <button
                key={tabId}
                className={`pdf-proc-tab ${activeTab === tabId ? 'active' : ''}`}
                onClick={() => { setActiveTab(tabId); setStatus(null); }}
              >
                <span className="pdf-proc-tab-icon">{TabIcons[tabId]}</span>
                <span className="pdf-proc-tab-label">{TAB_LABELS[tabId]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Status banner */}
        {status && (
          <div className={`pdf-proc-status pdf-proc-status-${status.type}`}>
            {status.msg}
          </div>
        )}

        {/* Tab bodies */}
        <div className="pdf-proc-body">

          {/* ===== COMPRESS ===== */}
          {activeTab === 'compress' && (
            <CompressTab doc={doc} base={base} busy={busy} run={run} processAndPreview={processAndPreview} storeResult={storeResult} />
          )}

          {/* ===== CONVERT ===== */}
          {activeTab === 'convert' && (
            <ConvertTab
              doc={doc}
              base={base}
              busy={busy}
              run={run}
              processAndPreview={processAndPreview}
              setBusy={setBusy}
              setStatus={setStatus}
              storeResult={storeResult}
              onSelectTab={(t) => { setActiveTab(t); setStatus(null); }}
            />
          )}

          {/* ===== EDIT ===== */}
          {activeTab === 'edit' && (
            <EditTab doc={doc} base={base} busy={busy} run={run} processAndPreview={processAndPreview} setStatus={setStatus} storeResult={storeResult} />
          )}

          {/* ===== PROTECT ===== */}
          {activeTab === 'protect' && (
            <ProtectTab doc={doc} base={base} busy={busy} run={run} processAndPreview={processAndPreview} />
          )}

          {/* ===== OCR ===== */}
          {activeTab === 'ocr' && (
            <OcrTab doc={doc} busy={busy} setBusy={setBusy} setStatus={setStatus} loadDocumentBlob={loadDocumentBlob} />
          )}

          {/* ===== INFO ===== */}
          {activeTab === 'info' && (
            <InfoTab doc={doc} busy={busy} setBusy={setBusy} setStatus={setStatus} loadDocumentBlob={loadDocumentBlob} />
          )}

          {/* ===== SETTINGS ===== */}
          {activeTab === 'settings' && (
            <SettingsTab setStatus={setStatus} />
          )}

          {/* ===== RESULT PREVIEW ===== */}
          {previewResult && (
            <ResultPreview
              result={previewResult}
              setResult={setPreviewResult}
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// Sub-components per tab
// ============================================================

interface PreviewResult {
  blobs: Blob[];
  filenames: string[];
  mimeType: string;
  previewOpened: boolean;
}

interface TabProps {
  doc: StoredDocument;
  busy: boolean;
  storeResult?: (blobs: Blob[], filenames: string[], mimeType: string) => void;
  setStatus?: (s: { type: 'success' | 'error' | 'info'; msg: string } | null) => void;
  setBusy?: (b: boolean) => void;
  loadDocumentBlob?: (id: string) => Promise<Blob>;
}

interface OperationTabProps extends TabProps {
  base: string;
  run: (fn: () => Promise<void>) => Promise<void>;
  processAndPreview: (op: (url: string) => Promise<string | string[]>, name: string, mime?: string) => Promise<void>;
}

// ---- Module-level helpers ----

function getResultExt(mimeType: string): string {
  switch (mimeType) {
    case 'application/pdf': return 'pdf';
    case 'image/jpeg': return 'jpg';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': return 'docx';
    case 'text/plain': return 'txt';
    default: return 'pdf';
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Result Preview ----

function ResultPreview({ result, setResult }: { result: PreviewResult; setResult: (r: PreviewResult | null) => void }) {
  const isPdf = result.mimeType === 'application/pdf';
  const isImage = result.mimeType === 'image/jpeg';
  const canPreview = isPdf || isImage;

  const [inlinePreview, setInlinePreview] = useState(false);

  const previewUrls = useMemo(
    () => result.blobs.map((b) => URL.createObjectURL(b)),
    [result.blobs],
  );

  useEffect(() => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), [previewUrls]);

  const togglePreview = () => {
    setInlinePreview(!inlinePreview);
  };

  const close = () => setResult(null);

  const downloadAll = () => {
    result.blobs.forEach((blob, i) => {
      triggerDownload(blob, result.filenames[i]);
    });
  };

  return (
    <>
      <div className="pdf-proc-result-card">
        <div className="pdf-proc-result-header">
          <div className="pdf-proc-result-info">
            <div className="pdf-proc-result-name">{result.filenames[0]}</div>
            <div className="pdf-proc-result-meta">
              {formatFileSize(result.blobs[0].size)} • {result.mimeType}
              {result.blobs.length > 1 && ` • ${result.blobs.length} files`}
            </div>
          </div>
          <div className="pdf-proc-result-actions">
            {canPreview && (
              <button className="btn btn-secondary btn-sm" onClick={togglePreview}>
                {inlinePreview ? 'Hide Preview' : '👁️ Preview'}
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={downloadAll}>⬇ Download</button>
            <button className="btn btn-ghost btn-sm" onClick={close}>✕</button>
          </div>
        </div>
        {inlinePreview && (
          <div style={{ marginTop: 12, height: 350, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', borderRadius: 6 }}>
            {previewUrls.map((url, i) => (
              isImage ? (
                <img key={i} src={url} alt={result.filenames[i]} style={{ width: '100%', objectFit: 'contain', background: '#fff' }} />
              ) : (
                <iframe key={i} src={`${url}#toolbar=0`} width="100%" height="350px" style={{ border: 'none', background: '#fff', flexShrink: 0 }} title={result.filenames[i]} />
              )
            ))}
          </div>
        )}
      </div>

      {!canPreview && (
        <div className="pdf-proc-result-notice">
          Inline preview not available for this file type. Click Download to save.
        </div>
      )}
    </>
  );
}

// ---- Compress ----
function CompressTab({ doc, base, busy, run, processAndPreview }: OperationTabProps) {
  const [level, setLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const isPdf = doc.mimeType === 'application/pdf';

  return (
    <div className="pdf-proc-section">
      <div className="pdf-proc-desc">
        Reduce PDF file size by compressing images and fonts. Higher compression = smaller file but lower image quality.
      </div>
      <div className="pdf-proc-orig-size">
        Original: <strong>{formatFileSize(doc.sizeBytes)}</strong>
      </div>

      <div className="pdf-proc-options">
        {(['low', 'medium', 'high'] as const).map((l) => (
          <button
            key={l}
            className={`pdf-proc-option-btn ${level === l ? 'active' : ''}`}
            onClick={() => setLevel(l)}
          >
            <div className="pdf-proc-option-icon">{l === 'low' ? '🟢' : l === 'medium' ? '🟡' : '🔴'}</div>
            <div className="pdf-proc-option-label">{l.charAt(0).toUpperCase() + l.slice(1)}</div>
            <div className="pdf-proc-option-desc">
              {l === 'low' ? '~80% quality' : l === 'medium' ? '~60% quality' : '~35% quality'}
            </div>
          </button>
        ))}
      </div>

      {!isPdf && <div className="pdf-proc-warn">⚠ Only PDF files can be compressed</div>}

      <button
        className="pdf-proc-cta-btn"
        disabled={busy || !isPdf}
        onClick={() => run(() => processAndPreview((url) => compressPdf(url, level), `${base}_compressed`))}
      >
        <span>{busy ? <BusySpinner text="Compressing…" /> : '📦 Compress & Preview →'}</span>
      </button>
    </div>
  );
}

// ---- Convert ----
interface ConvertTabProps extends OperationTabProps {
  onSelectTab: (t: TabId) => void;
}

function ConvertTab({
  doc,
  base,
  busy,
  run,
  processAndPreview,
  setBusy,
  setStatus,
  storeResult,
  onSelectTab,
}: ConvertTabProps) {
  const isPdf = doc.mimeType === 'application/pdf';
  const isWord = doc.mimeType.includes('word') || doc.mimeType.includes('officedocument') || /\.(docx?|doc)$/i.test(doc.originalName);
  const [format, setFormat] = useState<'word' | 'images' | 'text'>('word');
  const [extractedText, setExtractedText] = useState('');

  const handleExtractText = async () => {
    if (!setBusy || !setStatus) return;
    setBusy(true);
    setStatus({ type: 'info', msg: 'Uploading & extracting text…' });
    setExtractedText('');
    try {
      const blob = await loadDocumentBlob(doc.id);
      const uploadedUrl = await uploadToPdfCo(blob, doc.originalName);
      setStatus({ type: 'info', msg: 'Extracting text…' });
      const text = await pdfToText(uploadedUrl);
      if (!text.trim()) {
        setStatus({ type: 'error', msg: 'No text found. Try the OCR tab for scanned PDFs.' });
      } else {
        setExtractedText(text);
        if (storeResult) {
          storeResult([new Blob([text], { type: 'text/plain' })], [`${base}.txt`], 'text/plain');
        }
        setStatus({ type: 'success', msg: `✓ Extracted ${text.length} characters` });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const handleConvert = () => {
    if (isWord) {
      run(() => processAndPreview((url) => wordToPdf(url), base));
      return;
    }
    if (format === 'word') {
      run(() =>
        processAndPreview(
          (url) => pdfToWord(url),
          base,
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ),
      );
    } else if (format === 'images') {
      run(() =>
        processAndPreview(
          (url) => pdfToImages(url),
          `${base}_page`,
          'image/jpeg',
        ),
      );
    } else {
      handleExtractText();
    }
  };

  const title = isWord ? 'PDF' : format === 'word' ? 'Word' : format === 'images' ? 'Images' : 'Text';
  const ext = isWord ? '.pdf' : format === 'word' ? '.docx' : format === 'images' ? '.jpg' : '.txt';
  const targetBadge = isWord ? 'PDF' : format === 'word' ? 'DOCX' : format === 'images' ? 'JPG' : 'TXT';
  const sourceBadge = isWord ? 'DOCX' : 'PDF';
  const note1 = isWord
    ? 'Convert Word document to PDF'
    : format === 'word'
      ? 'Editable file, layout kept'
      : format === 'images'
        ? 'Each page as high-res JPG image'
        : 'Extracts all readable text content';
  const buttonLabel = isWord
    ? 'Convert to PDF'
    : format === 'word'
      ? 'Convert to Word'
      : format === 'images'
        ? 'Convert to Images'
        : 'Extract Text';

  return (
    <div className="pdf-convert-view">
      {/* Document Flow Graphic */}
      <div className="pdf-convert-diagram">
        {/* Source Doc */}
        <svg width="42" height="52" viewBox="0 0 42 52" fill="none">
          <path d="M26 2H8a5 5 0 0 0-5 5v38a5 5 0 0 0 5 5h26a5 5 0 0 0 5-5V17L26 2z" stroke="#EAF2FF" strokeWidth="2" strokeLinejoin="round" />
          <path d="M25 2v15h14" stroke="#EAF2FF" strokeWidth="2" strokeLinejoin="round" />
          <rect x="6" y="27" width="30" height="15" rx="3.5" fill="#081326" stroke="#EAF2FF" strokeWidth="1.5" />
          <text x="21" y="38.5" fill="#EAF2FF" fontSize="9.5" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono)">{sourceBadge}</text>
        </svg>

        {/* Glowing Cyan Arrow */}
        <svg width="32" height="24" viewBox="0 0 32 24" fill="none">
          <path d="M4 12h22M18 4l8 8-8 8" stroke="#00CFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px #00CFFF)' }} />
        </svg>

        {/* Target Doc */}
        <svg width="42" height="52" viewBox="0 0 42 52" fill="none">
          <path d="M26 2H8a5 5 0 0 0-5 5v38a5 5 0 0 0 5 5h26a5 5 0 0 0 5-5V17L26 2z" stroke="#EAF2FF" strokeWidth="2" strokeLinejoin="round" />
          <path d="M25 2v15h14" stroke="#EAF2FF" strokeWidth="2" strokeLinejoin="round" />
          <rect x="6" y="26" width="30" height="17" rx="3.5" fill="#087ED1" stroke="#00CFFF" strokeWidth="1.2" style={{ filter: 'drop-shadow(0 0 6px rgba(0,207,255,0.6))' }} />
          <text x="21" y="38" fill="#EAF2FF" fontSize="9" fontWeight="800" textAnchor="middle" fontFamily="var(--font-mono)">{targetBadge}</text>
        </svg>
      </div>

      {/* Hero Title & Subtitle */}
      <div>
        <div className="pdf-convert-hero-title">{title}</div>
        <div className="pdf-convert-hero-subtitle">
          from {sourceBadge} <span className="pdf-convert-ext-badge">{ext}</span>
        </div>
      </div>

      {/* 3-Way Format Switcher */}
      {isPdf && (
        <div className="pdf-convert-switcher">
          <button
            type="button"
            className={`pdf-convert-switch-btn ${format === 'word' ? 'active' : ''}`}
            onClick={() => setFormat('word')}
          >
            {format === 'word' && <span className="pdf-glass-orb" />}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>Word</span>
          </button>

          <button
            type="button"
            className={`pdf-convert-switch-btn ${format === 'images' ? 'active' : ''}`}
            onClick={() => setFormat('images')}
          >
            {format === 'images' && <span className="pdf-glass-orb" />}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span>Images</span>
          </button>

          <button
            type="button"
            className={`pdf-convert-switch-btn ${format === 'text' ? 'active' : ''}`}
            onClick={() => setFormat('text')}
          >
            {format === 'text' && <span className="pdf-glass-orb" />}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <line x1="7" y1="8" x2="17" y2="8" />
              <line x1="7" y1="12" x2="17" y2="12" />
              <line x1="7" y1="16" x2="13" y2="16" />
            </svg>
            <span>Text</span>
          </button>
        </div>
      )}

      {/* Helper text */}
      <div>
        <div className="pdf-convert-note-1">{note1}</div>
        {isPdf && (
          <div className="pdf-convert-note-2">
            Scanned PDF? Use the{' '}
            <span
              className="pdf-convert-note-link"
              onClick={() => onSelectTab('ocr')}
            >
              OCR tab
            </span>
          </div>
        )}
      </div>

      {/* Extracted text preview for Text format */}
      {format === 'text' && extractedText && (
        <div style={{ width: '100%', marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 4 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(extractedText)}>📋 Copy</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => triggerDownload(new Blob([extractedText], { type: 'text/plain' }), `${base}.txt`)}>⬇ .txt</button>
          </div>
          <textarea
            readOnly
            value={extractedText}
            className="form-input"
            style={{ width: '100%', resize: 'none', height: 60, fontSize: '0.72rem', fontFamily: 'monospace' }}
          />
        </div>
      )}

      {/* Action button */}
      <button
        type="button"
        className="pdf-convert-action-btn"
        disabled={busy}
        onClick={handleConvert}
      >
        <span>{busy ? 'Processing…' : buttonLabel}</span>
        {!busy && <span style={{ fontSize: '1.2rem', marginLeft: 4 }}>→</span>}
      </button>
    </div>
  );
}

// ---- Edit ----
function EditTab({ doc, base, busy, run, processAndPreview, setStatus, storeResult }: OperationTabProps) {
  const [splitPages, setSplitPages] = useState('');
  const [deletePages, setDeletePages] = useState('');
  const [rotateAngle, setRotateAngle] = useState<90 | 180 | 270>(90);
  const [mergeList, setMergeList] = useState<string[]>([]);
  const [allDocs, setAllDocs] = useState<StoredDocument[]>([]);
  const [showMerge, setShowMerge] = useState(false);
  const isPdf = doc.mimeType === 'application/pdf';

  const loadAllForMerge = async () => {
    const docs = await loadAllDocumentMetadata();
    setAllDocs(docs.filter((d) => d.mimeType === 'application/pdf' && d.id !== doc.id));
    setShowMerge(true);
  };

  return (
    <div className="pdf-proc-section">
      {!isPdf && <div className="pdf-proc-warn">⚠ Only PDF files can be edited</div>}

      {/* Page Numbers */}
      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">Add Page Numbers</div>
        <button
          className="btn btn-secondary btn-full"
          disabled={busy || !isPdf}
          onClick={() => run(() => processAndPreview((url) => addPageNumbers(url), `${base}_numbered`))}
        >
          {busy ? <BusySpinner text="Adding…" /> : '🔢 Add Page Numbers & Preview'}
        </button>
      </div>

      {/* Rotate */}
      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">Rotate Pages</div>
        <div className="pdf-proc-row">
          {([90, 180, 270] as const).map((a) => (
            <button
              key={a}
              className={`pdf-proc-option-btn compact ${rotateAngle === a ? 'active' : ''}`}
              onClick={() => setRotateAngle(a)}
            >
              {a}°
            </button>
          ))}
        </div>
        <button
          className="btn btn-secondary btn-full"
          disabled={busy || !isPdf}
          onClick={() => run(() => processAndPreview((url) => rotatePdf(url, rotateAngle), `${base}_rotated`))}
        >
          {busy ? <BusySpinner text="Rotating…" /> : `↩ Rotate ${rotateAngle}° & Preview`}
        </button>
      </div>

      {/* Split */}
      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">Split Pages</div>
        <div className="pdf-proc-hint">Page range e.g. <code>1,2,3-5</code> — each range = separate PDF</div>
        <input
          className="form-input"
          placeholder="e.g. 1-3, 4-6"
          value={splitPages}
          onChange={(e) => setSplitPages(e.target.value)}
        />
        <button
          className="btn btn-secondary btn-full"
          style={{ marginTop: 6 }}
          disabled={busy || !isPdf || !splitPages.trim()}
          onClick={() => run(() => processAndPreview((url) => splitPdf(url, splitPages), `${base}_split`))}
        >
          {busy ? <BusySpinner text="Splitting…" /> : '✂️ Split & Preview'}
        </button>
      </div>

      {/* Delete Pages */}
      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">Delete Pages</div>
        <div className="pdf-proc-hint">Pages to <strong>remove</strong> e.g. <code>1,3-5</code></div>
        <input
          className="form-input"
          placeholder="e.g. 1, 3-5"
          value={deletePages}
          onChange={(e) => setDeletePages(e.target.value)}
        />
        <button
          className="btn btn-secondary btn-full"
          style={{ marginTop: 6 }}
          disabled={busy || !isPdf || !deletePages.trim()}
          onClick={() => run(() => processAndPreview((url) => deletePdfPages(url, deletePages), `${base}_edited`))}
        >
          {busy ? <BusySpinner text="Deleting…" /> : '🗑 Delete Pages & Preview'}
        </button>
      </div>

      {/* Merge */}
      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">Merge PDFs</div>
        {!showMerge ? (
          <button className="btn btn-secondary btn-full" onClick={loadAllForMerge} disabled={busy || !isPdf}>
            📎 Select PDFs to Merge
          </button>
        ) : (
          <div>
            <div className="pdf-proc-hint">Select additional PDFs to merge after <strong>{doc.name}</strong>:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '6px 0' }}>
              {allDocs.length === 0 && <div className="pdf-proc-hint">No other PDFs in vault</div>}
              {allDocs.map((d) => (
                <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.8rem', color: 'var(--color-pc-text)' }}>
                  <input
                    type="checkbox"
                    checked={mergeList.includes(d.id)}
                    onChange={(e) => setMergeList((prev) => e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id))}
                    style={{ accentColor: 'var(--color-pc-accent-start)' }}
                  />
                  {d.name} <span style={{ color: 'var(--color-pc-text-muted)', fontSize: '0.7rem' }}>({formatFileSize(d.sizeBytes)})</span>
                </label>
              ))}
            </div>
            <button
              className="btn btn-primary btn-full"
              disabled={busy || mergeList.length === 0}
              onClick={() => run(async () => {
                if (!setStatus) return;
                setStatus({ type: 'info', msg: 'Uploading files…' });
                const blob0 = await loadDocumentBlob(doc.id);
                const url0 = await uploadToPdfCo(blob0, doc.originalName);
                const extraUrls: string[] = [];
                for (const id of mergeList) {
                  const b = await loadDocumentBlob(id);
                  const d2 = allDocs.find((x) => x.id === id)!;
                  extraUrls.push(await uploadToPdfCo(b, d2.originalName));
                }
                setStatus({ type: 'info', msg: 'Merging…' });
                const resultUrl = await mergePdfs([url0, ...extraUrls]);
                const outBlob = await downloadResult(resultUrl);
                storeResult?.([outBlob], [`${base}_merged.pdf`], 'application/pdf');
                setStatus({ type: 'success', msg: `✓ Merged ${1 + mergeList.length} PDFs (${formatFileSize(outBlob.size)})` });
              })}
            >
              {busy ? <BusySpinner text="Merging…" /> : `📎 Merge ${1 + mergeList.length} PDFs & Preview`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Protect ----
function ProtectTab({ doc, base, busy, run, processAndPreview }: OperationTabProps) {
  const [pwd, setPwd] = useState('');
  const [unlockPwd, setUnlockPwd] = useState('');
  const [show, setShow] = useState(false);
  const isPdf = doc.mimeType === 'application/pdf';

  return (
    <div className="pdf-proc-section">
      {!isPdf && <div className="pdf-proc-warn">⚠ Only PDF files can be protected</div>}

      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">🔒 Add Password Protection</div>
        <div className="pdf-proc-hint">Encrypts the PDF — recipients need this password to open it.</div>
        <div className="vault-password-wrapper" style={{ marginTop: 6 }}>
          <input
            className="form-input"
            type={show ? 'text' : 'password'}
            placeholder="Set a password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
          />
          <button type="button" className="vault-toggle-visibility" onClick={() => setShow(!show)} tabIndex={-1}>
            {show ? '🙈' : '👁️'}
          </button>
        </div>
        <button
          className="btn btn-primary btn-full"
          style={{ marginTop: 8 }}
          disabled={busy || !isPdf || !pwd}
          onClick={() => run(() => processAndPreview((url) => protectPdf(url, pwd), `${base}_protected`))}
        >
          {busy ? <BusySpinner text="Protecting…" /> : '🔒 Protect & Preview'}
        </button>
      </div>

      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">🔓 Remove Password</div>
        <div className="pdf-proc-hint">Provide the current password to unlock the PDF.</div>
        <div className="vault-password-wrapper" style={{ marginTop: 6 }}>
          <input
            className="form-input"
            type={show ? 'text' : 'password'}
            placeholder="Current password"
            value={unlockPwd}
            onChange={(e) => setUnlockPwd(e.target.value)}
          />
          <button type="button" className="vault-toggle-visibility" onClick={() => setShow(!show)} tabIndex={-1}>
            {show ? '🙈' : '👁️'}
          </button>
        </div>
        <button
          className="btn btn-secondary btn-full"
          style={{ marginTop: 8 }}
          disabled={busy || !isPdf || !unlockPwd}
          onClick={() => run(() => processAndPreview((url) => unlockPdf(url, unlockPwd), `${base}_unlocked`))}
        >
          {busy ? <BusySpinner text="Unlocking…" /> : '🔓 Unlock & Preview'}
        </button>
      </div>
    </div>
  );
}

// ---- OCR ----
function OcrTab({ doc, busy, setBusy, setStatus, loadDocumentBlob: loadBlob }: TabProps) {
  const [ocrText, setOcrText] = useState('');
  const [lang, setLang] = useState('eng');
  const isPdf = doc.mimeType === 'application/pdf';

  const runOcr = async () => {
    if (!setBusy || !setStatus || !loadBlob) return;
    setBusy(true);
    setStatus({ type: 'info', msg: 'Uploading & running OCR…' });
    try {
      const blob = await loadBlob(doc.id);
      const url = await uploadToPdfCo(blob, doc.originalName);
      const text = await ocrPdf(url, '0-', lang);
      setOcrText(text || '(No text found — try a different language)');
      setStatus({ type: 'success', msg: `✓ Extracted ${text.length} characters` });
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const copyText = () => { navigator.clipboard.writeText(ocrText); };
  const downloadText = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ocrText], { type: 'text/plain' }));
    a.download = `${doc.name}_ocr.txt`;
    a.click();
  };

  return (
    <div className="pdf-proc-section">
      {!isPdf && <div className="pdf-proc-warn">⚠ Only PDF files support OCR</div>}
      <div className="pdf-proc-desc">Extract text from scanned or image-based PDFs using OCR.</div>

      <div className="form-group">
        <label className="form-label">Language</label>
        <select className="form-select" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="eng">English</option>
          <option value="hin">Hindi</option>
          <option value="kan">Kannada</option>
          <option value="tam">Tamil</option>
          <option value="tel">Telugu</option>
          <option value="fra">French</option>
          <option value="deu">German</option>
          <option value="spa">Spanish</option>
          <option value="chi_sim">Chinese (Simplified)</option>
          <option value="jpn">Japanese</option>
          <option value="ara">Arabic</option>
        </select>
      </div>

      <button className="btn btn-primary btn-full" disabled={busy || !isPdf} onClick={runOcr}>
        {busy ? <BusySpinner text="Running OCR…" /> : '🔍 Extract Text (OCR)'}
      </button>

      {ocrText && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--color-pc-text-muted)' }}>Extracted Text</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-secondary btn-sm" onClick={copyText}>📋 Copy</button>
              <button className="btn btn-secondary btn-sm" onClick={downloadText}>⬇ .txt</button>
            </div>
          </div>
          <textarea
            readOnly
            value={ocrText}
            className="form-input"
            style={{ resize: 'vertical', minHeight: 120, fontSize: '0.75rem', fontFamily: 'monospace' }}
          />
        </div>
      )}
    </div>
  );
}

// ---- Info ----
function InfoTab({ doc, busy, setBusy, setStatus, loadDocumentBlob: loadBlob }: TabProps) {
  const [info, setInfo] = useState<{ pageCount: number; title?: string; author?: string; width?: number; height?: number } | null>(null);
  const isPdf = doc.mimeType === 'application/pdf';

  const loadInfo = async () => {
    if (!setBusy || !setStatus || !loadBlob) return;
    setBusy(true);
    setStatus({ type: 'info', msg: 'Fetching PDF info…' });
    try {
      const blob = await loadBlob(doc.id);
      const url = await uploadToPdfCo(blob, doc.originalName);
      const result = await getPdfInfo(url);
      setInfo(result);
      setStatus(null);
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pdf-proc-section">
      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">Document Details</div>
        <div className="pdf-proc-info-row"><span>Name</span><span>{doc.name}</span></div>
        <div className="pdf-proc-info-row"><span>Original</span><span>{doc.originalName}</span></div>
        <div className="pdf-proc-info-row"><span>Type</span><span>{doc.mimeType.split('/')[1].toUpperCase()}</span></div>
        <div className="pdf-proc-info-row"><span>Size</span><span>{formatFileSize(doc.sizeBytes)}</span></div>
        <div className="pdf-proc-info-row"><span>Uploaded</span><span>{new Date(doc.createdAt).toLocaleDateString()}</span></div>
        {doc.width && <div className="pdf-proc-info-row"><span>Dimensions</span><span>{doc.width}×{doc.height}px</span></div>}
      </div>

      {isPdf && (
        <div className="pdf-proc-subsection">
          <div className="pdf-proc-sub-title">PDF Metadata</div>
          {!info ? (
            <button className="btn btn-secondary btn-full" disabled={busy} onClick={loadInfo}>
              {busy ? <BusySpinner text="Loading…" /> : 'ℹ️ Load PDF Info'}
            </button>
          ) : (
            <>
              <div className="pdf-proc-info-row"><span>Pages</span><strong>{info.pageCount}</strong></div>
              {info.title && <div className="pdf-proc-info-row"><span>Title</span><span>{info.title}</span></div>}
              {info.author && <div className="pdf-proc-info-row"><span>Author</span><span>{info.author}</span></div>}
              {info.width != null && info.width > 0 && (
                <div className="pdf-proc-info-row">
                  <span>Page Size</span>
                  <span>{info.width} × {info.height} pt ({Math.round((info.width ?? 0) / 72 * 25.4)}×{Math.round((info.height ?? 0) / 72 * 25.4)} mm)</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Settings (API Keys) ----
function SettingsTab({ setStatus }: { setStatus: (s: { type: 'success' | 'error' | 'info'; msg: string } | null) => void }) {
  const [newKey, setNewKey] = useState('');
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const keys = await getExtraKeys();
    setExtraKeys(keys);
    setLoaded(true);
  };

  useState(() => { load(); });

  const addKey = async () => {
    if (!newKey.trim()) return;
    await saveExtraKey(newKey.trim());
    setNewKey('');
    await load();
    setStatus({ type: 'success', msg: '✓ API key saved' });
  };

  const removeKey = async (k: string) => {
    await removeExtraKey(k);
    await load();
  };

  return (
    <div className="pdf-proc-section">
      <div className="pdf-proc-desc">
        Add extra PDF.co API keys for fallback when credits run out. Keys are stored locally (not in the encrypted vault).
      </div>

      <div className="pdf-proc-subsection">
        <div className="pdf-proc-sub-title">Add API Key</div>
        <input
          className="form-input"
          type="text"
          placeholder="email@example.com_XXXXXXXX"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addKey(); }}
        />
        <button className="btn btn-primary btn-full" style={{ marginTop: 6 }} onClick={addKey} disabled={!newKey.trim()}>
          + Add Key
        </button>
      </div>

      {loaded && extraKeys.length > 0 && (
        <div className="pdf-proc-subsection">
          <div className="pdf-proc-sub-title">Saved Fallback Keys ({extraKeys.length})</div>
          {extraKeys.map((k, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--color-pc-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {k.slice(0, 32)}…
              </span>
              <button className="btn btn-danger btn-sm" onClick={() => removeKey(k)}>🗑</button>
            </div>
          ))}
        </div>
      )}

      <div className="pdf-proc-hint" style={{ marginTop: 8 }}>
        💡 Get free keys at <strong>pdf.co</strong> — each account gets 10,000 credits/month
      </div>
    </div>
  );
}

// ---- Helpers ----

function ActionCard({ icon, title, desc, busy, onClick }: { icon: string; title: string; desc: string; busy: boolean; onClick: () => void }) {
  return (
    <button className="pdf-proc-action-card" disabled={busy} onClick={onClick}>
      <span style={{ fontSize: '1.4rem' }}>{icon}</span>
      <strong style={{ fontSize: '0.8rem' }}>{title}</strong>
      <span style={{ fontSize: '0.68rem', color: 'var(--color-pc-text-muted)' }}>{desc}</span>
    </button>
  );
}

function BusySpinner({ text }: { text: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
      <span className="spinner" />
      {text}
    </span>
  );
}
