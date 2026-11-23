import { useState, useEffect, useCallback } from 'react';
import type { ProcessingOptions } from '../types/document';
import { PROCESSING_PRESETS, formatFileSize } from '../types/document';
import { processImage, getImageDimensions } from '../utils/documentProcessor';

interface ImageEditorProps {
  /** The original image blob to edit */
  imageBlob: Blob;
  /** Original filename for download naming */
  fileName: string;
  /** Called when user closes the editor */
  onClose: () => void;
}

export default function ImageEditor({ imageBlob, fileName, onClose }: ImageEditorProps) {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [originalDims, setOriginalDims] = useState({ width: 0, height: 0 });

  // Processing options
  const [targetWidth, setTargetWidth] = useState<number>(0);
  const [targetHeight, setTargetHeight] = useState<number>(0);
  const [lockAspect, setLockAspect] = useState(true);
  const [format, setFormat] = useState<'image/jpeg' | 'image/png' | 'image/webp'>('image/jpeg');
  const [quality, setQuality] = useState(0.92);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [previewSize, setPreviewSize] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [controlMode, setControlMode] = useState<'presets' | 'custom'>('custom');

  // Load image on mount
  useEffect(() => {
    const url = URL.createObjectURL(imageBlob);
    setImageUrl(url);

    getImageDimensions(imageBlob).then((dims) => {
      setOriginalDims(dims);
      setTargetWidth(dims.width);
      setTargetHeight(dims.height);
    });

    setPreviewSize(imageBlob.size);

    return () => URL.revokeObjectURL(url);
  }, [imageBlob]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const aspectRatio = originalDims.width / (originalDims.height || 1);

  const handleWidthChange = useCallback((w: number) => {
    setTargetWidth(w);
    if (lockAspect && aspectRatio) {
      setTargetHeight(Math.round(w / aspectRatio));
    }
  }, [lockAspect, aspectRatio]);

  const handleHeightChange = useCallback((h: number) => {
    setTargetHeight(h);
    if (lockAspect && aspectRatio) {
      setTargetWidth(Math.round(h * aspectRatio));
    }
  }, [lockAspect, aspectRatio]);

  // Apply preset
  const applyPreset = useCallback((preset: typeof PROCESSING_PRESETS[number]) => {
    const opts = preset.options;
    if (opts.targetWidth) setTargetWidth(opts.targetWidth);
    if (opts.targetHeight) setTargetHeight(opts.targetHeight);
    if (opts.targetFormat) setFormat(opts.targetFormat);
    if (opts.quality) setQuality(opts.quality);
    setLockAspect(false); // presets override aspect lock
  }, []);

  // Generate preview
  const generatePreview = useCallback(async () => {
    setProcessing(true);
    try {
      const options: ProcessingOptions = {
        targetWidth: targetWidth || undefined,
        targetHeight: targetHeight || undefined,
        targetFormat: format,
        quality,
      };

      const result = await processImage(imageBlob, options);
      setPreviewSize(result.size);

      // Create preview URL
      const url = URL.createObjectURL(result);
      setPreviewUrl(url);
    } catch (err) {
      console.error('Processing failed:', err);
    } finally {
      setProcessing(false);
    }
  }, [imageBlob, targetWidth, targetHeight, format, quality]);

  // Download processed image
  const handleDownload = useCallback(async () => {
    setProcessing(true);
    try {
      const options: ProcessingOptions = {
        targetWidth: targetWidth || undefined,
        targetHeight: targetHeight || undefined,
        targetFormat: format,
        quality,
      };

      const result = await processImage(imageBlob, options);
      setPreviewSize(result.size);

      // Create download link
      const ext = format.split('/')[1];
      const baseName = fileName.replace(/\.[^.]+$/, '');
      const downloadName = `${baseName}_${targetWidth}x${targetHeight}.${ext}`;

      const url = URL.createObjectURL(result);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setProcessing(false);
    }
  }, [imageBlob, targetWidth, targetHeight, format, quality, fileName]);

  const resetImageOptions = () => {
    setTargetWidth(originalDims.width);
    setTargetHeight(originalDims.height);
    setLockAspect(true);
    setFormat('image/jpeg');
    setQuality(0.92);
    setPreviewSize(imageBlob.size);
    setPreviewUrl(null);
  };

  return (
    <div className="image-editor-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="image-editor animate-fade-in">
        {/* Header */}
        <div className="image-editor-header">
          <h3 className="image-editor-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            <span>Image Editor</span>
          </h3>
          <button className="image-editor-close" onClick={onClose} aria-label="Close image editor">✕</button>
        </div>

        {/* Preview */}
        <div className="image-editor-preview">
          <img
            src={previewUrl || imageUrl}
            alt="Preview (Click to zoom)"
            title="Click to zoom"
            onClick={() => setZoomed(!zoomed)}
            className={`image-editor-image ${zoomed ? 'zoomed' : ''}`}
          />
          {originalDims.width > 0 && <span className="image-editor-dimension-badge">{originalDims.width} × {originalDims.height}</span>}
        </div>

        {/* Controls */}
        <div className="image-editor-controls">
          <div className="image-editor-mode-switch" role="tablist" aria-label="Image settings mode">
            <button type="button" role="tab" aria-selected={controlMode === 'presets'} className={controlMode === 'presets' ? 'active' : ''} onClick={() => setControlMode('presets')}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Presets
            </button>
            <button type="button" role="tab" aria-selected={controlMode === 'custom'} className={controlMode === 'custom' ? 'active' : ''} onClick={() => setControlMode('custom')}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>
              Custom
            </button>
          </div>

          {controlMode === 'presets' ? (
            <div className="image-editor-presets" role="group" aria-label="Image presets">
              {PROCESSING_PRESETS.map((preset) => (
                <button key={preset.name} type="button" className="image-editor-preset" onClick={() => { applyPreset(preset); setControlMode('custom'); }} title={preset.description}>
                  <strong>{preset.name}</strong><span>{preset.description}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              {/* Dimensions */}
              <div className="image-editor-dimension-row">
                <label className="image-editor-dimension-field">
                  <span>Width</span>
                  <span className="image-editor-number-wrap"><input type="number" value={targetWidth} onChange={(e) => handleWidthChange(Number(e.target.value))} min={1} max={10000} aria-label="Width in pixels"/><i>px</i></span>
                </label>
                <button type="button" className={`btn-aspect-lock ${lockAspect ? 'locked' : ''}`} onClick={() => setLockAspect(!lockAspect)} title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'} aria-label={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}>
                  <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/></svg>
                </button>
                <label className="image-editor-dimension-field">
                  <span>Height</span>
                  <span className="image-editor-number-wrap"><input type="number" value={targetHeight} onChange={(e) => handleHeightChange(Number(e.target.value))} min={1} max={10000} aria-label="Height in pixels"/><i>px</i></span>
                </label>
              </div>
              <div className="image-editor-original-line">
                <span>Original {originalDims.width} × {originalDims.height}</span>
                <button type="button" onClick={resetImageOptions}>Reset</button>
              </div>

              <div className="image-editor-option-line">
                <span className="image-editor-label">Format</span>
                {format === 'image/png' && <span className="image-editor-format-note">Larger than JPEG</span>}
                <div className="image-editor-format-switch" role="group" aria-label="Output format">
                  {([['image/jpeg', 'JPEG'], ['image/png', 'PNG'], ['image/webp', 'WebP']] as const).map(([value, label]) => (
                    <button type="button" key={value} className={format === value ? 'active' : ''} aria-pressed={format === value} onClick={() => setFormat(value)}>{label}</button>
                  ))}
                </div>
              </div>

              <div className="image-editor-quality">
                <div className="image-editor-option-line"><span className="image-editor-label">Quality</span><span>{format === 'image/png' ? 'Not used for PNG' : `${Math.round(quality * 100)}%`}</span></div>
              <input
                type="range"
                className="image-editor-quality-slider"
                min={0.1}
                max={1.0}
                step={0.01}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                disabled={format === 'image/png'}
              />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="image-editor-footer">
          <div className="image-editor-output-size"><span>Size</span><strong>{previewSize !== null ? formatFileSize(previewSize) : '—'}</strong></div>
          <button
            className="image-editor-preview-button"
            onClick={generatePreview}
            disabled={processing}
          >
            {processing ? <span>Processing…</span> : <><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><span>Preview</span></>}
          </button>
          <button
            className="image-editor-download-button"
            onClick={handleDownload}
            disabled={processing}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 17v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3"/></svg>
            <span>Download</span>
          </button>
        </div>
      </div>
    </div>
  );
}
