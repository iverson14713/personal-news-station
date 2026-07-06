-- AI 主播稿真人語音（OpenAI TTS → Supabase Storage）

alter table public.news_daily_radio_scripts
  add column if not exists audio_url text,
  add column if not exists audio_voice text,
  add column if not exists audio_generated_at timestamptz,
  add column if not exists audio_duration_seconds integer;

comment on column public.news_daily_radio_scripts.audio_url is 'Supabase Storage 公開 MP3 URL';
comment on column public.news_daily_radio_scripts.audio_voice is 'OpenAI TTS voice id，例如 coral';
comment on column public.news_daily_radio_scripts.audio_generated_at is '語音生成完成時間';
comment on column public.news_daily_radio_scripts.audio_duration_seconds is '音檔長度（秒），可後補';

-- Storage bucket（公開讀取，僅 server 上傳）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'news-audio',
  'news-audio',
  true,
  52428800,
  array['audio/mpeg', 'audio/mp3']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "news_audio_public_read" on storage.objects;
create policy "news_audio_public_read"
  on storage.objects for select
  using (bucket_id = 'news-audio');
