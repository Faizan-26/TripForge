-- Align persisted statuses with the FastAPI domain model.
-- Run this in the Supabase SQL Editor for databases created by the initial migration.

begin;

alter table public.agent_runs
  drop constraint if exists agent_runs_status_check;

alter table public.agent_runs
  add constraint agent_runs_status_check check (
    status in (
      'queued',
      'running',
      'needs_clarification',
      'completed',
      'failed',
      'cancelled'
    )
  );

commit;
