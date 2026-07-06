-- AI 主播播報風格（用於語音快取比對）

alter table public.news_daily_radio_scripts
  add column if not exists audio_style text;

comment on column public.news_daily_radio_scripts.audio_style is
  '播報風格 id，例如 news、morning、podcast';
