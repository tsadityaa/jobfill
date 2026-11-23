import { useState, useEffect, useRef, useCallback, type ReactNode, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { StoredDocument } from '../types/document';
import { formatFileSize } from '../types/document';
import { uploadToPdfCo, downloadResult, mergePdfs, splitPdf, rotatePdf } from '../utils/pdfco';
import { cloudLoadDocumentBlob as loadDocumentBlob, cloudLoadAllDocumentMetadata as loadAllDocumentMetadata } from '../utils/cloudStorage';
import { openPdf, closePdf, renderPageToDataUrl, pagesToRangeString, cutsToRanges, type PdfHandle } from '../utils/pdfPages';

type Status = { type: 'success' | 'error' | 'info'; msg: string } | null;

export interface EditViewProps {
  doc: StoredDocument;
  base: string;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  processAndPreview: (op: (url: string) => Promise<string | string[]>, name: string, mime?: string) => Promise<void>;
  setStatus?: (s: Status) => void;
  storeResult?: (blobs: Blob[], filenames: string[], mimeType: string) => void;
}

// ============================================================
// Shared pieces
// ============================================================

export function BusySpinner({ text }: { text: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
      <span className="spinner" />
      {text}
    </span>
  );
}

/** Opens one PDF and lazily renders a thumbnail per page. */
export function usePdfPages(load: () => Promise<Blob>, key: string, thumbWidth = 120) {
  const [pageCount, setPageCount] = useState(0);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pdfRef = useRef<PdfHandle | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setThumbs({});
    setPageCount(0);
    (async () => {
      try {
        const pdf = await openPdf(await loadRef.current());
        if (cancelled) { void closePdf(pdf); return; }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setLoading(false);
        for (let p = 1; p <= pdf.numPages; p++) {
          if (cancelled) return;
          const url = await renderPageToDataUrl(pdf, p, thumbWidth);
          if (cancelled) return;
          setThumbs((prev) => ({ ...prev, [p]: url }));
        }
      } catch {
        if (!cancelled) { setError('Could not read pages from this PDF'); setLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
      if (pdfRef.current) void closePdf(pdfRef.current);
      pdfRef.current = null;
    };
  }, [key, thumbWidth]);

  const render = useCallback((page: number, width: number, rotation = 0): Promise<string> => {
    const pdf = pdfRef.current;
    return pdf ? renderPageToDataUrl(pdf, page, width, rotation) : Promise.reject(new Error('PDF not ready'));
  }, []);

  const rerenderThumb = useCallback(async (page: number, rotation: number) => {
    try {
      const url = await render(page, thumbWidth, rotation);
      setThumbs((prev) => ({ ...prev, [page]: url }));
    } catch {
      // keep the previous thumbnail if re-rendering fails
    }
  }, [render, thumbWidth]);

  return { pageCount, thumbs, loading, error, render, rerenderThumb };
}

const MagnifierIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10.5" cy="10.5" r="7" /><line x1="21" y1="21" x2="15.5" y2="15.5" />
  </svg>
);

const ScissorsIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

const RotateCwIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 4 21 9 16 9" />
  </svg>
);

const PaperclipIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export function ViewHead({ left, linkLabel, onLink, linkDisabled }: { left: ReactNode; linkLabel: string; onLink: () => void; linkDisabled?: boolean }) {
  return (
    <div className="pdf-edit-head">
      <span className="pdf-edit-count">{left}</span>
      <button type="button" className="pdf-edit-link" onClick={onLink} disabled={linkDisabled}>{linkLabel}</button>
    </div>
  );
}

interface PageCardProps {
  page: number;
  label?: number | string;
  thumb?: string;
  selected?: boolean;
  /** class added to the card while selected (e.g. 'selected' = red, 'sel-cyan' = cyan) */
  selectedClass?: string;
  /** class always added to the card (e.g. a file colour) */
  tone?: string;
  onToggle?: () => void;
  onPreview: () => void;
  badge?: ReactNode;
  cardProps?: HTMLAttributes<HTMLDivElement>;
  children?: ReactNode;
}

