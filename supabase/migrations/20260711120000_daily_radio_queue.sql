-- Daily radio job queue (pgmq) + job run state table

create extension if not exists pgmq cascade;

do $$
begin
  perform pgmq.create('daily_radio_jobs');
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- news_daily_radio_job_runs
-- ---------------------------------------------------------------------------
create table if not exists public.news_daily_radio_job_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  script_date date not null,
  radio_slot text not null check (radio_slot in ('morning', 'evening')),
  duration_minutes integer not null default 3 check (duration_minutes in (3, 5, 10)),
  generation_source text not null default 'server' check (generation_source = 'server'),
  job_type text not null default 'full'
    check (job_type in ('full', 'generate_script', 'generate_audio', 'send_push')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'retry_wait', 'failed', 'skipped')),
  priority integer not null default 50,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  current_stage text,
  next_retry_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  pgmq_msg_id bigint,
  trigger_source text not null default 'cron',
  force_regenerate boolean not null default false,
  last_error text,
  error_stage text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint news_daily_radio_job_runs_unique_slot
    unique (user_id, script_date, radio_slot, generation_source, job_type)
);

create index if not exists idx_news_daily_radio_job_runs_status
  on public.news_daily_radio_job_runs (status, priority, queued_at);

create index if not exists idx_news_daily_radio_job_runs_script_date
  on public.news_daily_radio_job_runs (script_date, radio_slot, status);

drop trigger if exists news_daily_radio_job_runs_set_updated_at on public.news_daily_radio_job_runs;
create trigger news_daily_radio_job_runs_set_updated_at
  before update on public.news_daily_radio_job_runs
  for each row execute function public.set_updated_at();

comment on table public.news_daily_radio_job_runs is 'Daily radio queue job state; pairs with pgmq daily_radio_jobs';

-- ---------------------------------------------------------------------------
-- pgmq wrappers for Edge Functions (service_role only)
-- ---------------------------------------------------------------------------
create or replace function public.daily_radio_queue_send(
  payload jsonb,
  delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  mid bigint;
begin
  mid := pgmq.send('daily_radio_jobs', payload, delay_seconds);
  return mid;
end;
$$;

create or replace function public.daily_radio_queue_read(
  batch_size integer default 3,
  visibility_timeout_seconds integer default 600
)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language sql
security definer
set search_path = public, pgmq
as $$
  select r.msg_id, r.read_ct, r.enqueued_at, r.vt, r.message
  from pgmq.read('daily_radio_jobs', visibility_timeout_seconds, batch_size) r;
$$;

create or replace function public.daily_radio_queue_archive(msg_id bigint)
returns void
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.archive('daily_radio_jobs', msg_id);
$$;

create or replace function public.daily_radio_queue_delete(msg_id bigint)
returns void
language sql
security definer
set search_path = public, pgmq
as $$
  select pgmq.delete('daily_radio_jobs', msg_id);
$$;

create or replace function public.daily_radio_queue_metrics()
returns jsonb
language sql
security definer
set search_path = public, pgmq
as $$
  select jsonb_build_object(
    'queue_name', 'daily_radio_jobs',
    'pending_job_runs',
      (select count(*)::int from public.news_daily_radio_job_runs
       where status in ('pending', 'processing', 'retry_wait')),
    'oldest_pending_seconds',
      coalesce((select extract(epoch from (now() - min(queued_at)))::int
       from public.news_daily_radio_job_runs
       where status in ('pending', 'retry_wait')), 0),
    'failed_today',
      (select count(*)::int from public.news_daily_radio_job_runs
       where status = 'failed'
         and script_date = (now() at time zone 'Asia/Taipei')::date)
  );
$$;

revoke all on function public.daily_radio_queue_send(jsonb, integer) from public;
revoke all on function public.daily_radio_queue_read(integer, integer) from public;
revoke all on function public.daily_radio_queue_archive(bigint) from public;
revoke all on function public.daily_radio_queue_delete(bigint) from public;
revoke all on function public.daily_radio_queue_metrics() from public;

grant execute on function public.daily_radio_queue_send(jsonb, integer) to service_role;
grant execute on function public.daily_radio_queue_read(integer, integer) to service_role;
grant execute on function public.daily_radio_queue_archive(bigint) to service_role;
grant execute on function public.daily_radio_queue_delete(bigint) to service_role;
grant execute on function public.daily_radio_queue_metrics() to service_role;

alter table public.news_daily_radio_job_runs enable row level security;
