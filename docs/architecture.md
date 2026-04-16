# Architecture — NF Community AI OS

Phase 1 ships a queue-driven orchestrator that turns one HTTP POST into an
agent-backed conversation with realtime fan-out to every connected client.
This doc describes the actual code — not the 5-phase target — so you can
navigate the repo without reverse-engineering the wiring.

---

## High level

```
                  ┌─────────────────────────────────────────┐
                  │                                         │
 User ─HTTP POST─▶│  POST /api/chat/messages                │
                  │  (ChatController)                       │
                  └───────────────┬─────────────────────────┘
                                  │ submitUserMessage()
                                  ▼
                  ┌─────────────────────────────────────────┐
                  │  OrchestratorService                    │
                  │  1. persist user message                │
                  │  2. classify intent (IntentClassifier)  │
                  │  3. create Task(status=pending)         │
                  │  4. enqueue 'orchestrator-run' job      │
                  └───────────────┬─────────────────────────┘
                                  │ enqueue()
                                  ▼
                  ┌─────────────────────────────────────────┐
                  │  QueueService                           │
                  │  • BullMQ  if REDIS_URL is set          │
                  │  • setImmediate  otherwise              │
                  └───────────────┬─────────────────────────┘
                                  │ handler(job)
                                  ▼
                  ┌─────────────────────────────────────────┐
                  │  OrchestratorService.processJob()       │
                  │  5. Task → running                      │
                  │  6. dispatch() → agent.run(ctx)         │
                  │     (lead_capture chains into Sales)    │
                  │  7. append assistant message(s)         │
                  │  8. persistLead() if structured data    │
                  │  9. Task → completed                    │
                  │  10. updateAgentStats()                 │
                  └───────────────┬─────────────────────────┘
                                  │ Repository writes + EventsGateway emits
                                  ▼
 ┌────────────────────────┐   ┌─────────────────────────────┐
 │  Repository            │   │  EventsGateway (Socket.io)  │
 │  • Supabase            │   │  rooms: conv:{id}, admin    │
 │  • Memory              │   │  emits task/message/lead/   │
 └────────────────────────┘   │         agent_stats events  │
                              └───────────────┬─────────────┘
                                              ▼
                              ┌─────────────────────────────┐
                              │  Next.js web (chat + dash)  │
                              │  subscribe:conversation / admin
                              │  REST back-fill as safety   │
                              └─────────────────────────────┘
```

No agent is ever invoked directly from HTTP. The HTTP handler returns as soon
as the Task is enqueued; every downstream state change arrives over Socket.io
(or is back-filled from REST as a safety net).

---

## Module map

```
apps/api/src/
├── chat/              HTTP surface: POST /api/chat/messages, conversations, messages
├── orchestrator/      OrchestratorService + IntentClassifier (the "brain")
├── agents/            AgentRegistry + 8 agents (Community/Lead/Sales live; rest stubbed)
├── queue/             QueueService — BullMQ or in-proc dispatcher
├── events/            EventsGateway — Socket.io fan-out
├── repository/        Thin wrapper around packages/db adapters
├── llm/               LlmService + OpenAI/Anthropic/Stub providers
├── dashboard/         GET /api/dashboard/{summary,agents,leads,tasks}
├── revenue/           Stripe checkout stub (Phase 5)
├── health/            GET /api/health — reports repo + llm backend
└── main.ts            bootstrap: helmet, CORS, global /api prefix, WS adapter

apps/web/src/
├── app/
│   ├── page.tsx         → ChatPanel (/)
│   ├── dashboard/       → DashboardClient
│   └── layout.tsx
├── components/          ChatPanel, DashboardClient
└── lib/                 api, config, use-socket

packages/
├── shared/   Domain types (Message, Task, Lead, AgentKind, Intent, WS_EVENT)
│             Zod schemas for HTTP request/response shapes
└── db/       Repository interface + SupabaseRepository + MemoryRepository
             migrations/{0001_init.sql, 0002_agent_stats_rpc.sql}
```

The only cross-package coupling is through `@nf/shared` for types/events and
`@nf/db` for the `Repository` interface. Workspace packages are compiled to
`dist/` — both apps consume compiled JS, not the TS sources, because Nest
build and Next build each load their own module resolver.

---

## Request lifecycle (happy path, lead capture)

```
POST /api/chat/messages  {message, conversationId?}
 │
 ├─ ChatController.sendMessage()
 ├─ OrchestratorService.submitUserMessage()
 │   ├─ repo.createConversation()  (if no id)
 │   ├─ repo.appendMessage(role=user)          ─── emit message:appended
 │   ├─ IntentClassifier.classify()            (LlmService: OpenAI→Anthropic→Stub)
 │   ├─ repo.createTask(status=pending)        ─── emit task:created
 │   └─ QueueService.enqueue('orchestrator-run', {taskId, conversationId, userMessageId})
 │
 │     (HTTP returns to client here — conversation + task already persisted)
 │
 ▼
QueueService handler
 │
 ├─ OrchestratorService.processJob()
 │   ├─ repo.updateTask(status=running)        ─── emit task:updated
 │   ├─ dispatch():
 │   │   ├─ LeadAgent.run(ctx)  → reply + structured data
 │   │   ├─ repo.appendMessage(role=assistant, agentKind=lead)  ─── emit message:appended
 │   │   ├─ repo.createLead(...)                                ─── emit lead:captured
 │   │   ├─ SalesAgent.run(ctx + lead)  → draft proposal reply
 │   │   ├─ repo.appendMessage(role=assistant, agentKind=sales) ─── emit message:appended
 │   │   └─ updateAgentStats('sales', ...)                      ─── emit agent:stats_updated
 │   ├─ repo.updateTask(status=completed, output, score)        ─── emit task:completed
 │   └─ updateAgentStats(task.assignedAgent, ...)               ─── emit agent:stats_updated
 │
 └─ (on throw) repo.updateTask(status=failed, error)            ─── emit task:completed
```

