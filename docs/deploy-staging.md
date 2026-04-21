# Staging deployment guide

A reference run-book for getting the Phase 1 MVP onto a real staging URL
with real Supabase persistence and real LLM providers. Written against the
free tiers of Supabase + Vercel + Render so you can stand it up without
opening a wallet.

Out of scope: Phase 2 durable queue (Redis), Phase 5 Stripe webhooks, auth.
Each section notes what to revisit when those land.

---

## 0. Environment matrix

| Variable | Scope | Required for staging? | Effect when unset |
|---|---|---|---|
| `SUPABASE_URL` | api | yes | Falls back to `MemoryRepository` (data lost on restart) |
| `SUPABASE_SERVICE_ROLE_KEY` | api | yes | Same as above |
| `OPENAI_API_KEY` | api | recommended | Falls back to Anthropic if set, else `StubProvider` |
| `OPENAI_MODEL` | api | no | Defaults to a GPT-4 class model in code |
| `ANTHROPIC_API_KEY` | api | optional | Used when OpenAI is unset or errors |
| `ANTHROPIC_MODEL` | api | no | Defaults in code |
| `API_PORT` | api | no | Defaults to `3001`; set to whatever your host exposes |
| `API_CORS_ORIGIN` | api | yes | Comma-separated list of allowed origins — MUST include the Vercel URL |
| `REDIS_URL` | api | no (Phase 2) | In-process queue is used; no retries, no persistence |
| `STRIPE_SECRET_KEY` | api | no (Phase 5) | `RevenueService` returns a stub checkout URL |
| `STRIPE_WEBHOOK_SECRET` | api | no (Phase 5) | — |
| `LOG_LEVEL` | api | no | Nest default (`log`); set `debug` to see intent-classifier logs |
| `NEXT_PUBLIC_API_URL` | web | yes | Frontend REST base URL — the Render API URL |
| `NEXT_PUBLIC_WS_URL` | web | yes | Frontend Socket.io URL — same host as API |

API reads from `process.env` directly in code. There is no `apps/api/.env.example`
yet — [tech-debt.md](./tech-debt.md) E3 tracks adding one. Until then this
table is the source of truth.

---

## 1. Supabase — schema + keys

1. Create a new Supabase project. Region: closest to where the API will run.
2. Copy the **Project URL** and the **`service_role` key** from Project Settings → API. Never ship the `service_role` to the browser — it's API-only.
3. Apply migrations in order, via the SQL editor or the Supabase CLI:

   ```
   packages/db/migrations/0001_init.sql
   packages/db/migrations/0002_agent_stats_rpc.sql
   ```

   `0001_init.sql` creates `conversations`, `messages`, `tasks`, `leads`,
   `agents`, `evaluations`. `0002_agent_stats_rpc.sql` adds the
   `increment_agent_stats` Postgres function used for atomic per-agent
   counter updates — without it, agent stats writes will error.

4. (optional, recommended) Enable RLS on every table and add a policy that
   denies anon reads. The API is service-role only, so nothing needs public
   read access.

Smoke-test locally before pushing to the host:

```bash
export SUPABASE_URL=https://xxxxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...
pnpm --filter @nf/api dev
curl http://localhost:3001/api/health
# → {"status":"ok","repository":"supabase","llm":"stub",...}
```

If `repository` still reports `memory`, the Supabase client failed to init —
check the URL and key, and tail the API logs for the boot error.

---

## 2. API — deploy to Render (example)

Any Node 22 host works (Render, Railway, Fly, a VPS). Render example:

1. New Web Service → connect the repo → branch `main`.
2. Build command:
   ```bash
   corepack enable && pnpm install --frozen-lockfile && pnpm -r build
   ```
3. Start command:
   ```bash
   node apps/api/dist/main.js
   ```
4. Environment: paste the `api`-scoped variables from §0. At minimum:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY` (or leave unset for stub behavior)
   - `API_CORS_ORIGIN=https://<your-web>.vercel.app`
5. Health check path: `/api/health`.
6. Deploy. After it's live, record the URL — you'll paste it into the web
   env in step 3.

**Build ordering gotcha**: `@nf/shared` and `@nf/db` emit to their own
`dist/` and the API loads compiled JS from workspace symlinks. `pnpm -r build`
handles this via topological order, but a partial build
(`pnpm --filter @nf/api build` in isolation) will crash on module load.
Always use the full recursive build in CI and on the host.

