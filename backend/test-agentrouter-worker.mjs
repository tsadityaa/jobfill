import assert from 'node:assert/strict';
import worker from './src/index.ts';

let forwardedUrl = '';
let forwardedBody;
let shouldTimeout = false;
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
let requestedTimeoutMs = 0;
AbortSignal.timeout = (milliseconds) => {
  requestedTimeoutMs = milliseconds;
  return originalTimeout(milliseconds);
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.endsWith('/auth/v1/user')) {
    return Response.json({ id: 'test-user' });
  }

  if (url === 'https://agentrouter.org/v1/responses') {
    if (shouldTimeout) throw new DOMException('Request timed out.', 'TimeoutError');
    forwardedUrl = url;
    forwardedBody = JSON.parse(String(init.body));
    return Response.json({
      id: 'test-response',
      status: 'completed',
      output_text: '{"personal":{"firstName":"Ravi"}}',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: '{"personal":{"firstName":"Ravi"}}' }],
      }],
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        output_tokens_details: { reasoning_tokens: 0 },
      },
    });
  }

  throw new Error(`Unexpected fetch URL: ${url}`);
};

const requestBody = {
  model: 'gpt-5.6-sol',
  purpose: 'resume-parse',
  reasoning_effort: 'low',
  max_tokens: 16384,
  messages: [
    { role: 'system', content: 'Return a JSON profile.' },
    { role: 'user', content: 'Parse this synthetic resume as JSON.' },
  ],
};
const makeRequest = () => new Request('https://jobfill-worker.test/api/agentrouter', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer test-session',
    Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(requestBody),
});
const env = {
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_ANON_KEY: 'test-anon-key',
  AGENTROUTER_API_KEY: 'test-agentrouter-key',
  AGENTROUTER_MODEL: 'gpt-5.6-sol',
};

try {
  const response = await worker.fetch(makeRequest(), env);

  assert.equal(response.status, 200);
  assert.equal(forwardedUrl, 'https://agentrouter.org/v1/responses');
  assert.equal(forwardedBody.max_output_tokens, 16384);
  assert.deepEqual(forwardedBody.reasoning, { effort: 'none' });
  assert.equal(requestedTimeoutMs, 180000);

  const completion = await response.json();
  assert.equal(completion.choices[0].message.content, '{"personal":{"firstName":"Ravi"}}');

  shouldTimeout = true;
  const timeoutResponse = await worker.fetch(makeRequest(), env);
  assert.equal(timeoutResponse.status, 504);
  const timeoutBody = await timeoutResponse.json();
  assert.match(timeoutBody.error, /timed out/i);
  assert.ok(timeoutResponse.headers.get('X-Request-ID'));
  console.log('PASS: resume parsing forwards the larger budget and reports upstream timeouts as 504.');
} finally {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
}
