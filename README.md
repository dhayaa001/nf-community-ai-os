# NF Community AI OS

An autonomous AI-powered business operating system — multiple AI agents simulate a
full IT company to run lead generation, sales, project delivery, QA and revenue
management through a queue-driven orchestrator.

This repository is organised for a **5-phase rollout**. Phase 1 is fully
implemented and runs end-to-end out of the box (no credentials required — the
code falls back to stub providers so the chat pipeline works locally). Phases
2–5 are scaffolded as pluggable modules so they can be activated incrementally
without rewrites.

---

## System architecture

```
User → Web (Next.js) → API (NestJS) → Orchestrator → Queue (BullMQ | in-proc)
                                              ↓
                                       Agent Registry
                                              ↓
                         ┌───────┬────────┬─────────┬──────────┐
                         ↓       ↓        ↓         ↓          ↓
                    Community  Lead    Sales    ProjectMgr   Builder …
                         ↓       ↓        ↓
                            Repository (Supabase | memory)
                         ↓       ↓        ↓
                    WebSocket (Socket.io) → Web (Chat + Dashboard)
```

- **Orchestrator** — classifies intent, creates a `Task`, enqueues it. No agent is ever invoked directly from HTTP.
- **Queue** — BullMQ when `REDIS_URL` is set, in-process `setImmediate` executor otherwise.
- **Agents** — each one a single class implementing `Agent { kind; run(ctx) }`. Registry dispatches by `AgentKind`.
- **Repository** — `SupabaseRepository` when creds are set; `MemoryRepository` for dev/CI.
- **Events** — Socket.io broadcasts `task:*`, `message:appended`, `lead:captured`, `agent:stats_updated` to the UI and to the admin dashboard.

---

## Phase roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Chat UI → API → Orchestrator → Community / Lead / Sales → Supabase → WS updates | ✅ **Implemented** |
| 2 | Redis + BullMQ durable queue, worker separation, richer intent router, sales automation | 🧩 Scaffolded (`QueueService` switches on `REDIS_URL`) |
| 3 | Project Manager, Builder, QA, Bug Fix agents; project pipeline; code artifacts | 🧩 Agent stubs in place |
| 4 | Self-improvement: performance evaluator, prompt optimizer, agent versioning, evaluations | 🧩 `agents` + `evaluations` tables present |
| 5 | Stripe revenue, service pricing engine, conversion tracking | 🧩 `RevenueService` with stub provider |

Each phase plugs into the existing module graph — no rewrites required.

---

## Repo layout

```
.
├── apps/
│   ├── api/          # NestJS backend (orchestrator, agents, queue, ws, chat, dashboard, revenue)
│   └── web/          # Next.js 14 App Router frontend (chat + dashboard)
├── packages/
│   ├── shared/       # Domain types, zod schemas, WS event names (imported by both apps)
│   └── db/           # Repository interface + Supabase/Memory implementations + SQL migrations
├── pnpm-workspace.yaml
└── README.md
```

---

## Running locally (no credentials required)

```bash
pnpm install

# Two terminals — or one if you trust pnpm's parallel runner:
pnpm --filter @nf/api dev      # http://localhost:3001
pnpm --filter @nf/web dev      # http://localhost:3000

# Or parallel:
pnpm dev
```

Visit <http://localhost:3000> for the chat UI and <http://localhost:3000/dashboard>
for live stats. Health check: <http://localhost:3001/api/health>.

With **no env vars set**, the app boots using:

- `StubProvider` for LLM calls (scripted replies, deterministic)
- `MemoryRepository` for persistence (data lost on restart)
- in-process queue (no Redis)
- stub checkout URL for revenue flows

To enable real behavior, copy `.env.example` → `.env` at the repo root and at
`apps/web/.env.local` and fill in the keys you have. The app auto-detects what
is present and upgrades transparently.

---

## Environment variables

See `.env.example` for the full list. Summary:

- **LLM** — `OPENAI_API_KEY` (primary), `ANTHROPIC_API_KEY` (fallback). Model names configurable.
- **Supabase** — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Apply `packages/db/migrations/0001_init.sql`.
- **Queue** — `REDIS_URL` (Phase 2).
- **Stripe** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (Phase 5).

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Runs every workspace's `dev` in parallel |
| `pnpm build` | Builds every workspace |
| `pnpm lint` | Lints every workspace |
| `pnpm typecheck` | Type-checks every workspace |
| `pnpm --filter @nf/api <cmd>` | Run a command against a single workspace |

---

## Extending the system

**Adding an agent** (Phase 3+):

1. Create `apps/api/src/agents/my-new.agent.ts` implementing `Agent`.
2. Add it to the providers list in `agents.module.ts` and inject into `AgentRegistry`.
3. Route at least one `Intent` to it in `OrchestratorService.routeIntent`.

**Adding a queue worker** (Phase 2+):

- Register a new BullMQ worker in `QueueService` (currently there is one orchestrator queue).
- Agents that need sandboxed execution (e.g. Builder generating code) should push their own jobs into their own queue and expose progress events via `EventsGateway`.

**Adding persistence** (Phase 4+):

- Extend `Repository` in `packages/db/src/repository.ts` with new methods.
- Implement in both `SupabaseRepository` and `MemoryRepository`.
- Add SQL to `packages/db/migrations/` with a new sequence number.

---

## Known limitations (by design for Phase 1)

- No auth — the UI is public; add Supabase Auth in Phase 2.
- No rate limiting — add a Nest guard before hooking up to real paying users.
- `MemoryRepository` is for dev only; production MUST set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- The stub LLM provider is meant to make local development painless. It is not a substitute for a real model.
