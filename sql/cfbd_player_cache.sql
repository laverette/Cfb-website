-- Cached CFBD player profiles (season + career payloads)
-- Run in Supabase SQL editor before relying on /api/player cache hits.

create table if not exists public.cfbd_player_cache (
  player_id text not null,
  season_year integer not null,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, season_year)
);

create index if not exists idx_cfbd_player_cache_expires
  on public.cfbd_player_cache (expires_at);

alter table public.cfbd_player_cache enable row level security;
