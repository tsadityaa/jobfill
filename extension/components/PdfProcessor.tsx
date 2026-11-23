import { useState, useCallback, useMemo, useEffect, useRef, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { StoredDocument } from '../types/document';
import { formatFileSize } from '../types/document';
import {
  uploadToPdfCo,
  downloadResult,
  compressPdf,
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
} from '../utils/pdfco';
import { RotateView, SplitView, MergeView, BusySpinner } from './PdfPageViews';
import { openPdf, closePdf, renderPageToDataUrl, pagesToRangeString, type PdfHandle } from '../utils/pdfPages';
import { cloudLoadDocumentBlob as loadDocumentBlob } from '../utils/cloudStorage';

interface PdfProcessorProps {
  doc: StoredDocument;
  onClose: () => void;
}

type TabId = 'compress' | 'convert' | 'edit' | 'protect' | 'ocr' | 'info';

/* SVG icon components for the glass tab bar matching reference image 1:1 */
const TabIcons: Record<TabId, ReactElement> = {
  compress: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  convert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 7h8a3 3 0 0 1 3 3v1" />
      <polyline points="10 5 8 7 10 9" />
      <path d="M16 17H8a3 3 0 0 1-3-3v-1" />
      <polyline points="14 19 16 17 14 15" />
    </svg>
  ),
  edit: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  protect: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="16" height="12" rx="2.5" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
      <path d="M12 14v4M10 16h4" />
    </svg>
  ),
  ocr: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.5" cy="10.5" r="7" /><line x1="21" y1="21" x2="15.5" y2="15.5" />
    </svg>
  ),
  info: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="4" />
      <line x1="12" y1="15" x2="12" y2="11" />
      <circle cx="12" cy="8" r="0.75" fill="currentColor" />
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
};

const TAB_ORDER: TabId[] = ['compress', 'convert', 'edit', 'protect', 'ocr', 'info'];

