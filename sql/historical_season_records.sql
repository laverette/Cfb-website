-- Aggregate prior-season W-L when individual picks are unavailable.
-- Merged into All Time / Yearly leaderboards and public profiles (not week boards).

create table if not exists historical_season_records (
  id bigint generated always as identity primary key,
  user_id bigint not null references users (id) on delete cascade,
  season_year integer not null,
  correct_picks integer not null default 0 check (correct_picks >= 0),
  incorrect_picks integer not null default 0 check (incorrect_picks >= 0),
  tied_picks integer not null default 0 check (tied_picks >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, season_year)
);

create index if not exists historical_season_records_year_idx
  on historical_season_records (season_year);

-- 2025 season totals (no game-level picks retained)
insert into historical_season_records (
  user_id,
  season_year,
  correct_picks,
  incorrect_picks,
  tied_picks,
  notes
)
select
  u.id,
  2025,
  v.wins,
  v.losses,
  0,
  'Imported aggregate W-L for 2025 (individual picks unavailable)'
from (
  values
    ('thechampion', 111, 41),
    ('laverette', 118, 46),
    ('Gracie', 106, 46),
    ('Allie', 22, 14),
    ('blake', 120, 44),
    ('Kate', 104, 48)
) as v (username, wins, losses)
join users u on u.username = v.username
on conflict (user_id, season_year) do update
set
  correct_picks = excluded.correct_picks,
  incorrect_picks = excluded.incorrect_picks,
  tied_picks = excluded.tied_picks,
  notes = excluded.notes,
  updated_at = now();
