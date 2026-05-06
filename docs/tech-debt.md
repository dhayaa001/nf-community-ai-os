# Technical debt register

Canonical follow-up list from the Phase 1 stabilization pass
([PR #2](https://github.com/dhayaa001/nf-community-ai-os/pull/2)). Each item
is real but was out of scope for stabilization — either it belongs to a
later phase or needs its own focused PR. Items are grouped by category and
ranked within each group.

> **Status**: nothing here is a blocker for Phase 1 running end-to-end in
> dev mode. A few items (A3, A4, D15) would block a real production
> rollout; those are flagged inline with 🔴. **Update 2026-04-21**: A1
> (stub lead extractor) and the three Phase 2 production blockers (A3,
> A4, D15) are now closed — see strike-throughs below.

---

## ~~⚠️ Top of list: budget / deadline extraction in the stub LLM~~ — CLOSED

**Item A1 — closed 2026-04-21.** Both proposed fixes shipped:

1. `apps/api/src/llm/stub.provider.ts` — `extractMoney`, `extractDeadline`,
   and `extractKeyword` now return the *last* match in the haystack via a
   shared `lastMatch(str, regex)` helper. Money regex was also tightened
   so a trailing list comma (`"$10,000, deadline..."`) no longer gets
   eaten.
2. `apps/api/src/agents/lead.agent.ts` — `run()` now sends **only the
   latest user turn** to the extractor; the previous full-transcript
   prompt is gone.

Covered by `apps/api/src/llm/stub.provider.spec.ts` (11 cases, first
unit-test suite in the repo — partial progress on item C10). Verified
scenario: user says "$5,000 in 6 weeks" on turn 1, "budget is now
$10,000, deadline in 3 weeks" on turn 2 → extracted lead reflects the
newest values.

### What's next here

With a real OpenAI / Anthropic key wired in, `LeadAgent` uses the real
LLM path and the stub is bypassed entirely. The fixes above keep the
stub honest for zero-credential demos and CI.

### Original report (kept for history)

Send two lead-capture messages in the same conversation with different
budgets and deadlines — the "Lead captured" pill only ever showed the
first message's values. Root cause: the stub returned the *first* regex
hit, and `LeadAgent` passed the full transcript as one user message, so
`lastUser` contained every budget ever mentioned and the first-match
regex locked onto turn 1.

---

## A. Correctness / safety

1. ~~**Stub lead extractor regresses on 2nd turn.**~~ Closed 2026-04-21.
   See section above for the shipped fix. Covered by
   `apps/api/src/llm/stub.provider.spec.ts`.
2. **`SupabaseRepository.appendMessage` is two non-transactional writes.**
   Inserting the message and bumping `conversations.updated_at` are
   separate calls. If the second fails, the message is saved but the
   conversation stamp is stale. Fix with a Postgres function like the
   `increment_agent_stats` RPC in migration `0002_agent_stats_rpc.sql`.
3. ~~**`OrchestratorService.dispatch()` is not idempotent.**~~ Closed
   2026-04-21 in [PR #7](https://github.com/dhayaa001/nf-community-ai-os/pull/7).
   `OrchestratorService.processJob` now guards on a per-process
   `Set<taskId>` of in-flight dispatches (added synchronously before any
   `await` to avoid TOCTOU) and short-circuits when the task row is
   already `completed` / `failed`. Full `dispatched_at` column deferred
   until multi-replica scaling.
   🟢 Was blocker for Phase 2 production.
4. ~~**`QueueService` in-memory mode silently runs in production.**~~
   Closed 2026-04-21 in [PR #7](https://github.com/dhayaa001/nf-community-ai-os/pull/7).
   `QueueService.registerHandler` throws at boot when `NODE_ENV=production`
   and `REDIS_URL` is unset; the bootstrap catch in `main.ts` turns the
   throw into `process.exit(1)` with an operator-facing message.
   🟢 Was blocker for first production deploy.
5. **No retry/backoff in `LlmService.complete()`.** OpenAI 5xx or
   rate-limit errors fall straight through to the fallback provider and
   then to the caller. Add bounded retry with jitter (3 attempts, 250ms
   base, full jitter) before falling back.

## B. Type tightness / boundaries

6. **`SupabaseRepository` row mappers use repeated `as string` / `as AgentKind`
   casts.** This is unavoidable at the Supabase client boundary until we
   generate types with `supabase gen types typescript`. Track as Phase 2
   polish.
7. **`AgentResult.data` is `Record<string, unknown>`.** Every agent
   hand-writes downstream casts. Could be tightened to a discriminated
   union `LeadAgentResult | SalesAgentResult | BuilderAgentResult | …` but
   that's a meaningful refactor and touches every agent file.
8. **No zod schema for `Task.input` / `Task.output`.** Orchestrator writes
   `{ message, reasoning }` on input and an agent-specific bag on output,
   then reads via `(task.input as { message?: string }).message`. Fine
   today, brittle once more call sites land.
9. **WS payloads are typed at the emitter but the listener casts**
   `payload as { message: Message }`. A `onTypedWsEvent<T>(WS_EVENT.X,
   handler)` helper parameterized on `WS_EVENT` keys would remove those
   casts on the web side.

## C. Testing / tooling

10. **Zero unit tests** — *partial progress 2026-04-21*. `apps/api` now
    uses vitest; `stub.provider.spec.ts` covers the extractor helpers
    and the lead-extractor JSON path. Next candidates:
    `LeadAgent.safeParse`, `IntentClassifier.heuristic`,
    `MemoryRepository`, and the `OrchestratorService` idempotency guard
    from A3.
11. **No CI workflow.** Repo has no `.github/workflows/` so `git_pr_checks`
    has nothing to wait on. Add one that runs `pnpm -r build`, `pnpm lint`,
    `pnpm typecheck`.
12. **`packages/shared` and `packages/db` emit no lint output** —
    intentional since they have no bespoke rules, but a root ESLint config
    inherited by all workspaces would remove the `echo 'no lint'`
    placeholders.
13. **Prettier is installed but no `prettier --check` script.** Either
    wire it into `pnpm lint` or drop the dep.

## D. Runtime / ops

14. **`OrchestratorService` logs intent classification at `debug` level.**
    Nest's default is `log`, so these never appear in production without
    `LOG_LEVEL=debug`. Intentional for now; document the env var in the
    deploy guide (done in `docs/deploy-staging.md`).
15. ~~**No graceful shutdown hook on the API.**~~ Closed 2026-04-21 in
    [PR #7](https://github.com/dhayaa001/nf-community-ai-os/pull/7).
    `main.ts` now calls `app.enableShutdownHooks()` before `app.listen`,
    so SIGTERM / SIGINT fire Nest's `OnModuleDestroy` chain — including
    `QueueService.onModuleDestroy` which closes the BullMQ worker,
    queue, and ioredis connection in order.
    🟢 Was blocker for Phase 2 production.
16. **CORS origin is read from `process.env.API_CORS_ORIGIN` inside the
    gateway decorator**, which evaluates at import time. If the env is
    injected later (e.g. via a runtime secret loader) the gateway will
    have already bound `*`. Not a problem today; worth a note if we move
    to lazy secret loading.
17. **Revenue module is a Phase 5 stub** that returns a fake checkout URL.
    The controller has no auth. Gate behind `stripeSecret` present OR
    require an auth header before Phase 5 goes live.
    🔴 Blocker for Phase 5.

## E. Docs / DX

18. **README didn't mention the `0002_agent_stats_rpc.sql` migration**
    originally — now fixed in `docs/deploy-staging.md`. Still worth adding
    to a CONTRIBUTING page when that lands.
19. **No `CONTRIBUTING.md`** with the build/typecheck/lint one-liners.
    They live only in the env config snippets in README.
20. **`apps/api/.env.example` is missing.** Every `process.env.*` the API
    reads is documented in `docs/deploy-staging.md` §0 but not mirrored
    as a committed `.env.example`. Add it when doing the next docs pass.

---

## How to work off this list

- Pick one item, open a focused PR.
- Don't bundle — the diffs here cross concerns (queue durability,
  Supabase transactions, agent typing) and batching will dilute review.
- For anything marked 🔴, gate merge on having a staging reproduction
  that shows the current behavior failing and the fix passing.

Last updated: 2026-04-21 (A1 closed; Phase 2 blockers A3/A4/D15 closed
in [PR #7](https://github.com/dhayaa001/nf-community-ai-os/pull/7);
C10 partial progress via first vitest suite). Item numbers are stable —
don't renumber when items close, strike them through instead.
