interface PdfViewerProps {
  /** The PDF blob to preview */
  pdfBlob: Blob;
  /** Document name */
  fileName: string;
  /** Called when user closes the viewer */
  onClose: () => void;
}

export default function PdfViewer({ pdfBlob, fileName, onClose }: PdfViewerProps) {
  // We use Chrome's built-in PDF viewer via an iframe or object tag
  const url = URL.createObjectURL(pdfBlob);

  return (
    <div className="pdf-viewer-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="pdf-viewer animate-fade-in">
        {/* Header */}
        <div className="pdf-viewer-header">
          <h3 className="pdf-viewer-title">📄 {fileName}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Content */}
        <div className="pdf-viewer-content">
          <iframe
            src={`${url}#toolbar=0`}
            className="pdf-iframe"
            title={fileName}
          />
        </div>
      </div>
    </div>
  );
}
