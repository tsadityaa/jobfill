import { getSession } from './supabase';

const BACKEND_URL = (import.meta.env.VITE_JOBFILL_BACKEND_URL as string | undefined)?.replace(/\/+$/, '');
export const AI_MODEL = (import.meta.env.VITE_AI_MODEL as string | undefined) || 'gpt-5.6-sol';

export function isBackendConfigured(): boolean {
  return Boolean(BACKEND_URL);
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

export async function requestAgentRouter(payload: unknown, signal?: AbortSignal, purpose = 'unspecified'): Promise<Response> {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;
  // A 502 from the backend means the upstream call failed or returned no assistant text
  // (a transient model glitch). Retry it once; a second 502 is returned to the caller.
  const BAD_GATEWAY_RETRY_DELAY_MS = 1000;
  let retriedBadGateway = false;
  if (!BACKEND_URL) throw new Error('Set VITE_JOBFILL_BACKEND_URL to use Agent Router through the secure backend.');
  const modelPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>), model: AI_MODEL, purpose }
    : payload;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    let response: Response;
    console.info('[AgentRouter] request ' + JSON.stringify({
      id: requestId,
      purpose,
      model: AI_MODEL,
      apiMode: modelPayload && typeof modelPayload === 'object' && 'api_mode' in modelPayload
        ? (modelPayload as Record<string, unknown>).api_mode
        : 'responses',
      reasoningEffort: modelPayload && typeof modelPayload === 'object' && 'reasoning_effort' in modelPayload
        ? (modelPayload as Record<string, unknown>).reasoning_effort
        : 'provider-default',
      maxOutputTokens: modelPayload && typeof modelPayload === 'object' && 'max_tokens' in modelPayload
        ? (modelPayload as Record<string, unknown>).max_tokens
        : undefined,
      attempt: attempt + 1,
    }));
    try {
      response = await backendFetch('/api/agentrouter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': requestId },
        body: JSON.stringify(modelPayload),
        signal,
      });
    } catch (error) {
      console.error('[AgentRouter] call failed ' + JSON.stringify({
        id: requestId,
        purpose,
        model: AI_MODEL,
        attempt: attempt + 1,
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.name : 'UnknownError',
      }));
      throw error;
    }

    const shouldRetryBadGateway = response.status === 502 && !retriedBadGateway && attempt < MAX_RETRIES;
    if (shouldRetryBadGateway) retriedBadGateway = true;
    const retryDelayMs = (response.status === 429 || response.status === 503) && attempt < MAX_RETRIES
      ? BASE_DELAY_MS * Math.pow(2, attempt)
      : shouldRetryBadGateway
        ? BAD_GATEWAY_RETRY_DELAY_MS
        : 0;
    console.info('[AgentRouter] response ' + JSON.stringify({
      id: response.headers.get('X-Request-ID') || requestId,
      purpose,
      model: AI_MODEL,
      attempt: attempt + 1,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      ...(retryDelayMs ? { retryingInMs: retryDelayMs } : {}),
    }));

    // Retry on rate-limit (429), model overloaded (503), or a one-time bad gateway (502)
    if (retryDelayMs) {
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    return response;
  }

  throw new Error('Agent Router retry loop ended unexpectedly.');
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
