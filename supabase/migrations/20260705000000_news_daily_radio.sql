-- AI 個人新聞台（共用 PetCare Supabase 專案）
-- 資料表使用 news_ 前綴，避免與 PetCare 表混淆

-- ---------------------------------------------------------------------------
-- news_user_preferences
-- ---------------------------------------------------------------------------
create table if not exists public.news_user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  topics text[] not null default '{}',
  custom_keywords text[] not null default '{}',
  daily_radio_enabled boolean not null default true,
  daily_radio_time text not null default '07:00',
  timezone text not null default 'Asia/Taipei',
  push_token text,
  push_platform text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint news_user_preferences_time_format check (
    daily_radio_time ~ '^\d{1,2}:\d{2}$'
  )
);

comment on table public.news_user_preferences is 'AI 個人新聞台：使用者追蹤主題與每日電台排程';

create index if not exists idx_news_user_preferences_daily_enabled
  on public.news_user_preferences (daily_radio_enabled)
  where daily_radio_enabled = true;

-- ---------------------------------------------------------------------------
-- news_daily_radio_scripts
-- ---------------------------------------------------------------------------
create table if not exists public.news_daily_radio_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  script_date date not null,
  duration_minutes integer not null default 3,
  title text,
  script_text text not null default '',
  source_news jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'generating', 'completed', 'failed')),
  error_message text,
  is_daily_auto boolean not null default true,
  generation_source text not null default 'server'
    check (generation_source in ('server', 'app')),
  push_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint news_daily_radio_scripts_unique_per_source
    unique (user_id, script_date, duration_minutes, generation_source)
);

comment on table public.news_daily_radio_scripts is 'AI 個人新聞台：每日 AI 早報稿件';

create index if not exists idx_news_daily_radio_scripts_user_date
  on public.news_daily_radio_scripts (user_id, script_date desc);

create index if not exists idx_news_daily_radio_scripts_status_date
  on public.news_daily_radio_scripts (status, script_date);

-- updated_at trigger helper（若 PetCare 尚未有此 function 則建立）
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists news_user_preferences_set_updated_at on public.news_user_preferences;
create trigger news_user_preferences_set_updated_at
  before update on public.news_user_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists news_daily_radio_scripts_set_updated_at on public.news_daily_radio_scripts;
create trigger news_daily_radio_scripts_set_updated_at
  before update on public.news_daily_radio_scripts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.news_user_preferences enable row level security;
alter table public.news_daily_radio_scripts enable row level security;

drop policy if exists "news_users_read_own_preferences" on public.news_user_preferences;
create policy "news_users_read_own_preferences"
  on public.news_user_preferences for select
  using (auth.uid() = user_id);

drop policy if exists "news_users_insert_own_preferences" on public.news_user_preferences;
create policy "news_users_insert_own_preferences"
  on public.news_user_preferences for insert
  with check (auth.uid() = user_id);

drop policy if exists "news_users_update_own_preferences" on public.news_user_preferences;
create policy "news_users_update_own_preferences"
  on public.news_user_preferences for update
  using (auth.uid() = user_id);

drop policy if exists "news_users_read_own_scripts" on public.news_daily_radio_scripts;
create policy "news_users_read_own_scripts"
  on public.news_daily_radio_scripts for select
  using (auth.uid() = user_id);

drop policy if exists "news_users_insert_own_app_scripts" on public.news_daily_radio_scripts;
create policy "news_users_insert_own_app_scripts"
  on public.news_daily_radio_scripts for insert
  with check (
    auth.uid() = user_id
    and generation_source = 'app'
  );

drop policy if exists "news_users_update_own_app_scripts" on public.news_daily_radio_scripts;
create policy "news_users_update_own_app_scripts"
  on public.news_daily_radio_scripts for update
  using (
    auth.uid() = user_id
    and generation_source = 'app'
  );

-- Edge Function（service role）繞過 RLS。
