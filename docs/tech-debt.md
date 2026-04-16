# Technical debt register

Canonical follow-up list from the Phase 1 stabilization pass
([PR #2](https://github.com/dhayaa001/nf-community-ai-os/pull/2)). Each item
is real but was out of scope for stabilization — either it belongs to a
later phase or needs its own focused PR. Items are grouped by category and
ranked within each group.

> **Status**: nothing here is a blocker for Phase 1 running end-to-end in
> dev mode. A few items (A1, A3, A4, D5) would block a real production
> rollout; those are flagged inline.

---

## ⚠️ Top of list: budget / deadline extraction in the stub LLM

**Item A1 — called out here because it is the single most visible user-facing
bug when exercising the chat flow without real LLM keys.**

### Symptom

Send two lead-capture messages in the same conversation with different
budgets and deadlines. The "Lead captured" pill only ever shows the first
message's budget and deadline, even though other fields (`Service`,
`Contact`) update correctly. Verified in [PR #2's test run](https://github.com/dhayaa001/nf-community-ai-os/pull/2)
— see the attached recording.

### Root cause

`apps/api/src/llm/stub.provider.ts` returns the first regex hit against the
concatenated conversation history:

```ts
// stub.provider.ts — called once per LeadAgent.run()
if (system.includes('lead extractor')) {
  return JSON.stringify({
    service: extractKeyword(lastUser, [...]) ?? null,
    budget: extractMoney(lastUser),      // ← first $N or Nk match wins
    deadline: extractDeadline(lastUser), // ← first "N weeks" match wins
    contact: extractEmail(lastUser),
    notes: lastUser.slice(0, 200),
  });
}
```

`lastUser` is the latest user message, so in principle this should work.
But `LeadAgent` feeds the full conversation transcript as the prompt, and
the stub's `messages.reverse().find(role === 'user')` picks up a single
message — which one depends on how the agent formats the prompt. When the
agent concatenates history into a single user message (as it does today),
`lastUser` contains everything from turn 1 forward, and the regex matches
the *first* occurrence.

### Proposed fix

Two independent changes would close this:

1. **Stub extractor should prefer the newest keyword match**, not the
   first. Scan the string in reverse, or split on `"\n"` and scan
   latest-line-first.
2. **`LeadAgent.run()` should send only the latest user turn** (plus a
   system prompt) to the extractor, not the full transcript. The structured
   output is meant to reflect the intent of the current message.

Estimated effort: 1–2 hours including a regression test in `packages/db`
or as a new `apps/api/test/` suite.

### Why it wasn't fixed in stabilization

The stabilization pass was explicitly "cleanup, no behavior changes". This
is a behavior change in a code path (stub LLM) that only runs in dev/CI. A
real OpenAI or Anthropic call side-steps the bug because the real model
returns structured JSON scoped to the newest turn. Fixing the stub is
orthogonal to the stabilization diff.

### Workaround

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in dev. The stub path is only
for zero-credential boots and demos.

---

## A. Correctness / safety

1. ~~Stub lead extractor regresses on 2nd turn~~ — **see section above**.
2. **`SupabaseRepository.appendMessage` is two non-transactional writes.**
   Inserting the message and bumping `conversations.updated_at` are
   separate calls. If the second fails, the message is saved but the
   conversation stamp is stale. Fix with a Postgres function like the
   `increment_agent_stats` RPC in migration `0002_agent_stats_rpc.sql`.
3. **`OrchestratorService.dispatch()` is not idempotent.** When Phase 2
   lands real Redis, BullMQ will retry failed jobs and the orchestrator
   will run the agent twice, double-appending messages and double-counting
   stats. Fix by keying the early-exit on `taskId` and persisting a
   `dispatched_at` timestamp on the task row — abort if already set.
   🔴 Blocker for Phase 2 production.
4. **`QueueService` in-memory mode silently runs in production.** If
   `REDIS_URL` is unset and `NODE_ENV=production`, the API boots with the
   `setImmediate` dispatcher and loses every in-flight task on SIGTERM.
   Add a boot-time refusal: if `NODE_ENV=production` and `REDIS_URL` is
   missing, log a fatal error and `process.exit(1)`.
   🔴 Blocker for first production deploy.
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

10. **Zero unit tests.** Phase 1 was explicitly UI + smoke tested. A
    `LeadAgent.safeParse` / `IntentClassifier.heuristic` /
    `MemoryRepository` suite would be ~30 minutes and pays back every
    subsequent PR.
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
15. **No graceful shutdown hook on the API** beyond
    `QueueService.onModuleDestroy`. Add `app.enableShutdownHooks()` to
    `main.ts` before Phase 2's workers land — otherwise in-flight jobs
    won't drain on SIGTERM.
    🔴 Blocker for Phase 2 production.
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

Last updated: 2026-04-16 (Phase 2 kick-off). Item numbers are stable —
don't renumber when items close, strike them through instead.
