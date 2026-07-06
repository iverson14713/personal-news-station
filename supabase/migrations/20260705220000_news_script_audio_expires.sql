-- 語音 MP3 快取到期時間

alter table public.news_daily_radio_scripts
  add column if not exists audio_expires_at timestamptz;

comment on column public.news_daily_radio_scripts.audio_expires_at is
  'MP3 快取到期時間；過期後由 cleanup job 刪除 Storage 並清空 audio_* 欄位';

create index if not exists idx_news_daily_radio_scripts_audio_expires
  on public.news_daily_radio_scripts (audio_expires_at)
  where audio_url is not null;
