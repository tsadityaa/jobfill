import { useState, useCallback, useMemo, useEffect } from 'react';
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
import { loadDocumentBlob, loadAllDocumentMetadata } from '../utils/documentStorage';

interface PdfProcessorProps {
  doc: StoredDocument;
  onClose: () => void;
}

type TabId = 'compress' | 'convert' | 'edit' | 'protect' | 'ocr' | 'info' | 'settings';

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'compress', icon: '📦', label: 'Compress' },
  { id: 'convert', icon: '🔄', label: 'Convert' },
  { id: 'edit', icon: '✂️', label: 'Edit' },
  { id: 'protect', icon: '🔒', label: 'Protect' },
  { id: 'ocr', icon: '🔍', label: 'OCR' },
  { id: 'info', icon: 'ℹ️', label: 'Info' },
  { id: 'settings', icon: '⚙️', label: 'Keys' },
];

export default function PdfProcessor({ doc, onClose }: PdfProcessorProps) {
  const [activeTab, setActiveTab] = useState<TabId>('compress');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; msg: string } | null>(null);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);

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

  return (
    <div className="pdf-proc-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pdf-proc-modal animate-fade-in">

        {/* Header */}
        <div className="pdf-proc-header">
          <div style={{ minWidth: 0 }}>
            <div className="pdf-proc-title">⚙️ PDF Tools</div>
            <div className="pdf-proc-subtitle" title={doc.originalName}>{doc.originalName}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar */}
        <div className="pdf-proc-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`pdf-proc-tab ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => { setActiveTab(t.id); setStatus(null); }}
            >
              <span>{t.icon}</span>
              <span className="pdf-proc-tab-label">{t.label}</span>
            </button>
          ))}
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
            <ConvertTab doc={doc} base={base} busy={busy} run={run} processAndPreview={processAndPreview} setBusy={setBusy} setStatus={setStatus} storeResult={storeResult} />
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
            <OcrTab doc={doc} base={base} busy={busy} run={run} setBusy={setBusy} setStatus={setStatus} loadDocumentBlob={loadDocumentBlob} />
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
    </div>
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
  base: string;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  processAndPreview: (op: (url: string) => Promise<string | string[]>, name: string, mime?: string) => Promise<void>;
  storeResult?: (blobs: Blob[], filenames: string[], mimeType: string) => void;
  setStatus?: (s: { type: 'success' | 'error' | 'info'; msg: string } | null) => void;
  setBusy?: (b: boolean) => void;
  loadDocumentBlob?: (id: string) => Promise<Blob>;
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

  const previewUrls = useMemo(
    () => result.blobs.map((b) => URL.createObjectURL(b)),
    [result.blobs],
  );

  useEffect(() => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), [previewUrls]);

  const togglePreview = () => {
    setResult({ ...result, previewOpened: !result.previewOpened });
  };

  const close = () => setResult(null);

  const downloadAll = () => {
    result.blobs.forEach((blob, i) => {
      triggerDownload(blob, result.filenames[i]);
    });
  };

  return (
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
              {result.previewOpened ? '👐 Hide' : '👁 View'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={downloadAll}>⬇ Download</button>
          <button className="btn btn-ghost btn-sm" onClick={close}>✕</button>
        </div>
      </div>

      {result.previewOpened && canPreview && (
        <div className="pdf-proc-preview-content">
          {isPdf && previewUrls.map((url, i) => (
            <iframe key={i} src={`${url}#toolbar=0`} className="pdf-proc-iframe" title={result.filenames[i]} />
          ))}
          {isImage && previewUrls.map((url, i) => (
            <img key={i} src={url} className="pdf-proc-preview-img" alt={result.filenames[i]} />
          ))}
        </div>
      )}

      {!canPreview && (
        <div className="pdf-proc-result-notice">
          Inline preview not available for this file type. Click Download to save.
        </div>
      )}
    </div>
  );
}

// ---- Compress ----
function CompressTab({ doc, base, busy, run, processAndPreview }: TabProps) {
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
        className="btn btn-primary btn-full"
        disabled={busy || !isPdf}
        onClick={() => run(() => processAndPreview((url) => compressPdf(url, level), `${base}_compressed`))}
      >
        {busy ? <BusySpinner text="Compressing…" /> : '📦 Compress & Preview'}
      </button>
    </div>
  );
}

// ---- Convert ----
function ConvertTab({ doc, base, busy, run, processAndPreview, setBusy, setStatus }: TabProps) {
  const [extractedText, setExtractedText] = useState('');
  const isPdf = doc.mimeType === 'application/pdf';
  const isWord = doc.mimeType.includes('word') || doc.mimeType.includes('officedocument');

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
        setStatus({ type: 'success', msg: `✓ Extracted ${text.length} characters` });
      }
    } catch (err) {
      setStatus({ type: 'error', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const downloadText = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([extractedText], { type: 'text/plain' }));
    a.download = `${base}.txt`;
    a.click();
  };

  return (
    <div className="pdf-proc-section">
      <div className="pdf-proc-desc">Convert your document to a different format.</div>

      <div className="pdf-proc-grid2">
        {isPdf && (
          <>
            <ActionCard
              icon="📝" title="PDF → Word"
              desc="Editable .docx file"
              busy={busy}
              onClick={() => run(() => processAndPreview(
                (url) => pdfToWord(url), `${base}`,
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              ))}
            />
            <ActionCard
              icon="🖼" title="PDF → Images"
              desc="Each page as JPG"
              busy={busy}
              onClick={() => run(() => processAndPreview(
                (url) => pdfToImages(url), `${base}_page`, 'image/jpeg',
              ))}
            />
          </>
        )}
        {isWord && (
          <ActionCard
            icon="📄" title="Word → PDF"
            desc="Convert .doc/.docx to PDF"
            busy={busy}
            onClick={() => run(() => processAndPreview((url) => wordToPdf(url), `${base}`))}
          />
        )}
        {!isPdf && !isWord && (
          <div className="pdf-proc-warn">⚠ Upload a PDF or Word file to convert</div>
        )}
      </div>

      {isPdf && (
        <div className="pdf-proc-subsection">
          <div className="pdf-proc-sub-title">📄 PDF → Text</div>
          <div className="pdf-proc-hint">Extracts all readable text. For scanned PDFs use the OCR tab.</div>
          <button className="btn btn-secondary btn-full" disabled={busy} onClick={handleExtractText}>
            {busy ? <BusySpinner text="Extracting…" /> : '📄 Extract Text'}
          </button>
          {extractedText && (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(extractedText)}>📋 Copy</button>
                  <button className="btn btn-secondary btn-sm" onClick={downloadText}>⬇ .txt</button>
                </div>
              </div>
              <textarea
                readOnly
                value={extractedText}
                className="form-input"
                style={{ resize: 'vertical', minHeight: 100, fontSize: '0.75rem', fontFamily: 'monospace' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Edit ----
function EditTab({ doc, base, busy, run, processAndPreview, setStatus, storeResult }: TabProps) {
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
function ProtectTab({ doc, base, busy, run, processAndPreview }: TabProps) {
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
