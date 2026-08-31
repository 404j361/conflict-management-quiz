drop function if exists public.join_rush_game(text, text);

create or replace function public.join_rush_game(student_id_input text, password_input text)
returns table (
  id uuid,
  student_id_mask text,
  display_name text,
  role text,
  score int,
  correct_count int,
  total_answered int,
  total_response_ms int,
  favorite_style text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  student_record public.rush_students%rowtype;
  joined_player public.rush_players%rowtype;
  normalized_id text := trim(student_id_input);
  current_month text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  select * into student_record
  from public.rush_students
  where student_id = normalized_id;

  if not found then
    raise exception 'Student ID is not registered yet.';
  end if;

  if student_record.password_hash is null
    or student_record.password_hash <> md5(normalized_id || ':' || password_input) then
    raise exception 'Student ID or password is incorrect.';
  end if;

  insert into public.rush_players (
    student_id_hash,
    student_id_mask,
    display_name,
    role
  )
  values (
    md5(normalized_id),
    public.mask_student_id(normalized_id),
    student_record.display_name,
    student_record.role
  )
  on conflict (student_id_hash) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        joined_at = now()
  returning * into joined_player;

  if joined_player.role = 'admin' then
    return query
    select
      joined_player.id,
      joined_player.student_id_mask,
      joined_player.display_name,
      joined_player.role,
      joined_player.score,
      joined_player.correct_count,
      joined_player.total_answered,
      joined_player.total_response_ms,
      joined_player.favorite_style,
      joined_player.joined_at;
  else
    return query
    select *
    from public.get_monthly_rush_leaderboard(current_month)
    where get_monthly_rush_leaderboard.id = joined_player.id;
  end if;
end;
$$;

grant execute on function public.join_rush_game(text, text) to anon;

notify pgrst, 'reload schema';
