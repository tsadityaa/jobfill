import { getSession } from './supabase';

const BACKEND_URL = (import.meta.env.VITE_JOBFILL_BACKEND_URL as string | undefined)?.replace(/\/+$/, '');
const OPENROUTER_KEY = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function isBackendConfigured(): boolean {
  return Boolean(BACKEND_URL || (OPENROUTER_KEY && OPENROUTER_KEY !== 'xyzz'));
}

export function getBackendBaseURL(): string {
  if (!BACKEND_URL) throw new Error('Set VITE_JOBFILL_BACKEND_URL to your deployed JobFill Worker URL.');
  return BACKEND_URL;
}

export async function getBackendSessionToken(): Promise<string> {
  getBackendBaseURL();
  const session = await getSession();
  if (!session?.access_token) throw new Error('Sign in to MemoraFill before using AI features.');
  return session.access_token;
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getBackendSessionToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${BACKEND_URL}${path}`, { ...init, headers });
}

/**
 * Helper: call OpenRouter directly using the local API key (no auth needed).
 * Returns null if no key is configured.
 */
function directOpenRouterFetch(payload: unknown, signal?: AbortSignal): Promise<Response> | null {
  if (!OPENROUTER_KEY || OPENROUTER_KEY === 'xyzz') return null;
  return fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Personal Copilot Extension',
    },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function requestOpenRouter(payload: unknown, signal?: AbortSignal): Promise<Response> {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;
  const hasDirectKey = Boolean(OPENROUTER_KEY && OPENROUTER_KEY !== 'xyzz');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;

    if (!BACKEND_URL && hasDirectKey) {
      // No backend configured — go direct
      response = await directOpenRouterFetch(payload, signal)!;
    } else if (BACKEND_URL) {
      // Backend configured — try it, but fall back to direct key on auth failure
      try {
        response = await backendFetch('/api/openrouter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        });
      } catch (err) {
        // Auth failed (session lost after extension reload) — fall back to direct key
        if (hasDirectKey) {
          console.warn('[JobFill OpenRouter] Backend auth failed, falling back to direct OpenRouter API key:', (err as Error).message);
          response = await directOpenRouterFetch(payload, signal)!;
        } else {
          throw err;
        }
      }
    } else {
      throw new Error('No OpenRouter backend or API key configured.');
    }

    // Retry on rate-limit (429) or model overloaded (503)
    if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt); // 2s, 4s, 8s
      console.warn(`[JobFill OpenRouter] HTTP ${response.status} — model overloaded/rate-limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    return response;
  }

  // Should never reach here, but just in case — make the final request without retry
  if (hasDirectKey) return directOpenRouterFetch(payload, signal)!;
  return backendFetch('/api/openrouter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function requestMemory(operation: 'add' | 'search' | 'profile', payload: unknown): Promise<Response> {
  return backendFetch(`/api/memory/${operation}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function requestPdfCo(endpoint: string, body: Record<string, unknown>): Promise<Response> {
  return backendFetch('/api/pdfco', {
    method: 'POST',
    body: JSON.stringify({ endpoint, body }),
  });
}

export async function uploadPdfToBackend(form: FormData): Promise<Response> {
  return backendFetch('/api/pdfco/upload', { method: 'POST', body: form });
}
