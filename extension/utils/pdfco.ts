// ============================================================
// PDF.co API Client — Multi-key fallback pool
// ============================================================
// Correct endpoint versions verified against pdf.co docs.
// Upload uses multipart POST /file/upload (returns a stable URL).
// ============================================================

const BUILT_IN_KEYS: string[] = [
  import.meta.env.VITE_PDFCO_API_KEY ?? '',
  // Add more fallback keys here:
  // 'friend@gmail.com_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
].filter(Boolean);

async function getAllKeys(): Promise<string[]> {
  try {
    const res = await chrome.storage.local.get('pdfco_extra_keys');
    const extra: string[] = res['pdfco_extra_keys'] ?? [];
    return [...BUILT_IN_KEYS, ...extra];
  } catch {
    return BUILT_IN_KEYS;
  }
}

export async function saveExtraKey(key: string): Promise<void> {
  const res = await chrome.storage.local.get('pdfco_extra_keys');
  const existing: string[] = res['pdfco_extra_keys'] ?? [];
  if (!existing.includes(key)) {
    await chrome.storage.local.set({ pdfco_extra_keys: [...existing, key] });
  }
}

export async function getExtraKeys(): Promise<string[]> {
  const res = await chrome.storage.local.get('pdfco_extra_keys');
  return res['pdfco_extra_keys'] ?? [];
}

export async function removeExtraKey(key: string): Promise<void> {
  const res = await chrome.storage.local.get('pdfco_extra_keys');
  const existing: string[] = res['pdfco_extra_keys'] ?? [];
  await chrome.storage.local.set({ pdfco_extra_keys: existing.filter((k) => k !== key) });
}

const BASE = 'https://api.pdf.co/v1';

// ---- Core caller with multi-key fallback ----

async function callApi(
  endpoint: string,
  body: Record<string, unknown>,
  keyIndex = 0,
): Promise<Record<string, unknown>> {
  const keys = await getAllKeys();
  if (keys.length === 0) throw new Error('No PDF.co API key configured. Add one in the ⚙️ Keys tab.');
  if (keyIndex >= keys.length) throw new Error('All PDF.co API keys exhausted. Please add more keys in the ⚙️ Keys tab.');

  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': keys[keyIndex],
    },
    body: JSON.stringify({ ...body, async: false }),
  });

  const data = await res.json() as Record<string, unknown>;

  // Credit exhausted → try next key
  if (
    res.status === 402 ||
    (data.error === true && String(data.message ?? '').toLowerCase().includes('credit'))
  ) {
    console.warn(`[PDF.co] Key ${keyIndex} out of credits, trying next…`);
    return callApi(endpoint, body, keyIndex + 1);
  }

  if (data.error === true) {
    throw new Error(String(data.message ?? 'PDF.co API error'));
  }
  return data;
}

// ---- Upload blob via multipart POST ----
// Uses POST /file/upload which returns { url } — a stable PDF.co-hosted URL
// that can be passed to any processing endpoint.

export async function uploadToPdfCo(blob: Blob, filename: string): Promise<string> {
  const keys = await getAllKeys();
  if (keys.length === 0) throw new Error('No PDF.co API key configured.');

  const form = new FormData();
  form.append('file', blob, filename);

  const res = await fetch(`${BASE}/file/upload`, {
    method: 'POST',
    headers: { 'x-api-key': keys[0] },
    body: form,
  });

  const data = await res.json() as { url?: string; error?: boolean; message?: string };
  if (data.error || !data.url) {
    throw new Error(data.message ?? 'Upload to PDF.co failed');
  }
  return data.url;
}

// ---- Download result blob ----
// PDF.co result URLs are time-limited signed S3 URLs — fetch directly.

export async function downloadResult(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  return res.blob();
}

// ============================================================
// PDF Operations — verified endpoint paths
// ============================================================

/** Compress PDF */
export async function compressPdf(url: string, level: 'low' | 'medium' | 'high' = 'medium'): Promise<string> {
  const qMap = { low: 80, medium: 60, high: 35 };
  const q = qMap[level];
  const data = await callApi('/pdf/optimize', {
    url,
    colorQuality: q,
    grayscaleQuality: q,
    config: {
      images: {
        color: {
          downsample: { skip: false, downsample_ppi: 150, threshold_ppi: 225 },
          compression: { skip: false, compression_format: 'jpeg', compression_params: { quality: q } },
        },
        grayscale: {
          downsample: { skip: false, downsample_ppi: 150, threshold_ppi: 225 },
          compression: { skip: false, compression_format: 'jpeg', compression_params: { quality: q } },
        },
        monochrome: {
          downsample: { skip: false, downsample_ppi: 300, threshold_ppi: 450 },
          compression: { skip: false, compression_format: 'ccitt_g4', compression_params: {} },
        },
      },
      fonts: { subset: true, compress: true },
      save: { garbage: 4 },
    },
  });
  return String(data.url);
}

