# JobFill Backend (Cloudflare Workers)

This Worker validates the extension's Supabase access token and proxies only the provider operations used by JobFill. Provider API keys are stored as Worker secrets; they must not be added to the extension's `VITE_` variables.

## Local setup

```sh
cd backend
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with the Supabase project URL, Supabase anon key, and `AGENTROUTER_API_KEY`. Set `AGENTROUTER_MODEL=gpt-5.6-sol`; Supermemory and PDF.co keys are optional unless those features are used. `.dev.vars` is ignored by Git.

```sh
npm run typecheck
npm run dev
```

For local extension development, set `VITE_JOBFILL_BACKEND_URL=http://localhost:8787` and `VITE_AI_MODEL=gpt-5.6-sol` in `extension/.env.development.local`. The Agent Router key belongs only in the backend secret store, never in a `VITE_` variable or the extension bundle. Keep the deployed Worker URL in the production extension environment.

## Deploy

Authenticate once with `npx wrangler login`, then set production secrets:

```sh
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put AGENTROUTER_API_KEY
npx wrangler secret put SUPERMEMORY_API_KEY
npx wrangler secret put PDFCO_API_KEY
npm run deploy
```

Set `VITE_JOBFILL_BACKEND_URL` in `extension/.env.local` to the deployed `https://jobfill-backend.<your-workers-subdomain>.workers.dev` URL, then build and package the extension from `extension/`:

```sh
npm run build
npm run zip
```

The Worker validates every request against Supabase Auth, sends AI requests to Agent Router's `/v1/responses` endpoint using the configured `AGENTROUTER_MODEL`, caps regular AI output at 4096 tokens and resume parsing at 16384 tokens, and allows resume parsing up to 180 seconds for slow upstream responses. Other AI requests use a 60-second upstream timeout. Responses are adapted to the chat-completion shape expected by current extension pipelines. The model is set to `gpt-5.6-sol` in the Worker configuration and can be selected in the extension with `VITE_AI_MODEL`; both values must match. Supermemory namespaces are overwritten with the authenticated Supabase user ID. PDF.co personal keys entered in the extension remain user-owned fallbacks; the shared PDF.co key is kept server-side.

For Cloudflare Git integration, use `backend/` as the project root. Build command: `npm run deploy` (or `npx wrangler deploy`). Preview and production deployments must each have their own Worker secrets.
