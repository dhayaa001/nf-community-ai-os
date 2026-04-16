-- =============================================================================
-- NF Community AI OS — atomic agent-stats increment
--
-- `incrementAgentStats` previously read then wrote, allowing two concurrent
-- callers (e.g. the lead + sales chain) to clobber each other's updates.
-- This function performs the read-modify-write inside a single SQL statement
-- so it's atomic under Postgres MVCC.
-- =============================================================================

create or replace function increment_agent_stats(
  p_kind text,
  p_success boolean,
  p_score numeric,
  p_revenue numeric default 0
)
returns agents
language sql
as $$
  update agents
  set
    tasks_completed = tasks_completed + 1,
    success_rate = round(
      (success_rate * tasks_completed + case when p_success then 1 else 0 end)::numeric
        / (tasks_completed + 1),
      4
    ),
    avg_score = round(
      (avg_score * tasks_completed + p_score)::numeric / (tasks_completed + 1),
      4
    ),
    revenue_generated = revenue_generated + coalesce(p_revenue, 0)
  where id = (
    select id from agents
    where kind = p_kind
    order by version desc
    limit 1
  )
  returning *;
$$;
