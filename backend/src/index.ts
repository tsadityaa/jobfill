export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  AGENTROUTER_API_KEY: string;
  AGENTROUTER_MODEL?: string;
  SUPERMEMORY_API_KEY?: string;
  PDFCO_API_KEY?: string;
}

interface AuthenticatedUser {
  id: string;
}

const AGENTROUTER_URL = 'https://agentrouter.org/v1/responses';
const SUPERMEMORY_URL = 'https://api.supermemory.ai';
const PDFCO_URL = 'https://api.pdf.co/v1';
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
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Request-ID',
    'Access-Control-Expose-Headers': 'X-Request-ID',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  if (origin && isAllowedOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function jsonResponse(request: Request, payload: unknown, status = 200, requestId?: string): Response {
  const headers = corsHeaders(request.headers.get('Origin'));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (requestId) headers.set('X-Request-ID', requestId);
  return new Response(JSON.stringify(payload), { status, headers });
}

function proxyResponse(request: Request, upstream: Response, requestId?: string): Response {
  const headers = corsHeaders(request.headers.get('Origin'));
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  if (requestId) headers.set('X-Request-ID', requestId);
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

async function handleAgentRouter(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Method not allowed.' }, 405);
  if (!env.AGENTROUTER_API_KEY) return jsonResponse(request, { error: 'Agent Router is not configured.' }, 503);

  const payload = await readJson(request);
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > 100) {
    return jsonResponse(request, { error: 'Invalid chat-completion request.' }, 400);
  }
  const model = env.AGENTROUTER_MODEL || 'gpt-5.6-sol';
  if (typeof payload.model !== 'string' || payload.model !== model) {
    return jsonResponse(request, { error: 'Requested model is not allowed.' }, 400);
  }

  const messages = payload.messages as Array<Record<string, unknown>>;
  if (messages.some((message) => !['system', 'developer', 'user', 'assistant'].includes(String(message?.role))
    || typeof message?.content !== 'string')) {
    return jsonResponse(request, { error: 'Invalid chat-completion messages.' }, 400);
  }
  const instructions = messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => message.content as string)
    .join('\n\n');
  const input = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role, content: message.content }));
  if (input.length === 0) return jsonResponse(request, { error: 'At least one user or assistant message is required.' }, 400);

  const requestPurpose = typeof payload.purpose === 'string' ? payload.purpose : 'unspecified';
  // Resume extraction can need a larger completion budget because reasoning
  // tokens count against max_output_tokens too. Keep other AI tasks capped.
  const outputTokenCap = requestPurpose === 'resume-parse' ? 16384 : 4096;
  const maxTokens = typeof payload.max_tokens === 'number'
    ? Math.max(1, Math.min(Math.floor(payload.max_tokens), outputTokenCap))
    : 1024;
  const reasoningEffort = requestPurpose === 'resume-parse'
    ? 'none'
    : payload.reasoning_effort === 'none' || payload.reasoning_effort === 'low'
      ? payload.reasoning_effort
      : undefined;
  const upstreamTimeoutMs = requestPurpose === 'resume-parse' ? 180_000 : 60_000;
  const requestBody: Record<string, unknown> = {
    model,
    instructions,
    input,
    max_output_tokens: maxTokens,
    stream: false,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
  };
  // Callers still pass temperature, but Agent Router rejects it for gpt-5.6-sol,
  // so omit it from the upstream request.
  // JSON-only prompts already instruct the model to return JSON. Agent Router
  // rejects json_object mode unless the user input itself contains "json".

  const suppliedRequestId = request.headers.get('X-Request-ID');
  const requestId = suppliedRequestId && /^[A-Za-z0-9-]{1,80}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  const startedAt = Date.now();
  const inputCharacters = messages.reduce((total, message) => total + (message.content as string).length, 0);
  console.info('[AgentRouter] upstream request ' + JSON.stringify({
    id: requestId,
    model,
    purpose: requestPurpose,
    endpoint: '/v1/responses',
    maxOutputTokens: maxTokens,
    reasoningEffort: reasoningEffort ?? 'provider-default',
    upstreamTimeoutMs,
    inputMessages: messages.length,
    inputCharacters,
  }));
  let upstream: Response;
  try {
    upstream = await fetch(AGENTROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AGENTROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': 'codex_cli_rs/0.101.0 (Mac OS; arm64)',
        Originator: 'codex_cli_rs',
        Version: '0.101.0',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const timedOut = errorName === 'TimeoutError' || errorName === 'AbortError';
    console.error('[AgentRouter] upstream call failed ' + JSON.stringify({
      id: requestId,
      model,
      purpose: requestPurpose,
      durationMs: Date.now() - startedAt,
      timeoutMs: upstreamTimeoutMs,
      error: errorName,
    }));
    return jsonResponse(request, {
      error: timedOut
        ? (requestPurpose === 'resume-parse'
          ? 'Resume parsing timed out while waiting for Agent Router. Please try again or fill manually.'
          : 'Agent Router timed out. Please try again.')
        : 'Could not connect to Agent Router. Please try again.',
    }, timedOut ? 504 : 502, requestId);
  }
  if (!upstream.ok) {
    console.warn('[AgentRouter] upstream response ' + JSON.stringify({
      id: requestId,
      model,
      purpose: requestPurpose,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
      inputMessages: input.length,
    }));
    return proxyResponse(request, upstream, requestId);
  }

  let data: Record<string, unknown>;
  try {
    data = await upstream.json() as Record<string, unknown>;
  } catch (error) {
    console.error('[AgentRouter] upstream response invalid-json ' + JSON.stringify({
      id: requestId,
      model,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.name : 'UnknownError',
    }));
    return jsonResponse(request, { error: 'Agent Router returned an invalid response.' }, 502, requestId);
  }
  const output = Array.isArray(data.output) ? data.output as Array<Record<string, unknown>> : [];
  const outputText = typeof data.output_text === 'string' ? data.output_text.trim() : '';
  const responseOutputText = output
    .filter((item) => item.type === 'message' && Array.isArray(item.content))
    .flatMap((item) => (item.content as Array<Record<string, unknown>>)
      .filter((part) => typeof part.text === 'string')
      .map((part) => part.text as string))
    .join('')
    .trim();
  // Some OpenAI-compatible gateways return Chat Completions-shaped responses
  // even on /responses. Accept that shape too, and never let an empty
  // output_text mask usable text in another response field.
  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const firstChoice = choices[0];
  const firstMessage = firstChoice?.message && typeof firstChoice.message === 'object'
    ? firstChoice.message as Record<string, unknown>
    : {};
  const choiceContent = typeof firstMessage.content === 'string'
    ? firstMessage.content.trim()
    : Array.isArray(firstMessage.content)
      ? (firstMessage.content as Array<Record<string, unknown>>)
        .filter((part) => typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('')
        .trim()
      : '';
  const text = outputText || responseOutputText || choiceContent;
  const usage = data.usage && typeof data.usage === 'object'
    ? data.usage as Record<string, unknown>
    : {};
  const outputTokenDetails = usage.output_tokens_details && typeof usage.output_tokens_details === 'object'
    ? usage.output_tokens_details as Record<string, unknown>
    : {};
  const completionTokenDetails = usage.completion_tokens_details && typeof usage.completion_tokens_details === 'object'
    ? usage.completion_tokens_details as Record<string, unknown>
    : {};
  const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? null;
  const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? null;
  const reasoningTokens = outputTokenDetails.reasoning_tokens ?? completionTokenDetails.reasoning_tokens ?? null;
  if (!text) {
    const incompleteDetails = data.incomplete_details && typeof data.incomplete_details === 'object'
      ? data.incomplete_details as Record<string, unknown>
      : {};
    const incompleteReason = typeof incompleteDetails.reason === 'string' ? incompleteDetails.reason : null;
    console.warn('[AgentRouter] successful response contained no assistant text ' + JSON.stringify({
      id: requestId,
      model,
      purpose: requestPurpose,
      endpoint: '/v1/responses',
      status: upstream.status,
      responseStatus: data.status ?? null,
      incompleteReason,
      durationMs: Date.now() - startedAt,
      outputTextLength: outputText.length,
      outputTypes: output.map((item) => item.type ?? 'unknown'),
      // Shows what the empty "message" item actually contained (for example output_text with empty text, or refusal).
      outputContentTypes: output.flatMap((item) => Array.isArray(item.content)
        ? (item.content as Array<Record<string, unknown>>).map((part) => part.type ?? 'unknown')
        : []),
      choiceCount: choices.length,
      finishReason: firstChoice?.finish_reason ?? null,
      inputTokens,
      outputTokens,
      reasoningTokens,
    }));
    const error = incompleteReason === 'max_output_tokens' || firstChoice?.finish_reason === 'length'
      ? 'Agent Router reached the output token limit before returning resume data. Please retry.'
      : 'Agent Router returned no assistant text. Please retry.';
    return jsonResponse(request, { error }, 502, requestId);
  }
  console.info('[AgentRouter] upstream response ' + JSON.stringify({
    id: requestId,
    model,
    purpose: requestPurpose,
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    inputMessages: input.length,
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
  }));
  return jsonResponse(request, {
    id: data.id ?? '',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: inputTokens ?? 0,
      completion_tokens: outputTokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
    },
  }, 200, requestId);
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
      if (url.pathname === '/api/agentrouter') return await handleAgentRouter(request, env);
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
