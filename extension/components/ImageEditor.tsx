import { useState, useRef, useEffect, useCallback } from 'react';
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(result);
      setPreviewUrl(url);
    } catch (err) {
      console.error('Processing failed:', err);
    } finally {
      setProcessing(false);
    }
  }, [imageBlob, targetWidth, targetHeight, format, quality, previewUrl]);

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

  return (
    <div className="image-editor-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="image-editor animate-fade-in">
        {/* Header */}
        <div className="image-editor-header">
          <h3 className="image-editor-title">✏️ Image Editor</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Preview */}
        <div className="image-editor-preview">
          <img
            src={previewUrl || imageUrl}
            alt="Preview"
            className="image-editor-img"
          />
        </div>

        {/* Controls */}
        <div className="image-editor-controls">
          {/* Presets */}
          <div className="form-group">
            <label className="form-label">Quick Presets</label>
            <div className="preset-chips">
              {PROCESSING_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  className="preset-chip"
                  onClick={() => applyPreset(preset)}
                  title={preset.description}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Dimensions */}
          <div className="form-group">
            <label className="form-label">Dimensions</label>
            <div className="image-editor-dims">
              <input
                type="number"
                className="form-input"
                value={targetWidth}
                onChange={(e) => handleWidthChange(Number(e.target.value))}
                min={1}
                max={10000}
              />
              <span className="dims-separator">
                <button
                  className={`btn-aspect-lock ${lockAspect ? 'locked' : ''}`}
                  onClick={() => setLockAspect(!lockAspect)}
                  title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                >
                  {lockAspect ? '🔗' : '⛓️‍💥'}
                </button>
              </span>
              <input
                type="number"
                className="form-input"
                value={targetHeight}
                onChange={(e) => handleHeightChange(Number(e.target.value))}
                min={1}
                max={10000}
              />
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--color-pc-text-muted)', marginTop: '2px' }}>
              Original: {originalDims.width} × {originalDims.height}
            </div>
          </div>

          {/* Format */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Format</label>
              <select
                className="form-select"
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
              >
                <option value="image/jpeg">JPEG</option>
                <option value="image/png">PNG</option>
                <option value="image/webp">WebP</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Quality: {Math.round(quality * 100)}%</label>
              <input
                type="range"
                className="quality-slider"
                min={0.1}
                max={1.0}
                step={0.01}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                disabled={format === 'image/png'}
              />
            </div>
          </div>

          {/* Size preview */}
          {previewSize !== null && (
            <div className="image-editor-size-info">
              Estimated size: <strong>{formatFileSize(previewSize)}</strong>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="image-editor-footer">
          <button
            className="btn btn-secondary"
            onClick={generatePreview}
            disabled={processing}
          >
            {processing ? '⏳ Processing...' : '👁 Preview'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleDownload}
            disabled={processing}
          >
            ⬇ Download
          </button>
        </div>
      </div>
    </div>
  );
}
