-- =============================================================================
-- NF Community AI OS — Supabase schema
-- Apply via: supabase db push  (or psql with service-role connection string)
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---- Conversations ---------------------------------------------------------
create table if not exists conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---- Messages --------------------------------------------------------------
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  agent_kind      text,
  content         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx
  on messages(conversation_id, created_at);

-- ---- Leads -----------------------------------------------------------------
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  service         text,
  budget          text,
  deadline        text,
  contact         text,
  notes           text,
  status          text not null default 'new'
                  check (status in ('new', 'qualified', 'proposal_sent', 'won', 'lost')),
  created_at      timestamptz not null default now()
);

-- ---- Tasks -----------------------------------------------------------------
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  intent          text not null,
  assigned_agent  text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'running', 'completed', 'failed')),
  input           jsonb not null default '{}'::jsonb,
  output          jsonb,
  score           numeric,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists tasks_conversation_idx on tasks(conversation_id, created_at);
create index if not exists tasks_status_idx on tasks(status);

-- ---- Agents (versioned prompt + stats) -------------------------------------
create table if not exists agents (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null,
  version            integer not null default 1,
  status             text not null default 'active'
                     check (status in ('active', 'inactive', 'deprecated')),
  system_prompt      text not null,
  tasks_completed    integer not null default 0,
  success_rate       numeric not null default 0,
  avg_score          numeric not null default 0,
  revenue_generated  numeric not null default 0,
  created_at         timestamptz not null default now(),
  unique(kind, version)
);

-- ---- Evaluations (Phase 4 self-improvement) --------------------------------
create table if not exists evaluations (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  score       numeric not null,
  reason      text,
  created_at  timestamptz not null default now()
);
