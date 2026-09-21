-- Track CFBD / Odds API calls by product feature for the admin usage chart.
create table if not exists public.api_usage_daily (
  day date not null,
  feature text not null,
  source text not null default 'cfbd',
  calls integer not null default 0,
  cache_hits integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, feature, source),
  constraint api_usage_daily_feature_len check (char_length(feature) between 1 and 48),
  constraint api_usage_daily_source_len check (char_length(source) between 1 and 24),
  constraint api_usage_daily_nonneg check (calls >= 0 and cache_hits >= 0)
);

create index if not exists api_usage_daily_day_idx
  on public.api_usage_daily (day desc);

alter table public.api_usage_daily enable row level security;

create or replace function public.bump_api_usage(
  p_feature text,
  p_source text default 'cfbd',
  p_calls integer default 0,
  p_cache_hits integer default 0,
  p_day date default (timezone('utc', now()))::date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_feature is null or length(trim(p_feature)) = 0 then
    return;
  end if;
  insert into public.api_usage_daily as u (day, feature, source, calls, cache_hits, updated_at)
  values (
    coalesce(p_day, (timezone('utc', now()))::date),
    lower(trim(p_feature)),
    lower(trim(coalesce(nullif(p_source, ''), 'cfbd'))),
    greatest(coalesce(p_calls, 0), 0),
    greatest(coalesce(p_cache_hits, 0), 0),
    now()
  )
  on conflict (day, feature, source) do update
  set
    calls = u.calls + excluded.calls,
    cache_hits = u.cache_hits + excluded.cache_hits,
    updated_at = now();
end;
$$;

revoke all on function public.bump_api_usage(text, text, integer, integer, date) from public;
grant execute on function public.bump_api_usage(text, text, integer, integer, date) to service_role;