**Node version**: pin Node 22 on the host — the repo runs on 22.12.0 and
`packageManager: pnpm@9.15.1`. On Render, set the `NODE_VERSION` env to
`22`; on Railway use a `nvmrc`; on Fly use the Node image tag.

---

## 3. Web — deploy to Vercel

1. Import the repo on Vercel → framework preset: **Next.js** → root directory: `apps/web`.
2. Build command (override):
   ```bash
   cd ../.. && corepack enable && pnpm install --frozen-lockfile && pnpm -r build
   ```
   The `cd ../..` is important — Vercel defaults to running in the root
   directory, but the monorepo needs to build `@nf/shared` and `@nf/db`
   first so `apps/web` can resolve them.
3. Output directory: leave Next.js defaults.
4. Environment:
   - `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com`
   - `NEXT_PUBLIC_WS_URL=https://<your-api>.onrender.com`
5. Deploy. Record the production URL.
6. Go back to the API host and add the Vercel URL to `API_CORS_ORIGIN`.
   Keep them comma-separated if you have both a preview and a prod alias —
   `main.ts` and `EventsGateway` both trim and filter-empty so whitespace
   is fine:
   ```
   API_CORS_ORIGIN=https://<prod>.vercel.app, https://<preview>.vercel.app
   ```
7. Re-deploy the API so the new CORS env is picked up.

---

## 4. Smoke test the deployed stack

Replace `API` and `WEB` with your deployed URLs.

```bash
# 1. Health — reports which adapters are live
curl https://$API/api/health
# Expect: {"status":"ok","repository":"supabase","llm":"openai",...}

# 2. Round-trip through the orchestrator
curl -X POST https://$API/api/chat/messages \
  -H 'content-type: application/json' \
  -d '{"message":"I need a landing page for a SaaS, budget $3k, due in 2 weeks"}'
# Expect: { conversation, userMessage, task } — 200 OK

# 3. Dashboard counters
curl https://$API/api/dashboard/summary
# Expect: conversations: 1, leads: >=1, tasks: 1 (once the queue handler finishes)
```

Browser smoke test:

1. Open `https://$WEB/`. Send `I need an app, budget $5k, due in 3 weeks`.
2. Confirm the user bubble appears, the assistant bubble lands, and the
   green "Lead captured" pill renders within ~2s.
3. Open `https://$WEB/dashboard` in a new tab. Counters should reflect the
   activity without a manual refresh.
4. Send a 2nd message in the same conversation; the `Agent working (…)`
   label should persist through the second task and clear only on the
   second reply (this is the [PR #2](https://github.com/dhayaa001/nf-community-ai-os/pull/2) regression-fix).

---

## 5. Rollback

- Backend: redeploy the previous Render commit.
- Frontend: promote a prior Vercel deployment.
- Database: Supabase migrations are forward-only — if a migration in
  `packages/db/migrations/` needs to be reversed, author a compensating
  migration. Do **not** hand-edit the schema in the Supabase UI; the next
  deploy will undo it.

---

## 6. Phase 2 — when you add Redis

1. Provision a Redis instance (Upstash free tier works).
2. Set `REDIS_URL=redis://…` on the API host.
3. Redeploy. `QueueService` will log `Queue mode=bullmq` instead of `memory`.
4. Before going live, read [tech-debt.md](./tech-debt.md) A3 — the
   orchestrator's `dispatch()` is not idempotent against retries.

## 7. Known deployment caveats

- The first time a fresh browser connects, Socket.io may receive `task:*`
  events for an in-flight message before `subscribe:conversation` has
  landed. The REST back-fill in the chat panel covers this — no action
  needed — but it's the reason every UI change on Phase 1 must preserve
  the back-fill effect in [`chat-panel.tsx`](../apps/web/src/components/chat-panel.tsx).
- `MemoryRepository` is a fallback, not a degraded mode. If you deploy
  without Supabase, every restart wipes all conversations and leads.
  Tech-debt item A4 proposes a production boot-refusal when `NODE_ENV=production`
  and no `SUPABASE_URL`; worth reviewing before the first paying customer.
- The stub LLM is deterministic but has a known regression on multi-turn
  lead extraction — see [tech-debt.md](./tech-debt.md) A1. Use real LLM
  keys in staging to avoid confusion.
