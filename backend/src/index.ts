export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  OPENROUTER_API_KEY: string;
  SUPERMEMORY_API_KEY?: string;
  PDFCO_API_KEY?: string;
}

interface AuthenticatedUser {
  id: string;
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const PDFCO_URL = 'https://api.pdf.co/v1';
const OPENROUTER_MODELS = new Set(['openai/gpt-4o-mini']);
const PDFCO_ENDPOINTS = new Set([
  '/pdf/optimize',
  '/pdf/merge2',
  '/pdf/split',
  '/pdf/edit/rotate',
  '/pdf/security/add',
  '/pdf/security/remove',
  '/pdf/convert/from/doc',
  '/pdf/convert/to/docx',
  '/pdf/convert/to/jpg',
  '/pdf/convert/to/text',
  '/pdf/edit/add',
  '/pdf/edit/delete-pages',
  '/pdf/info',
]);
const MAX_JSON_BYTES = 1_000_000;
const MAX_PDF_UPLOAD_BYTES = 20_000_000;

function isAllowedOrigin(origin: string): boolean {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  if (origin && isAllowedOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function jsonResponse(request: Request, payload: unknown, status = 200): Response {
  const headers = corsHeaders(request.headers.get('Origin'));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), { status, headers });
}

function proxyResponse(request: Request, upstream: Response): Response {
  const headers = corsHeaders(request.headers.get('Origin'));
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_JSON_BYTES) return null;
  const payload: unknown = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

async function authenticate(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error('Supabase auth is not configured.');

  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: authorization,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const user = await response.json() as { id?: unknown };
  return typeof user.id === 'string' && user.id ? { id: user.id } : null;
}

async function handleOpenRouter(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);
  if (!env.OPENROUTER_API_KEY) return jsonResponse(request, { error: 'OpenRouter is not configured.' }, 503);

  const payload = await readJson(request);
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 100) {
    return jsonResponse(request, { error: 'Invalid chat-completion request.' }, 400);
  }
  if (typeof payload.model !== 'string' || !OPENROUTER_MODELS.has(payload.model)) {
    return jsonResponse(request, { error: 'Requested model is not allowed.' }, 400);
  }

  const maxTokens = typeof payload.max_tokens === 'number'
    ? Math.max(1, Math.min(Math.floor(payload.max_tokens), 4096))
    : 1024;
  const safePayload = { ...payload, max_tokens: maxTokens, stream: false };
  const upstream = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://jobfill.app',
      'X-Title': 'JobFill',
    },
    body: JSON.stringify(safePayload),
    signal: AbortSignal.timeout(60_000),
  });
  return proxyResponse(request, upstream);
}

async function handleMemory(request: Request, url: URL, user: AuthenticatedUser, env: Env): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);
  if (!env.SUPERMEMORY_API_KEY) return jsonResponse(request, { error: 'Supermemory is not configured.' }, 503);

  const payload = await readJson(request);
  if (!payload) return jsonResponse(request, { error: 'Invalid Supermemory request.' }, 400);

  const operation = url.pathname.slice('/api/memory/'.length);
  let path: string;
  let upstreamPayload: Record<string, unknown>;
  if (operation === 'add') {
    if (typeof payload.content !== 'string' || !payload.content.trim() || payload.content.length > 100_000) {
      return jsonResponse(request, { error: 'Memory content is required and must be under 100 KB.' }, 400);
    }
    path = '/v3/documents';
    upstreamPayload = {
      content: payload.content,
      containerTag: user.id,
      ...(payload.metadata && typeof payload.metadata === 'object' ? { metadata: payload.metadata } : {}),
    };
  } else if (operation === 'search') {
    if (typeof payload.query !== 'string' || !payload.query.trim() || payload.query.length > 2_000) {
      return jsonResponse(request, { error: 'A search query under 2 KB is required.' }, 400);
    }
    path = '/v4/search';
    upstreamPayload = { q: payload.query, containerTag: user.id, searchMode: 'hybrid', limit: 5 };
  } else if (operation === 'profile') {
    path = '/v4/profile';
    upstreamPayload = { containerTag: user.id };
  } else {
    return jsonResponse(request, { error: 'Memory operation is not allowed.' }, 404);
  }

  const upstream = await fetch(`${SUPERMEMORY_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPERMEMORY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upstreamPayload),
    signal: AbortSignal.timeout(30_000),
  });
  return proxyResponse(request, upstream);
}

async function handlePdfCo(request: Request, url: URL, env: Env): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);
  if (!env.PDFCO_API_KEY) return jsonResponse(request, { error: 'PDF.co is not configured on the backend.' }, 503);

  if (url.pathname === '/api/pdfco/upload') {
    const length = Number(request.headers.get('Content-Length') ?? 0);
    if (length > MAX_PDF_UPLOAD_BYTES) return jsonResponse(request, { error: 'PDF upload exceeds the 20 MB limit.' }, 413);
    const contentType = request.headers.get('Content-Type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
      return jsonResponse(request, { error: 'Expected multipart form data.' }, 400);
    }
    const upstream = await fetch(`${PDFCO_URL}/file/upload`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-api-key': env.PDFCO_API_KEY },
      body: request.body,
      signal: AbortSignal.timeout(60_000),
    });
    return proxyResponse(request, upstream);
  }

  const payload = await readJson(request);
  const endpoint = payload?.endpoint;
  const body = payload?.body;
  if (typeof endpoint !== 'string' || !PDFCO_ENDPOINTS.has(endpoint)
    || !body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(request, { error: 'PDF.co operation is not allowed or the request is invalid.' }, 400);
  }
  const upstream = await fetch(`${PDFCO_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.PDFCO_API_KEY },
    body: JSON.stringify({ ...(body as Record<string, unknown>), async: false }),
    signal: AbortSignal.timeout(60_000),
  });
  return proxyResponse(request, upstream);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && !isAllowedOrigin(origin)) return new Response('Origin not allowed.', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method === 'GET' && url.pathname === '/health') return jsonResponse(request, { ok: true });

    try {
      const user = await authenticate(request, env);
      if (!user) return jsonResponse(request, { error: 'A valid JobFill session is required.' }, 401);
      if (url.pathname === '/api/openrouter') return await handleOpenRouter(request, env);
      if (url.pathname.startsWith('/api/memory/')) return await handleMemory(request, url, user, env);
      if (url.pathname === '/api/pdfco') return await handlePdfCo(request, url, env);
      if (url.pathname === '/api/pdfco/upload') return await handlePdfCo(request, url, env);
      return jsonResponse(request, { error: 'Not found.' }, 404);
    } catch (error) {
      console.error('JobFill backend request failed:', error instanceof Error ? error.message : 'Unknown error');
      return jsonResponse(request, { error: 'The backend could not process this request.' }, 502);
    }
  },
};
