# How to Create a Week Record

Create weeks in **Supabase** (SQL editor or Table Editor), or use the Admin panel on the site.

## Supabase SQL editor

```sql
insert into weeks (week_number, season_year, start_date, end_date, is_completed)
values (1, 2026, '2026-08-28', '2026-09-02', false);

select id, week_number, season_year from weeks order by id desc limit 1;
```

Point the site at that week:

```sql
insert into settings (setting_key, setting_value)
values ('current_week_id', '3')
on conflict (setting_key)
do update set setting_value = excluded.setting_value;
```

Use the `id` you just selected as `current_week_id`.

Then add games from **Admin → Weekly Picks Games** (CFBD fetch + save).
