alter table public.rush_answers
add column if not exists month_key text not null default to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');

alter table public.rush_answers
drop constraint if exists rush_answers_player_id_question_id_key;

create unique index if not exists rush_answers_player_month_question_key
on public.rush_answers (player_id, month_key, question_id);

drop function if exists public.get_monthly_rush_leaderboard(text);

create or replace function public.get_monthly_rush_leaderboard(month_key_input text)
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
language sql
security definer
set search_path = public
as $$
  select
    players.id,
    players.student_id_mask,
    players.display_name,
    players.role,
    coalesce(sum(answers.points), 0)::int as score,
    count(*) filter (where answers.is_correct)::int as correct_count,
    count(answers.id)::int as total_answered,
    coalesce(sum(answers.response_ms), 0)::int as total_response_ms,
    (
      array_agg(answers.selected_style order by answers.answered_at desc)
      filter (where answers.selected_style is not null)
    )[1] as favorite_style,
    players.joined_at
  from public.rush_players players
  left join public.rush_answers answers
    on answers.player_id = players.id
   and answers.month_key = month_key_input
  where players.role = 'student'
  group by players.id
  order by score desc, correct_count desc, total_response_ms asc, players.joined_at asc;
$$;

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

  return query
  select *
  from public.get_monthly_rush_leaderboard(current_month)
  where get_monthly_rush_leaderboard.id = joined_player.id;
end;
$$;

drop function if exists public.register_rush_student(text, text, text);

create or replace function public.register_rush_student(
  student_id_input text,
  display_name_input text,
  password_input text
)
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
  joined_player public.rush_players%rowtype;
  normalized_id text := trim(student_id_input);
  normalized_name text := trim(display_name_input);
begin
  if normalized_id = '' then
    raise exception 'Student ID is required.';
  end if;

  if normalized_name = '' then
    raise exception 'Name is required.';
  end if;

  if length(password_input) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  insert into public.rush_students (
    student_id,
    display_name,
    password_hash,
    role
  )
  values (
    normalized_id,
    normalized_name,
    md5(normalized_id || ':' || password_input),
    'student'
  );

  insert into public.rush_players (
    student_id_hash,
    student_id_mask,
    display_name,
    role
  )
  values (
    md5(normalized_id),
    public.mask_student_id(normalized_id),
    normalized_name,
    'student'
  )
  on conflict (student_id_hash) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        joined_at = now()
  returning * into joined_player;

  return query
  select *
  from public.get_monthly_rush_leaderboard(to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM'))
  where get_monthly_rush_leaderboard.id = joined_player.id;
exception
  when unique_violation then
    raise exception 'This student ID is already registered. Please log in.';
end;
$$;

drop function if exists public.submit_rush_answer(uuid, int, text);
drop function if exists public.submit_rush_answer(uuid, int, text, int);
drop function if exists public.submit_rush_answer(uuid, text, int, text, int);

create or replace function public.submit_rush_answer(
  player_id_input uuid,
  month_key_input text,
  question_id_input int,
  selected_style_input text,
  response_ms_input int
)
returns public.rush_answers
language plpgsql
security definer
set search_path = public
as $$
declare
  answer_record public.rush_answers%rowtype;
  correct_style text;
  response_ms_value int;
  remaining_seconds numeric;
  points_value int;
  is_correct_value boolean;
begin
  correct_style := public.correct_style_for_question(question_id_input);
  is_correct_value := selected_style_input = correct_style;
  response_ms_value := least(50000, greatest(0, response_ms_input));
  remaining_seconds := greatest(0, 50 - (response_ms_value / 1000.0));
  points_value := case
    when is_correct_value then round(100 + (remaining_seconds / 50.0) * 50)::int
    else 0
  end;

  insert into public.rush_answers (
    player_id,
    month_key,
    question_id,
    selected_style,
    is_correct,
    points,
    response_ms
  )
  values (
    player_id_input,
    month_key_input,
    question_id_input,
    selected_style_input,
    is_correct_value,
    points_value,
    response_ms_value
  )
  on conflict (player_id, month_key, question_id) do update
    set selected_style = public.rush_answers.selected_style
  returning * into answer_record;

  update public.rush_players
  set
    score = monthly.score,
    correct_count = monthly.correct_count,
    total_answered = monthly.total_answered,
    total_response_ms = monthly.total_response_ms,
    favorite_style = monthly.favorite_style
  from (
    select *
    from public.get_monthly_rush_leaderboard(month_key_input)
    where get_monthly_rush_leaderboard.id = player_id_input
  ) monthly
  where public.rush_players.id = player_id_input;

  return answer_record;
end;
$$;

grant execute on function public.get_monthly_rush_leaderboard(text) to anon;
grant execute on function public.register_rush_student(text, text, text) to anon;
grant execute on function public.join_rush_game(text, text) to anon;
grant execute on function public.submit_rush_answer(uuid, text, int, text, int) to anon;

notify pgrst, 'reload schema';
