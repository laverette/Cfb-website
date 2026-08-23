-- Run after importing existing MySQL ids so new inserts do not collide.
select setval(pg_get_serial_sequence('users','id'), coalesce((select max(id) from users), 1));
select setval(pg_get_serial_sequence('user_profiles','id'), coalesce((select max(id) from user_profiles), 1));
select setval(pg_get_serial_sequence('user_settings','id'), coalesce((select max(id) from user_settings), 1));
select setval(pg_get_serial_sequence('user_activity','id'), coalesce((select max(id) from user_activity), 1));
select setval(pg_get_serial_sequence('weeks','id'), coalesce((select max(id) from weeks), 1));
select setval(pg_get_serial_sequence('games','id'), coalesce((select max(id) from games), 1));
select setval(pg_get_serial_sequence('game_results','id'), coalesce((select max(id) from game_results), 1));
select setval(pg_get_serial_sequence('user_picks','id'), coalesce((select max(id) from user_picks), 1));
select setval(pg_get_serial_sequence('weekly_user_stats','id'), coalesce((select max(id) from weekly_user_stats), 1));
select setval(pg_get_serial_sequence('player_hometowns','id'), coalesce((select max(id) from player_hometowns), 1));
select setval(pg_get_serial_sequence('settings','id'), coalesce((select max(id) from settings), 1));
