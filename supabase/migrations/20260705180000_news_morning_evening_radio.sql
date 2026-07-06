-- 早報 / 晚報雙時段排程

alter table public.news_user_preferences
  add column if not exists morning_radio_enabled boolean not null default true,
  add column if not exists evening_radio_enabled boolean not null default false,
  add column if not exists morning_radio_time text not null default '07:00',
  add column if not exists evening_radio_time text not null default '17:00',
  add column if not exists morning_duration_minutes integer not null default 3,
  add column if not exists evening_duration_minutes integer not null default 3;

update public.news_user_preferences
set morning_radio_time = daily_radio_time
where daily_radio_time is not null
  and daily_radio_time <> morning_radio_time;

alter table public.news_user_preferences
  drop constraint if exists news_user_preferences_morning_time_format;

alter table public.news_user_preferences
  add constraint news_user_preferences_morning_time_format check (
    morning_radio_time ~ '^\d{1,2}:\d{2}$'
  );

alter table public.news_user_preferences
  drop constraint if exists news_user_preferences_evening_time_format;

alter table public.news_user_preferences
  add constraint news_user_preferences_evening_time_format check (
    evening_radio_time ~ '^\d{1,2}:\d{2}$'
  );

alter table public.news_daily_radio_scripts
  add column if not exists radio_slot text not null default 'morning';

update public.news_daily_radio_scripts
set radio_slot = 'morning'
where radio_slot is null or radio_slot = '';

alter table public.news_daily_radio_scripts
  drop constraint if exists news_daily_radio_scripts_radio_slot_check;

alter table public.news_daily_radio_scripts
  add constraint news_daily_radio_scripts_radio_slot_check
  check (radio_slot in ('morning', 'evening'));

alter table public.news_daily_radio_scripts
  drop constraint if exists news_daily_radio_scripts_unique_per_source;

alter table public.news_daily_radio_scripts
  add constraint news_daily_radio_scripts_unique_per_source
  unique (user_id, script_date, duration_minutes, generation_source, radio_slot);

comment on column public.news_user_preferences.morning_radio_enabled is '早報自動生成';
comment on column public.news_user_preferences.evening_radio_enabled is '晚報自動生成（Pro）';
comment on column public.news_daily_radio_scripts.radio_slot is 'morning | evening';
