// AgentRouter docs: https://github.com/agentrouter-org/docs/blob/main/codex.md
// Set AGENT_ROUTER_TOKEN in your shell; do not put the credential in this file.
const apiKey = process.env.AGENT_ROUTER_TOKEN;
if (!apiKey) {
  console.error('Missing AGENT_ROUTER_TOKEN. Set it in the environment and rerun.');
  process.exit(2);
}

const apiBase = 'https://agentrouter.org/v1';
const authHeaders = { Authorization: `Bearer ${apiKey}` };

// First verify the credential and model entitlement using the documented
// OpenAI-compatible models endpoint. Only spend tokens if that succeeds.
const modelsResponse = await fetch(`${apiBase}/models`, { headers: authHeaders });
const modelsBody = await modelsResponse.json().catch(() => null);
console.log(`GET /models: HTTP ${modelsResponse.status}`);
if (!modelsResponse.ok) {
  console.error(JSON.stringify(modelsBody, null, 2));
  process.exit(1);
}

const modelIds = Array.isArray(modelsBody?.data)
  ? modelsBody.data.map((model) => model?.id).filter((id) => typeof id === 'string')
  : [];
console.log(`Models returned: ${modelIds.join(', ') || '(none)'}`);

const model = 'gpt-5.6-sol';
if (modelIds.length && !modelIds.includes(model)) {
  console.error(`The key authenticated, but ${model} is not in its available model list.`);
  process.exit(1);
}

const completionResponse = await fetch(`${apiBase}/chat/completions`, {
  method: 'POST',
  headers: { ...authHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
    max_tokens: 16,
  }),
});
const completionBody = await completionResponse.json().catch(() => null);
console.log(`POST /chat/completions: HTTP ${completionResponse.status}`);
if (!completionResponse.ok) {
  console.error(JSON.stringify(completionBody, null, 2));
  process.exit(1);
}

const answer = completionBody?.choices?.[0]?.message?.content;
if (typeof answer !== 'string' || !answer.trim()) {
  console.error('Request succeeded but returned no assistant text.');
  process.exit(1);
}
console.log(`Model response: ${answer.trim()}`);
