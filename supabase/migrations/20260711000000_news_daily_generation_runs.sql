-- 每日 Cron / Edge Function 執行紀錄（可追蹤各階段與推播結果）

create table if not exists public.news_daily_generation_runs (
  id uuid primary key default gen_random_uuid(),
  execution_id text not null unique,
  run_date date not null,
  trigger_source text not null,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial_success', 'failed')),
  current_stage text,
  news_count integer,
  script_generated boolean not null default false,
  audio_generated boolean not null default false,
  audio_url text,
  notification_success_count integer not null default 0,
  notification_failure_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists news_daily_generation_runs_run_date_idx
  on public.news_daily_generation_runs (run_date desc);

create index if not exists news_daily_generation_runs_status_idx
  on public.news_daily_generation_runs (status, started_at desc);

comment on table public.news_daily_generation_runs is
  'generate-daily-radio 每次執行紀錄；run_date 以 Asia/Taipei 日期為準';

alter table public.news_daily_generation_runs enable row level security;

-- 僅 service role 可讀寫（Edge Function 使用 service role）
create policy "service role full access on news_daily_generation_runs"
  on public.news_daily_generation_runs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
