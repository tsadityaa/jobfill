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
  if (!session?.access_token) throw new Error('Sign in to JobFill before using AI features.');
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

export async function requestOpenRouter(payload: unknown, signal?: AbortSignal): Promise<Response> {
  if (!BACKEND_URL && OPENROUTER_KEY && OPENROUTER_KEY !== 'xyzz') {
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
