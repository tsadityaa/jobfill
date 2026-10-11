# JobFill Backend (Cloudflare Workers)

This Worker validates the extension's Supabase access token and proxies only the provider operations used by JobFill. Provider API keys are stored as Worker secrets; they must not be added to the extension's `VITE_` variables.

## Local setup

```sh
cd backend
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with the Supabase project URL, Supabase anon key, and OpenRouter key. Supermemory and PDF.co keys are optional unless those features are used. `.dev.vars` is ignored by Git.

```sh
npm run typecheck
npm run dev
```

Set `VITE_JOBFILL_BACKEND_URL=http://localhost:8787` in `extension/.env.local` for local extension testing. The extension env file should contain only the Supabase URL, Supabase anon key, and backend URL, never provider keys.

## Deploy

Authenticate once with `npx wrangler login`, then set production secrets:

```sh
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put SUPERMEMORY_API_KEY
npx wrangler secret put PDFCO_API_KEY
npm run deploy
```

Set `VITE_JOBFILL_BACKEND_URL` in `extension/.env.local` to the deployed `https://jobfill-backend.<your-workers-subdomain>.workers.dev` URL, then build and package the extension from `extension/`:

```sh
npm run build
npm run zip
```

The Worker only permits the OpenRouter model JobFill currently uses, limits completion tokens, validates every request against Supabase Auth, and overwrites Supermemory's namespace with the authenticated Supabase user ID. PDF.co personal keys entered in the extension remain user-owned fallbacks; the shared PDF.co key is kept server-side.

For Cloudflare Git integration, use `backend/` as the project root. Build command: `npm run deploy` (or `npx wrangler deploy`). Preview and production deployments must each have their own Worker secrets.
