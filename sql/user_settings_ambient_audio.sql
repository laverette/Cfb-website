-- Site ambient audio preference (default ON). Run in Supabase SQL editor if needed.
alter table public.user_settings
  add column if not exists ambient_audio_enabled boolean not null default true;

comment on column public.user_settings.ambient_audio_enabled is
  'When true (default), site ambient audio autoplays; users can opt out on their profile.';