For `community` intents, `dispatch()` skips the lead→sales chain and returns
after the primary agent's reply.

---

## WebSocket taxonomy

All names live in [`packages/shared/src/events.ts`](../packages/shared/src/events.ts)
as the `WS_EVENT` constant object — both emitter and listener import from
there so the wire protocol cannot drift.

| Event | Payload | Rooms |
|---|---|---|
| `task:created` | `{ task: Task }` | `conv:{id}` + `admin` |
| `task:updated` | `{ taskId, status, agentKind }` | `conv:{id}` + `admin` |
| `task:completed` | `{ task: Task }` | `conv:{id}` + `admin` |
| `message:appended` | `{ message: Message }` | `conv:{id}` + `admin` |
| `lead:captured` | `{ lead: Lead }` | `conv:{id}` + `admin` |
| `agent:stats_updated` | `{ agentKind, tasksCompleted, successRate, avgScore }` | `admin` only |

Rooms:
- `conv:{id}` — one per conversation. The chat UI joins via
  `socket.emit('subscribe:conversation', id)` when it mounts or when the
  conversation id changes.
- `admin` — the dashboard joins via `socket.emit('subscribe:admin')`.
  `EventsGateway.emit()` always fans out to both the conversation room and
  `admin` via `.to('conv:{id}').to('admin').emit(…)`, so the dashboard sees
  every event. `agent:stats_updated` is the only event that skips the
  conversation room and goes straight to `admin`.

Race-safety note: the REST back-fill in [`chat-panel.tsx`](../apps/web/src/components/chat-panel.tsx)
re-fetches messages and the latest lead after each `conversationId` or
`currentTaskId` change, guarded by a `createdAt`-scoped completion check.
This defends against WS connection races where a fast in-process queue
finishes the task before the browser has finished joining the room.

---

## Adapter matrix

Three pluggable surfaces, each chosen at boot from env vars. Swap at deploy
time without touching application code.

### Repository

| Adapter | Selected when | Notes |
|---|---|---|
| `SupabaseRepository` | `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` both set | Requires migrations `0001_init.sql` + `0002_agent_stats_rpc.sql` |
| `MemoryRepository` | fallback | Per-process, data lost on restart — dev/CI only |

### LLM provider

`LlmService.complete()` tries providers in order and catches runtime errors
to fall through to the next one:

1. `OpenAIProvider` — if `OPENAI_API_KEY` is set
2. `AnthropicProvider` — if `ANTHROPIC_API_KEY` is set
3. `StubProvider` — always available

The stub returns deterministic scripted replies shape-aware to the caller
(intent classifier, lead extractor, community reply, sales draft).

### Queue

| Adapter | Selected when | Notes |
|---|---|---|
| BullMQ | `REDIS_URL` set | Phase 2 path — multiple workers, retries, persistence |
| In-process `setImmediate` | fallback | Single-process dev; no durability; no retries |

---

## Extension points (Phases 2–5)

Everything below is stubbed with clear seams so Phase 2+ is additive, not a
rewrite.

- **Phase 2 — queue/worker separation**: `QueueService` already switches on
  `REDIS_URL`. Adding a new worker = push jobs into a new queue name, register
  a handler. `OrchestratorService.dispatch` is not yet idempotent on retry —
  see `docs/tech-debt.md` A3.
- **Phase 3 — builder/QA/bugfix agents**: stubs live in `apps/api/src/agents/*`
  with the same `Agent.run(ctx)` contract. Hooking them up is (a) add an
  `Intent` to `packages/shared/src/types.ts`, (b) route it in
  `OrchestratorService.routeIntent`, (c) implement the agent.
- **Phase 4 — self-improvement**: the `agents` and `evaluations` tables in
  `0001_init.sql` already carry `version`, `prompt`, `score` columns. A
  PromptOptimizer service would read from `evaluations` and write a new
  `agents` row with an incremented version; the registry can select by
  version at dispatch time.
- **Phase 5 — revenue**: `RevenueService` currently returns a stub checkout
  URL when `STRIPE_SECRET_KEY` is missing. Real Stripe path needs
  (a) `stripe` npm dep, (b) webhook receiver, (c) a per-service pricing table.
  The controller has no auth today — guard it before Phase 5 goes live.

---

## Where to look next

- Request shapes and zod schemas: [`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts)
- Event payload types: [`packages/shared/src/events.ts`](../packages/shared/src/events.ts)
- Repository contract: [`packages/db/src/repository.ts`](../packages/db/src/repository.ts)
- SQL schema: [`packages/db/migrations/`](../packages/db/migrations/)
- Staging deploy walk-through: [`docs/deploy-staging.md`](./deploy-staging.md)
- Outstanding tech debt: [`docs/tech-debt.md`](./tech-debt.md)
