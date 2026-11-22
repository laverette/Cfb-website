-- Site ambient audio preference (default OFF). Run in Supabase SQL editor if needed.
alter table public.user_settings
  add column if not exists ambient_audio_enabled boolean not null default false;

-- Existing installs may still have default true — force quiet for everyone.
alter table public.user_settings
  alter column ambient_audio_enabled set default false;

update public.user_settings
set ambient_audio_enabled = false
where ambient_audio_enabled is distinct from false;

comment on column public.user_settings.ambient_audio_enabled is
  'When true, site music plays with no on-screen player. Default false (opt-in via profile).';
