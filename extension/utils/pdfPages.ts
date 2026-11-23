import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfHandle = PDFDocumentProxy;

export async function openPdf(blob: Blob): Promise<PdfHandle> {
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjsLib.getDocument({ data }).promise;
}

export async function closePdf(pdf: PdfHandle): Promise<void> {
  await pdf.loadingTask.destroy();
}

/**
 * Render a 1-based page to a PNG data URL, scaled so its width is `targetWidth` CSS px (x devicePixelRatio).
 * `extraRotation` (0/90/180/270, clockwise) is added on top of the page's own rotation.
 */
export async function renderPageToDataUrl(pdf: PdfHandle, pageNumber: number, targetWidth: number, extraRotation = 0): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const rotation = (page.rotate + extraRotation) % 360;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = (targetWidth * dpr) / base.width;
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const url = canvas.toDataURL('image/png');
  page.cleanup();
  return url;
}

/**
 * Turn cut positions into 1-based page ranges for PDF.co split, one range per output file.
 * A cut at N means "split after page N". Example: cuts {1,4}, 6 pages -> "1,2-4,5-6".
 */
export function cutsToRanges(cuts: Iterable<number>, totalPages: number): string {
  const points = [...new Set(cuts)].filter((c) => c >= 1 && c < totalPages).sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = 1;
  for (const c of [...points, totalPages]) {
    ranges.push(c > start ? `${start}-${c}` : `${start}`);
    start = c + 1;
  }
  return ranges.join(',');
}

/** Convert page numbers (1-based) to a compact string like "1,3-5" for PDF.co. */
export function pagesToRangeString(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(',');
}