/** Merge multiple PDFs */
export async function mergePdfs(urls: string[]): Promise<string> {
  const data = await callApi('/pdf/merge2', { urls });
  return String(data.url);
}

/** Split PDF into pages — returns array of URLs */
export async function splitPdf(url: string, pages: string): Promise<string[]> {
  const data = await callApi('/pdf/split', { url, pages });
  const arr = data.urls as string[] | undefined;
  return arr ?? [String(data.url)];
}

/** Rotate PDF pages */
export async function rotatePdf(url: string, angle: 90 | 180 | 270, pages = '0-'): Promise<string> {
  const data = await callApi('/pdf/rotate', { url, pages, angle });
  return String(data.url);
}

/** Add password to PDF */
export async function protectPdf(url: string, userPassword: string): Promise<string> {
  const data = await callApi('/pdf/security/add', {
    url,
    userPassword,
    ownerPassword: userPassword,
    encryptionAlgorithm: 'AES_128bit',
  });
  return String(data.url);
}

/** Remove password from PDF */
export async function unlockPdf(url: string, password: string): Promise<string> {
  const data = await callApi('/pdf/security/remove', { url, password });
  return String(data.url);
}

/** Word/DOCX → PDF */
export async function wordToPdf(url: string): Promise<string> {
  const data = await callApi('/pdf/convert/from/doc', { url });
  return String(data.url);
}

/** PDF → Word/DOCX */
export async function pdfToWord(url: string): Promise<string> {
  const data = await callApi('/pdf/convert/to/doc', { url });
  return String(data.url);
}

/** PDF → JPG images per page */
export async function pdfToImages(url: string, pages = '0-', resolution = 150): Promise<string[]> {
  const data = await callApi('/pdf/convert/to/jpg', { url, pages, resolution, antialiasing: true });
  const arr = data.urls as string[] | undefined;
  return arr ?? [];
}

/** PDF → plain text */
export async function pdfToText(url: string, pages = '0-'): Promise<string> {
  const data = await callApi('/pdf/convert/to/text', { url, pages, inline: true });
  // API returns body inline OR a URL to the text file — handle both
  if (data.body && String(data.body).trim().length > 0) {
    return String(data.body);
  }
  if (data.url) {
    const res = await fetch(String(data.url));
    if (res.ok) return res.text();
  }
  return '';
}

/** OCR — extract text from scanned PDF */
export async function ocrPdf(url: string, pages = '0-', lang = 'eng'): Promise<string> {
  const data = await callApi('/pdf/convert/to/text', {
    url,
    pages,
    lang,
    inline: true,
    ocrLanguage: lang,
  });
  if (data.body && String(data.body).trim().length > 0) {
    return String(data.body);
  }
  if (data.url) {
    const res = await fetch(String(data.url));
    if (res.ok) return res.text();
  }
  return '';
}

/** Add page numbers to every page */
export async function addPageNumbers(url: string): Promise<string> {
  const data = await callApi('/pdf/edit/add', {
    url,
    annotations: [{
      text: '{{page}} / {{pagesTotal}}',
      x: 250,
      y: 820,
      size: 10,
      color: '888888',
      pages: '0-',
      fontName: 'Helvetica',
    }],
  });
  return String(data.url);
}

/** Delete specific pages from PDF */
export async function deletePdfPages(url: string, pages: string): Promise<string> {
  const data = await callApi('/pdf/edit/delete-pages', { url, pages });
  return String(data.url);
}

/** Get PDF metadata */
export async function getPdfInfo(url: string): Promise<{
  pageCount: number;
  title?: string;
  author?: string;
  width?: number;
  height?: number;
}> {
  const data = await callApi('/pdf/info', { url });
  return {
    pageCount: Number(data.pageCount ?? 0),
    title: data.title as string | undefined,
    author: data.author as string | undefined,
    width: Number(data.widthPt ?? 0),
    height: Number(data.heightPt ?? 0),
  };
}