export function PageCard({ page, label, thumb, selected = false, selectedClass = 'selected', tone = '', onToggle, onPreview, badge, cardProps, children }: PageCardProps) {
  const interactive = Boolean(onToggle);
  const cls = ['pdf-edit-card', selected ? selectedClass : '', tone].filter(Boolean).join(' ');
  return (
    <div className="pdf-edit-cell">
      <div
        className={cls}
        aria-label={`Page ${label ?? page}`}
        {...(interactive
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-pressed': selected,
              onClick: onToggle,
              onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle?.(); } },
            }
          : {})}
        {...cardProps}
      >
        <div className="pdf-edit-thumb">
          {thumb ? <img src={thumb} alt="" draggable={false} /> : <div className="pdf-edit-thumb-ph" />}
        </div>
        {badge}
        <button
          type="button"
          className="pdf-edit-magnify"
          aria-label={`Preview page ${label ?? page}`}
          onClick={(e) => { e.stopPropagation(); onPreview(); }}
        >
          <MagnifierIcon />
        </button>
      </div>
      <span className="pdf-edit-pnum">{label ?? page}</span>
      {children}
    </div>
  );
}

interface PagePreviewProps {
  page: number;
  pageCount: number;
  title?: string;
  render: (page: number) => Promise<string>;
  /** change to force a re-render of the same page (e.g. rotation changed) */
  version?: number;
  marked?: boolean;
  chip?: ReactNode;
  onPage: (page: number) => void;
  onBack: () => void;
}

export function PagePreview({ page, pageCount, title, render, version = 0, marked = false, chip, onPage, onBack }: PagePreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const renderRef = useRef(render);
  renderRef.current = render;

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    renderRef.current(page)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [page, version]);

  return (
    <>
      <ViewHead
        left={<>Page {page} of {pageCount}{title ? ` · ${title}` : ''}</>}
        linkLabel="Back to grid"
        onLink={onBack}
      />
      <div className="pdf-edit-preview-row">
        <button type="button" className="pdf-edit-nav" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className={`pdf-edit-preview-frame ${marked ? 'marked' : ''}`}>
          {url ? <img src={url} alt={`Page ${page}`} /> : <div className="pdf-edit-hint">{failed ? 'Could not render this page' : 'Rendering…'}</div>}
        </div>
        <button type="button" className="pdf-edit-nav" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
      <div className="pdf-edit-chip-slot">{chip}</div>
    </>
  );
}

function PrimaryButton({ busy, busyText, enabled, onClick, icon, children }: {
  busy: boolean; busyText: string; enabled: boolean; onClick: () => void; icon: ReactNode; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="pdf-edit-cta-btn"
      aria-disabled={!enabled}
      onClick={() => { if (enabled) onClick(); }}
    >
      {busy ? <BusySpinner text={busyText} /> : (<>{icon}<span>{children}</span></>)}
    </button>
  );
}

const pageWord = (n: number) => (n === 1 ? 'Page' : 'Pages');

// ============================================================
// Rotate
// ============================================================

export function RotateView({ doc, base, busy, run, processAndPreview, setStatus }: EditViewProps) {
  const { pageCount, thumbs, loading, error, render, rerenderThumb } = usePdfPages(() => loadDocumentBlob(doc.id), doc.id);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [angles, setAngles] = useState<Record<number, number>>({});
  const [previewPage, setPreviewPage] = useState<number | null>(null);

  const count = selected.size;
  const allSelected = pageCount > 0 && count === pageCount;

  const toggle = (p: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  const rotateSelected = () => {
    const next = { ...angles };
    selected.forEach((p) => { next[p] = ((next[p] ?? 0) + 90) % 360; });
    setAngles(next);
    selected.forEach((p) => { void rerenderThumb(p, next[p]); });

    // PDF.co rotate uses 0-based page indices; group pages that share an angle.
    const groups = new Map<number, number[]>();
    for (const [pageKey, angle] of Object.entries(next)) {
      if (angle === 0) continue;
      const list = groups.get(angle) ?? [];
      list.push(Number(pageKey) - 1);
      groups.set(angle, list);
    }
    if (groups.size === 0) {
      setStatus?.({ type: 'info', msg: 'Pages are back to their original rotation — nothing to apply' });
      return;
    }
    void run(() => processAndPreview(async (url) => {
      let current = url;
      for (const [angle, indices] of groups) {
        current = await rotatePdf(current, angle as 90 | 180 | 270, pagesToRangeString(indices));
      }
      return current;
    }, `${base}_rotated`));
  };

  const actionBtn = (
    <PrimaryButton busy={busy} busyText="Rotating…" enabled={count > 0 && !busy} onClick={rotateSelected} icon={<RotateCwIcon />}>
      {count === 0 ? 'Select pages to rotate' : `Rotate ${count} ${pageWord(count)}`}
    </PrimaryButton>
  );

  if (error) return <div className="pdf-proc-warn">⚠ {error}</div>;
  if (loading) return <div className="pdf-edit-hint">Loading pages…</div>;

  if (previewPage != null) {
    const angle = angles[previewPage] ?? 0;
    return (
      <div className="pdf-edit-view">
        <PagePreview
          page={previewPage}
          pageCount={pageCount}
          render={(p) => render(p, 260, angles[p] ?? 0)}
          version={angle}
          chip={angle !== 0 ? <span className="pdf-edit-chip cyan">Rotated {angle}°</span> : null}
          onPage={setPreviewPage}
          onBack={() => setPreviewPage(null)}
        />
        {actionBtn}
      </div>
    );
  }

  return (
    <div className="pdf-edit-view">
      <ViewHead
        left={`${count} of ${pageCount} selected`}
        linkLabel={allSelected ? 'Clear' : 'Select all'}
        onLink={() => setSelected(allSelected ? new Set() : new Set(Array.from({ length: pageCount }, (_, i) => i + 1)))}
      />
      <div className="pdf-edit-grid">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
          <PageCard
            key={p}
            page={p}
            thumb={thumbs[p]}
            selected={selected.has(p)}
            selectedClass="sel-cyan"
            onToggle={() => toggle(p)}
            onPreview={() => setPreviewPage(p)}
            badge={selected.has(p) ? <span className="pdf-edit-badge cyan"><CheckIcon /></span> : null}
          />
        ))}
      </div>
      <div className="pdf-edit-hint">Tap to select · magnifier to preview</div>
      {actionBtn}
    </div>
  );
}

