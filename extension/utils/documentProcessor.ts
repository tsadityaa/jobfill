// ============================================================
// Document Processor — Canvas API Image Processing
// ============================================================
// All processing happens client-side using the browser-native
// Canvas API. Zero external dependencies.
//
// For high-quality downsizing, we use multi-step downsampling
// (halving dimensions step by step) which produces much sharper
// results than a single large resize.
// ============================================================

import type { ProcessingOptions, CropRect } from '../types/document';

// ---- Internal Helpers ----

/**
 * Load a Blob/File into an HTMLImageElement.
 */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * Convert a canvas to a Blob.
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string = 'image/jpeg',
  quality: number = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob failed'));
      },
      mimeType,
      quality,
    );
  });
}

/**
 * Multi-step downsampling for high quality resize.
 * Halves the image dimensions step by step until we reach the target,
 * then does one final precise resize. This avoids the blurriness of
 * a single large downscale.
 */
function multiStepDownsample(
  source: HTMLImageElement | HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement {
  let currentWidth = 'naturalWidth' in source ? source.naturalWidth : source.width;
  let currentHeight = 'naturalHeight' in source ? source.naturalHeight : source.height;
  let currentSource: HTMLImageElement | HTMLCanvasElement = source;

  // Step down by halves until close to target
  while (currentWidth / 2 > targetWidth && currentHeight / 2 > targetHeight) {
    const stepCanvas = document.createElement('canvas');
    const halfW = Math.round(currentWidth / 2);
    const halfH = Math.round(currentHeight / 2);
    stepCanvas.width = halfW;
    stepCanvas.height = halfH;

    const ctx = stepCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(currentSource, 0, 0, halfW, halfH);

    currentSource = stepCanvas;
    currentWidth = halfW;
    currentHeight = halfH;
  }

  // Final resize to exact target
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = targetWidth;
  finalCanvas.height = targetHeight;

  const ctx = finalCanvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(currentSource, 0, 0, targetWidth, targetHeight);

  return finalCanvas;
}

// ---- Public API ----

/**
 * Get the dimensions of an image blob without fully decoding it.
 */
export async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const img = await loadImage(blob);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/**
 * Resize an image to the specified dimensions.
 * Uses multi-step downsampling for high quality results.
 */
export async function resizeImage(
  blob: Blob,
  width: number,
  height: number,
  format: string = 'image/jpeg',
  quality: number = 0.92,
): Promise<Blob> {
  const img = await loadImage(blob);

  // Use multi-step for downsizing, single step for upsizing
  const isDownsizing = width < img.naturalWidth || height < img.naturalHeight;
  let canvas: HTMLCanvasElement;

  if (isDownsizing) {
    canvas = multiStepDownsample(img, width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
  }

  return canvasToBlob(canvas, format, quality);
}

/**
 * Crop an image to the specified rectangle.
 */
export async function cropImage(
  blob: Blob,
  cropRect: CropRect,
  format: string = 'image/jpeg',
  quality: number = 0.92,
): Promise<Blob> {
  const img = await loadImage(blob);

  const canvas = document.createElement('canvas');
  canvas.width = cropRect.w;
  canvas.height = cropRect.h;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    img,
    cropRect.x, cropRect.y, cropRect.w, cropRect.h,
    0, 0, cropRect.w, cropRect.h,
  );

  return canvasToBlob(canvas, format, quality);
}

/**
 * Compress an image to hit a target file size using binary search on quality.
 */
export async function compressImage(
  blob: Blob,
  targetSizeKB: number,
  format: string = 'image/jpeg',
): Promise<Blob> {
  const img = await loadImage(blob);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const targetBytes = targetSizeKB * 1024;

  // If it's already under target at max quality, return as-is
  let result = await canvasToBlob(canvas, format, 1.0);
  if (result.size <= targetBytes) return result;

  // Binary search for the right quality
  let lo = 0.1;
  let hi = 1.0;
  let bestBlob = result;

  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const attempt = await canvasToBlob(canvas, format, mid);

    if (attempt.size <= targetBytes) {
      bestBlob = attempt;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return bestBlob;
}

/**
 * Convert an image to a different format.
 */
export async function convertFormat(
  blob: Blob,
  targetFormat: string,
  quality: number = 0.92,
): Promise<Blob> {
  const img = await loadImage(blob);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;

  // For JPEG, fill with white background (no transparency)
  if (targetFormat === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.drawImage(img, 0, 0);
  return canvasToBlob(canvas, targetFormat, quality);
}

/**
 * Generate a small thumbnail for the document card UI.
 */
export async function generateThumbnail(
  blob: Blob,
  size: number = 64,
): Promise<string> {
  const img = await loadImage(blob);

  // Calculate cover-fit dimensions
  const aspect = img.naturalWidth / img.naturalHeight;
  let drawW = size;
  let drawH = size;
  let offsetX = 0;
  let offsetY = 0;

  if (aspect > 1) {
    drawW = size * aspect;
    offsetX = -(drawW - size) / 2;
  } else {
    drawH = size / aspect;
    offsetY = -(drawH - size) / 2;
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

  return canvas.toDataURL('image/jpeg', 0.7);
}

/**
 * All-in-one processing pipeline: crop → resize → convert → compress.
 */
export async function processImage(
  blob: Blob,
  options: ProcessingOptions,
): Promise<Blob> {
  let result = blob;
  const format = options.targetFormat ?? blob.type ?? 'image/jpeg';
  const quality = options.quality ?? 0.92;

  // Step 1: Crop (if specified)
  if (options.cropRect) {
    result = await cropImage(result, options.cropRect, format, quality);
  }

  // Step 2: Resize (if specified)
  if (options.targetWidth && options.targetHeight) {
    result = await resizeImage(result, options.targetWidth, options.targetHeight, format, quality);
  } else if (options.targetFormat || options.quality) {
    // Just convert format / adjust quality without resize
    result = await convertFormat(result, format, quality);
  }

  // Step 3: Compress to target size (if specified)
  if (options.maxSizeKB && result.size > options.maxSizeKB * 1024) {
    result = await compressImage(result, options.maxSizeKB, format);
  }

  return result;
}