export default function PdfProcessor({ doc, onClose }: PdfProcessorProps) {
  const [activeTab, setActiveTab] = useState<TabId>('compress');
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.45))' }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div className="pdf-proc-title">PDF Tools</div>
              <div className="pdf-proc-subtitle" title={doc.originalName}>{doc.originalName}</div>
            </div>
          </div>
          <button className="pdf-proc-close-btn" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
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
            <CompressTab doc={doc} base={base} busy={busy} run={run} setStatus={setStatus} loadDocumentBlob={loadDocumentBlob} />
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
function CompressTab({
  doc,
  base,
  busy,
  run,
  setStatus,
  loadDocumentBlob: loadBlob,
}: Omit<OperationTabProps, 'processAndPreview'>) {
  const [level, setLevel] = useState<'low' | 'medium' | 'high'>('medium');
  const [compressedBlob, setCompressedBlob] = useState<Blob | null>(null);
  const isPdf = doc.mimeType === 'application/pdf';
  const originalSize = doc.sizeBytes;
  const compressedSize = compressedBlob?.size;
  const savedPercent = compressedSize == null || originalSize <= 0
    ? null
    : Math.round(((originalSize - compressedSize) / originalSize) * 100);

  const compress = async () => {
    if (!loadBlob || !setStatus) return;
    setCompressedBlob(null);
    setStatus({ type: 'info', msg: 'Uploading PDF…' });
    const blob = await loadBlob(doc.id);
    const uploadedUrl = await uploadToPdfCo(blob, doc.originalName);
    setStatus({ type: 'info', msg: 'Compressing PDF…' });
    const resultUrl = await compressPdf(uploadedUrl, level);
    const resultBlob = await downloadResult(resultUrl);
    setCompressedBlob(resultBlob);
    setStatus(null);
  };

  const downloadCompressed = () => {
    if (!compressedBlob) return;
    triggerDownload(compressedBlob, `${base}_compressed.pdf`);
  };

  const compressionLevels = [
    { id: 'low', label: 'Light', bars: 1 },
    { id: 'medium', label: 'Balanced', bars: 2 },
    { id: 'high', label: 'Strong', bars: 3 },
  ] as const;

  return (
    <div className="pdf-compress-view">
      {!isPdf && <div className="pdf-proc-warn">⚠ Only PDF files can be compressed</div>}

      <div className="pdf-compress-summary">
        <div className="pdf-compress-main-size">{formatFileSize(compressedSize ?? originalSize)}</div>
        {savedPercent == null ? (
          <div className="pdf-compress-sub-size">Original file size</div>
        ) : (
          <div className="pdf-compress-sub-size">
            was {formatFileSize(originalSize)} <span className={savedPercent > 0 ? 'saved' : 'larger'}>{savedPercent > 0 ? `−${savedPercent}%` : savedPercent < 0 ? `+${Math.abs(savedPercent)}%` : 'No change'}</span>
          </div>
        )}
      </div>

      <div className="pdf-compress-levels" role="group" aria-label="Compression strength">
        {compressionLevels.map(({ id, label, bars }) => (
          <button
            key={id}
            type="button"
            className={`pdf-compress-level ${level === id ? 'active' : ''}`}
            aria-pressed={level === id}
            onClick={() => { setLevel(id); setCompressedBlob(null); }}
          >
            <span className="pdf-compress-level-bars" aria-hidden="true">
              {[1, 2, 3].map((bar) => <i key={bar} className={bar <= bars ? 'lit' : ''} />)}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="pdf-compress-comparison">
        <div className="pdf-compress-meter before">
          <span className="pdf-compress-meter-fill" />
          <span className="pdf-compress-meter-label">Before</span>
          <strong>{formatFileSize(originalSize)}</strong>
        </div>
        <div className={`pdf-compress-meter after ${compressedBlob ? 'has-result' : ''}`}>
          {compressedBlob && <span className="pdf-compress-meter-fill" style={{ width: `${Math.max(3, Math.min(100, (compressedSize! / (originalSize || 1)) * 100))}%` }} />}
          <span className="pdf-compress-meter-label">After</span>
          <strong>{compressedBlob ? formatFileSize(compressedSize!) : '—'}</strong>
        </div>
        <div className="pdf-compress-tip">
          {compressedBlob && level !== 'high' ? (
            <button type="button" onClick={() => { setLevel('high'); setCompressedBlob(null); }}>Try Strong for a smaller file</button>
          ) : compressedBlob ? 'Compression complete' : 'Choose a level, then compress your PDF'}
        </div>
      </div>

      <button className="pdf-protect-submit pdf-compress-action" disabled={busy || !isPdf} onClick={() => compressedBlob ? downloadCompressed() : run(compress)}>
        {busy ? <BusySpinner text="Compressing…" /> : <><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 17v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/></svg><span>{compressedBlob ? 'Download PDF' : 'Compress PDF'}</span></>}
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
        <svg width="38" height="48" viewBox="0 0 42 52" fill="none">
          <path d="M26 2H8a5 5 0 0 0-5 5v38a5 5 0 0 0 5 5h26a5 5 0 0 0 5-5V17L26 2z" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M25 2v15h14" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
          <rect x="6" y="27" width="30" height="15" rx="3" fill="#060C18" stroke="#FFFFFF" strokeWidth="1.2" />
          <text x="21" y="38" fill="#FFFFFF" fontSize="9.5" fontWeight="700" textAnchor="middle" fontFamily="var(--font-mono, monospace)">{sourceBadge}</text>
        </svg>

        {/* Glowing Cyan Arrow */}
        <svg width="28" height="20" viewBox="0 0 32 24" fill="none">
          <path d="M4 12h22M18 4l8 8-8 8" stroke="#00CFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px #00CFFF)' }} />
        </svg>

        {/* Target Doc */}
        <svg width="38" height="48" viewBox="0 0 42 52" fill="none">
          <path d="M26 2H8a5 5 0 0 0-5 5v38a5 5 0 0 0 5 5h26a5 5 0 0 0 5-5V17L26 2z" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M25 2v15h14" stroke="#FFFFFF" strokeWidth="1.6" strokeLinejoin="round" />
          <rect x="6" y="26" width="30" height="17" rx="3" fill="#0077E6" stroke="#00D2FF" strokeWidth="1.2" style={{ filter: 'drop-shadow(0 0 8px rgba(0,210,255,0.75))' }} />
          <text x="21" y="38" fill="#FFFFFF" fontSize="9" fontWeight="800" textAnchor="middle" fontFamily="var(--font-mono, monospace)">{targetBadge}</text>
        </svg>
      </div>

      {/* Hero Title & Subtitle */}
      <div>
        <div className="pdf-convert-hero-title">{title}</div>
        <div className="pdf-convert-hero-subtitle">
          <span>from {sourceBadge}</span> <span className="pdf-convert-ext-badge">{ext}</span>
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="16" height="18" rx="3" />
              <line x1="8" y1="8" x2="16" y2="8" />
              <line x1="8" y1="12" x2="16" y2="12" />
              <line x1="8" y1="16" x2="13" y2="16" />
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
type EditSubTab = 'numbers' | 'rotate' | 'split' | 'delete' | 'merge';

const EDIT_SUBTABS: { id: EditSubTab; label: string; icon: ReactElement }[] = [
  {
    id: 'numbers', label: 'Numbers',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" />
        <line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" />
      </svg>
    ),
  },
  {
    id: 'rotate', label: 'Rotate',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 9 8 9" />
      </svg>
    ),
  },
  {
    id: 'split', label: 'Split',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    id: 'delete', label: 'Delete',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    ),
  },
  {
    id: 'merge', label: 'Merge',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
    ),
  },
];

const TrashIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

function DeletePagesView({ doc, busy, run, processAndPreview, base }: Pick<OperationTabProps, 'doc' | 'busy' | 'run' | 'processAndPreview' | 'base'>) {
  const [pageCount, setPageCount] = useState(0);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [previewPage, setPreviewPage] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pdfRef = useRef<PdfHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const blob = await loadDocumentBlob(doc.id);
        const pdf = await openPdf(blob);
        if (cancelled) { void closePdf(pdf); return; }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setLoading(false);
        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled) return;
          const url = await renderPageToDataUrl(pdf, p, 120);
          if (cancelled) return;
          setThumbs((prev) => ({ ...prev, [p]: url }));
        }
      } catch {
        if (!cancelled) { setLoadError('Could not read pages from this PDF'); setLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
      if (pdfRef.current) void closePdf(pdfRef.current);
      pdfRef.current = null;
    };
  }, [doc.id]);

  useEffect(() => {
    if (previewPage == null || !pdfRef.current) { setPreviewUrl(null); return; }
    let cancelled = false;
    setPreviewUrl(null);
    renderPageToDataUrl(pdfRef.current, previewPage, 260)
      .then((u) => { if (!cancelled) setPreviewUrl(u); })
      .catch(() => { if (!cancelled) setLoadError('Could not render this page'); });
    return () => { cancelled = true; };
  }, [previewPage]);

  const toggle = (p: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  const count = selected.size;
  const allSelected = pageCount > 0 && count >= pageCount;
  const canDelete = count > 0 && !allSelected && !busy;

  const actionBtn = (
    <>
      {allSelected && (
        <div className="pdf-edit-note" role="alert">Keep at least 1 page — tap a page to unselect it</div>
      )}
      <button
        type="button"
        className="pdf-edit-delete-btn"
        aria-disabled={!canDelete}
        onClick={() => {
          if (!canDelete) return;
          void run(() => processAndPreview((url) => deletePdfPages(url, pagesToRangeString([...selected])), `${base}_edited`));
        }}
      >
        {busy ? <BusySpinner text="Deleting…" /> : (
          <>
            <TrashIcon size={22} />
            <span>{count === 0 ? 'Select pages to delete' : `Delete ${count} ${count === 1 ? 'Page' : 'Pages'}`}</span>
          </>
        )}
      </button>
    </>
  );

  if (loadError) return <div className="pdf-proc-warn">⚠ {loadError}</div>;
  if (loading) return <div className="pdf-edit-hint">Loading pages…</div>;

  if (previewPage != null) {
    const isMarked = selected.has(previewPage);
    return (
      <div className="pdf-edit-view">
        <div className="pdf-edit-head">
          <span className="pdf-edit-count">Page {previewPage} of {pageCount}</span>
          <button type="button" className="pdf-edit-link" onClick={() => setPreviewPage(null)}>Back to grid</button>
        </div>
        <div className="pdf-edit-preview-row">
          <button type="button" className="pdf-edit-nav" aria-label="Previous page" disabled={previewPage <= 1} onClick={() => setPreviewPage(previewPage - 1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className={`pdf-edit-preview-frame ${isMarked ? 'marked' : ''}`}>
            {previewUrl ? <img src={previewUrl} alt={`Page ${previewPage}`} /> : <div className="pdf-edit-hint">Rendering…</div>}
          </div>
          <button type="button" className="pdf-edit-nav" aria-label="Next page" disabled={previewPage >= pageCount} onClick={() => setPreviewPage(previewPage + 1)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
        <div className="pdf-edit-chip-slot">
          {isMarked && <span className="pdf-edit-chip"><TrashIcon size={13} /> Marked for delete</span>}
        </div>
        {actionBtn}
      </div>
    );
  }

  return (
    <div className="pdf-edit-view">
      <div className="pdf-edit-head">
        <span className="pdf-edit-count">{count} of {pageCount} selected</span>
        <button type="button" className="pdf-edit-link" onClick={() => setSelected(new Set())} disabled={count === 0}>Clear</button>
      </div>
      <div className="pdf-edit-grid">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => {
          const isSel = selected.has(p);
          return (
            <div key={p} className="pdf-edit-cell">
              <div
                className={`pdf-edit-card ${isSel ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                aria-pressed={isSel}
                aria-label={`Page ${p}`}
                onClick={() => toggle(p)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p); } }}
              >
                <div className="pdf-edit-thumb">
                  {thumbs[p] ? <img src={thumbs[p]} alt="" draggable={false} /> : <div className="pdf-edit-thumb-ph" />}
                </div>
                {isSel && <span className="pdf-edit-badge"><TrashIcon size={13} /></span>}
                <button
                  type="button"
                  className="pdf-edit-magnify"
                  aria-label={`Preview page ${p}`}
                  onClick={(e) => { e.stopPropagation(); setPreviewPage(p); }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="10.5" cy="10.5" r="7" /><line x1="21" y1="21" x2="15.5" y2="15.5" />
                  </svg>
                </button>
              </div>
              <span className="pdf-edit-pnum">{p}</span>
            </div>
          );
        })}
      </div>
      <div className="pdf-edit-hint">Tap to select · magnifier to preview</div>
      {actionBtn}
    </div>
  );
}

function EditTab({ doc, base, busy, run, processAndPreview, setStatus, storeResult }: OperationTabProps) {
  const [sub, setSub] = useState<EditSubTab>('delete');
  const isPdf = doc.mimeType === 'application/pdf';
  const viewProps = { doc, base, busy, run, processAndPreview, setStatus, storeResult };

  return (
    <div className="pdf-proc-section">
      {!isPdf && <div className="pdf-proc-warn">⚠ Only PDF files can be edited</div>}

      <div className="pdf-edit-subtabs" role="tablist">
        {EDIT_SUBTABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={sub === t.id}
            className={`pdf-edit-subtab ${sub === t.id ? 'active' : ''}`}
            onClick={() => { setSub(t.id); setStatus?.(null); }}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {sub === 'numbers' && (
        <div className="pdf-proc-subsection">
          <div className="pdf-proc-sub-title">Add Page Numbers</div>
          <button
            className="pdf-edit-action-btn"
            disabled={busy || !isPdf}
            onClick={() => run(() => processAndPreview((url) => addPageNumbers(url), `${base}_numbered`))}
          >
            {busy ? <BusySpinner text="Adding…" /> : 'Add Page Numbers & Preview'}
          </button>
        </div>
      )}

      {sub === 'rotate' && isPdf && <RotateView {...viewProps} />}
      {sub === 'split' && isPdf && <SplitView {...viewProps} />}
      {sub === 'delete' && isPdf && (
        <DeletePagesView doc={doc} base={base} busy={busy} run={run} processAndPreview={processAndPreview} />
      )}
      {sub === 'merge' && isPdf && <MergeView {...viewProps} />}
    </div>
  );
}

// ---- Protect ----
function ProtectTab({ doc, base, busy, run, processAndPreview }: OperationTabProps) {
  const [pwd, setPwd] = useState('');
  const [unlockPwd, setUnlockPwd] = useState('');
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<'lock' | 'unlock'>('lock');
  const isPdf = doc.mimeType === 'application/pdf';
  const password = mode === 'lock' ? pwd : unlockPwd;
  const setPassword = mode === 'lock' ? setPwd : setUnlockPwd;
  const strength = getPasswordStrength(pwd);

  return (
    <div className="pdf-protect-view">
      {!isPdf && <div className="pdf-proc-warn">⚠ Only PDF files can be protected</div>}

      <div className="pdf-protect-switch" role="group" aria-label="Protection action">
        <button type="button" className={`pdf-protect-switch-option ${mode === 'lock' ? 'active' : ''}`} onClick={() => { setMode('lock'); setShow(false); }} aria-pressed={mode === 'lock'}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>
          <span>Lock</span>
        </button>
        <button type="button" className={`pdf-protect-switch-option ${mode === 'unlock' ? 'active' : ''}`} onClick={() => { setMode('unlock'); setShow(false); }} aria-pressed={mode === 'unlock'}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.7-1.5M12 14v3"/></svg>
          <span>Unlock</span>
        </button>
      </div>

      <div className="pdf-protect-password">
        <svg className="pdf-protect-input-lock" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>
        <input
          id="pdf-protect-password"
          type={show ? 'text' : 'password'}
          placeholder={mode === 'lock' ? 'Set a password' : 'Current password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'lock' ? 'new-password' : 'current-password'}
          aria-label={mode === 'lock' ? 'Set a password' : 'Current password'}
        />
        <button type="button" className="pdf-protect-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5 0 8.5 5 9 7-.2.8-1 2-2.3 3.2M6.2 6.2C3.8 7.7 2.2 10.2 2 12c.5 2 4 7 10 7 1.1 0 2.1-.2 3-.5"/></svg> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>}
        </button>
      </div>

      {mode === 'lock' ? (
        <div className="pdf-protect-strength" aria-live="polite">
          <div className="pdf-protect-strength-bars" aria-label={`Password strength: ${strength.label}`}>
            {[0, 1, 2, 3].map((bar) => <span key={bar} className={bar < strength.level ? `filled strength-${strength.level}` : ''} />)}
          </div>
          <span className={`pdf-protect-strength-label strength-text-${strength.level}`}>{strength.label}</span>
          <p>Recipients need this password to open it.</p>
        </div>
      ) : (
        <p className="pdf-protect-unlock-hint">Enter the current password to remove protection.</p>
      )}

      <button
        className="pdf-protect-submit"
        disabled={busy || !isPdf || !password}
        onClick={() => mode === 'lock'
          ? run(() => processAndPreview((url) => protectPdf(url, pwd), `${base}_protected`))
          : run(() => processAndPreview((url) => unlockPdf(url, unlockPwd), `${base}_unlocked`))}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>
        <span>{busy ? <BusySpinner text={mode === 'lock' ? 'Protecting…' : 'Unlocking…'} /> : mode === 'lock' ? 'Protect & Preview' : 'Unlock & Preview'}</span>
      </button>
    </div>
  );
}

function getPasswordStrength(password: string): { level: number; label: string } {
  if (!password) return { level: 0, label: 'Enter a password' };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score++;
  const level = score <= 1 ? 1 : score === 2 ? 2 : score === 3 ? 3 : 4;
  return { level, label: ['','Weak','Fair','Good','Strong'][level] };
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
    <div className="pdf-ocr-view">
      {!isPdf && <div className="pdf-proc-warn">⚠ Only PDF files support OCR</div>}
      <div className="pdf-ocr-description">Extract text from scanned or image-based PDFs using OCR.</div>

      <div className="pdf-ocr-language">
        <label htmlFor="pdf-ocr-language">Language</label>
        <select id="pdf-ocr-language" value={lang} onChange={(e) => setLang(e.target.value)}>
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

      <button className="pdf-protect-submit pdf-ocr-action" disabled={busy || !isPdf} onClick={runOcr}>
        {busy ? <BusySpinner text="Running OCR…" /> : <><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg><span>Extract Text (OCR)</span></>}
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