// ============================================================
// Split
// ============================================================

export function SplitView({ doc, base, busy, run, processAndPreview }: EditViewProps) {
  const { pageCount, thumbs, loading, error, render } = usePdfPages(() => loadDocumentBlob(doc.id), doc.id);
  const [cuts, setCuts] = useState<Set<number>>(new Set());
  const [previewPage, setPreviewPage] = useState<number | null>(null);

  const fileCount = cuts.size + 1;
  const canSplit = cuts.size > 0 && !busy;

  const toggleCut = (p: number) => setCuts((prev) => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });

  const actionBtn = (
    <PrimaryButton
      busy={busy}
      busyText="Splitting…"
      enabled={canSplit}
      onClick={() => { void run(() => processAndPreview((url) => splitPdf(url, cutsToRanges(cuts, pageCount)), `${base}_split`)); }}
      icon={<ScissorsIcon size={22} />}
    >
      {cuts.size === 0 ? 'Tap between pages to cut' : `Split into ${fileCount} PDFs`}
    </PrimaryButton>
  );

  if (error) return <div className="pdf-proc-warn">⚠ {error}</div>;
  if (loading) return <div className="pdf-edit-hint">Loading pages…</div>;

  if (previewPage != null) {
    return (
      <div className="pdf-edit-view">
        <PagePreview
          page={previewPage}
          pageCount={pageCount}
          render={(p) => render(p, 260)}
          onPage={setPreviewPage}
          onBack={() => setPreviewPage(null)}
        />
        {actionBtn}
      </div>
    );
  }

  return (
    <div className="pdf-edit-view">
      <ViewHead
        left={`${pageCount} ${pageCount === 1 ? 'page' : 'pages'} · ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
        linkLabel="Clear cuts"
        linkDisabled={cuts.size === 0}
        onLink={() => setCuts(new Set())}
      />
      <div className="pdf-edit-grid split">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
          <PageCard key={p} page={p} thumb={thumbs[p]} onPreview={() => setPreviewPage(p)}>
            {p < pageCount && (
              <button
                type="button"
                className={`pdf-edit-cut ${cuts.has(p) ? 'on' : ''}`}
                aria-pressed={cuts.has(p)}
                aria-label={`Cut after page ${p}`}
                onClick={() => toggleCut(p)}
              >
                {cuts.has(p) && <span className="pdf-edit-cut-mark"><ScissorsIcon size={13} /></span>}
              </button>
            )}
          </PageCard>
        ))}
      </div>
      <div className="pdf-edit-hint">Tap between pages to cut · magnifier to preview</div>
      {actionBtn}
    </div>
  );
}

// ============================================================
// Merge
// ============================================================

interface MergeFile {
  id: string;
  name: string;
  originalName: string;
  sizeBytes: number;
  current: boolean;
}

type PageRenderer = (page: number, width: number, rotation?: number) => Promise<string>;

function MergeFileGroup({ file, startIndex, pendingRemove, onCount, onRender, onDragStart, onDropOn, onDot, onPreview }: {
  file: MergeFile;
  startIndex: number;
  pendingRemove: boolean;
  onCount: (id: string, count: number) => void;
  onRender: (id: string, render: PageRenderer) => void;
  onDragStart: (id: string) => void;
  onDropOn: (id: string) => void;
  onDot: (id: string) => void;
  onPreview: (id: string, page: number) => void;
}) {
  const { pageCount, thumbs, error, render } = usePdfPages(() => loadDocumentBlob(file.id), file.id);

  useEffect(() => { onCount(file.id, pageCount); }, [file.id, pageCount, onCount]);
  useEffect(() => { onRender(file.id, render); }, [file.id, render, onRender]);

  if (error) {
    return <div className="pdf-proc-warn" style={{ gridColumn: '1 / -1' }}>⚠ Could not read {file.name}</div>;
  }

  return (
    <>
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
        <PageCard
          key={p}
          page={p}
          label={startIndex + p}
          thumb={thumbs[p]}
          tone={file.current ? 'tone-cyan' : 'tone-purple'}
          onPreview={() => onPreview(file.id, p)}
          cardProps={{
            draggable: true,
            onDragStart: () => onDragStart(file.id),
            onDragOver: (e) => e.preventDefault(),
            onDrop: (e) => { e.preventDefault(); onDropOn(file.id); },
          }}
          badge={file.current ? null : (
            <button
              type="button"
              className={`pdf-edit-dot ${pendingRemove ? 'pending' : ''}`}
              aria-label={pendingRemove ? `Tap again to remove ${file.name}` : `Remove ${file.name}`}
              onClick={(e) => { e.stopPropagation(); onDot(file.id); }}
            >
              {pendingRemove ? '×' : ''}
            </button>
          )}
        />
      ))}
    </>
  );
}

export function MergeView({ doc, base, busy, run, setStatus, storeResult }: EditViewProps) {
  const [files, setFiles] = useState<MergeFile[]>([
    { id: doc.id, name: doc.name, originalName: doc.originalName, sizeBytes: doc.sizeBytes, current: true },
  ]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const renderers = useRef<Record<string, PageRenderer>>({});
  const dragId = useRef<string | null>(null);
  const [reorder, setReorder] = useState(false);
  const [picking, setPicking] = useState(false);
  const [available, setAvailable] = useState<StoredDocument[] | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ fileId: string; page: number } | null>(null);

  const onCount = useCallback((id: string, count: number) => {
    setCounts((prev) => (prev[id] === count ? prev : { ...prev, [id]: count }));
  }, []);
  const onRender = useCallback((id: string, render: PageRenderer) => { renderers.current[id] = render; }, []);

  const totalPages = files.reduce((sum, f) => sum + (counts[f.id] ?? 0), 0);

  const moveFile = (fromId: string, toIndex: number) => setFiles((prev) => {
    const from = prev.findIndex((f) => f.id === fromId);
    if (from < 0 || toIndex < 0 || toIndex >= prev.length || from === toIndex) return prev;
    const next = [...prev];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);
    return next;
  });

  const onDropOn = (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === targetId) return;
    moveFile(from, files.findIndex((f) => f.id === targetId));
  };

  const onDot = (id: string) => {
    if (pendingRemove === id) {
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setPendingRemove(null);
    } else {
      setPendingRemove(id);
    }
  };

  const openPicker = async () => {
    setPicking(true);
    setPendingRemove(null);
    setPickError(null);
    try {
      const docs = await loadAllDocumentMetadata();
      setAvailable(docs.filter((d) => d.mimeType === 'application/pdf'));
    } catch {
      setPickError('Could not load your documents');
    }
  };

  const addFile = (d: StoredDocument) => {
    setFiles((prev) => [...prev, { id: d.id, name: d.name, originalName: d.originalName, sizeBytes: d.sizeBytes, current: false }]);
    setPicking(false);
  };

  const canMerge = files.length >= 2 && !busy;

  const merge = () => {
    void run(async () => {
      setStatus?.({ type: 'info', msg: 'Uploading files…' });
      const urls: string[] = [];
      for (const f of files) {
        const blob = await loadDocumentBlob(f.id);
        urls.push(await uploadToPdfCo(blob, f.originalName));
      }
      setStatus?.({ type: 'info', msg: 'Merging…' });
      const resultUrl = await mergePdfs(urls);
      const outBlob = await downloadResult(resultUrl);
      storeResult?.([outBlob], [`${base}_merged.pdf`], 'application/pdf');
      setStatus?.({ type: 'success', msg: `✓ Merged ${files.length} PDFs (${formatFileSize(outBlob.size)})` });
    });
  };

  const actionBtn = (
    <PrimaryButton busy={busy} busyText="Merging…" enabled={canMerge} onClick={merge} icon={<PaperclipIcon />}>
      {files.length < 2 ? 'Add a PDF to merge' : 'Merge into One PDF'}
    </PrimaryButton>
  );

  const previewFile = preview ? files.find((f) => f.id === preview.fileId) : undefined;
  const hidden = picking || preview != null;
  const pendingFile = files.find((f) => f.id === pendingRemove);
  const candidates = (available ?? []).filter((d) => !files.some((f) => f.id === d.id));

  return (
    <div className="pdf-edit-view">
      {preview && previewFile && (
        <PagePreview
          page={preview.page}
          pageCount={counts[preview.fileId] ?? 0}
          title={previewFile.name}
          render={(p) => renderers.current[preview.fileId]?.(p, 260) ?? Promise.reject(new Error('Not ready'))}
          onPage={(page) => setPreview({ fileId: preview.fileId, page })}
          onBack={() => setPreview(null)}
        />
      )}

      {picking && (
        <>
          <ViewHead left="Add a PDF" linkLabel="Cancel" onLink={() => setPicking(false)} />
          <div className="pdf-edit-picklist">
            {pickError && <div className="pdf-proc-warn">⚠ {pickError}</div>}
            {!pickError && available === null && <div className="pdf-edit-hint">Loading documents…</div>}
            {!pickError && available !== null && candidates.length === 0 && <div className="pdf-edit-hint">No other PDFs in vault</div>}
            {candidates.map((d) => (
              <button key={d.id} type="button" className="pdf-edit-pick-row" onClick={() => addFile(d)}>
                <span className="pdf-edit-pick-name">{d.name}</span>
                <span className="pdf-edit-pick-size">{formatFileSize(d.sizeBytes)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Grid stays mounted (hidden) while picking/previewing so pages are not re-rendered */}
      <div style={{ display: hidden ? 'none' : 'flex', flexDirection: 'column', gap: 10 }}>
        <ViewHead
          left={`${files.length} ${files.length === 1 ? 'file' : 'files'} · ${totalPages} ${totalPages === 1 ? 'page' : 'pages'}`}
          linkLabel={reorder ? 'Done' : 'Reorder'}
          linkDisabled={files.length < 2}
          onLink={() => { setReorder((r) => !r); setPendingRemove(null); }}
        />
        {reorder && (
          <div className="pdf-edit-files">
            {files.map((f, i) => (
              <div key={f.id} className="pdf-edit-file-row">
                <span className={`pdf-edit-file-dot ${f.current ? 'cyan' : 'purple'}`} />
                <span className="pdf-edit-pick-name">{f.name}</span>
                <button type="button" className="pdf-edit-mini-btn" aria-label={`Move ${f.name} up`} disabled={i === 0} onClick={() => moveFile(f.id, i - 1)}>↑</button>
                <button type="button" className="pdf-edit-mini-btn" aria-label={`Move ${f.name} down`} disabled={i === files.length - 1} onClick={() => moveFile(f.id, i + 1)}>↓</button>
              </div>
            ))}
          </div>
        )}
        <div className="pdf-edit-grid">
          {files.map((f, idx) => (
            <MergeFileGroup
              key={f.id}
              file={f}
              startIndex={files.slice(0, idx).reduce((sum, x) => sum + (counts[x.id] ?? 0), 0)}
              pendingRemove={pendingRemove === f.id}
              onCount={onCount}
              onRender={onRender}
              onDragStart={(id) => { dragId.current = id; }}
              onDropOn={onDropOn}
              onDot={onDot}
              onPreview={(fileId, page) => { setPendingRemove(null); setPreview({ fileId, page }); }}
            />
          ))}
          <div className="pdf-edit-cell">
            <button type="button" className="pdf-edit-add" onClick={() => { void openPicker(); }}>
              <span className="pdf-edit-add-plus">+</span>
              <span>Add PDF</span>
            </button>
          </div>
        </div>
        <div className="pdf-edit-hint">
          {pendingFile ? `Tap × again to remove ${pendingFile.name}` : 'Drag to reorder · magnifier to preview'}
        </div>
      </div>

      {actionBtn}
    </div>
  );
}
