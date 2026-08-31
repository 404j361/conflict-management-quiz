create table if not exists public.rush_sessions (
  id text primary key default 'main',
  status text not null default 'LOBBY'
    check (status in ('LOBBY', 'COUNTDOWN', 'QUESTION', 'ANSWER_REVEAL', 'FINAL_RESULTS', 'LEADERBOARD', 'PAUSED')),
  current_question int not null default 0 check (current_question between 0 and 7),
  countdown_started_at timestamptz,
  question_started_at timestamptz,
  reveal_started_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.rush_students (
  student_id text primary key,
  display_name text not null,
  role text not null default 'student' check (role in ('student', 'admin')),
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.rush_students
add column if not exists role text not null default 'student'
check (role in ('student', 'admin'));

alter table public.rush_students
add column if not exists password_hash text;

alter table public.rush_students
add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rush_students'
      and column_name = 'dob_hash'
  ) then
    alter table public.rush_students alter column dob_hash drop not null;
  end if;
end $$;

create table if not exists public.rush_players (
  id uuid primary key default gen_random_uuid(),
  student_id_hash text not null unique,
  student_id_mask text not null,
  display_name text not null,
  role text not null default 'student' check (role in ('student', 'admin')),
  score int not null default 0,
  correct_count int not null default 0,
  total_answered int not null default 0,
  total_response_ms int not null default 0,
  favorite_style text,
  joined_at timestamptz not null default now()
);

alter table public.rush_players
add column if not exists role text not null default 'student'
check (role in ('student', 'admin'));

create table if not exists public.rush_answers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.rush_players(id) on delete cascade,
  question_id int not null check (question_id between 1 and 8),
  selected_style text not null check (selected_style in ('Competing', 'Accommodating', 'Avoiding', 'Compromising', 'Collaborating')),
  is_correct boolean not null,
  points int not null,
  response_ms int not null,
  answered_at timestamptz not null default now(),
  unique (player_id, question_id)
);

insert into public.rush_sessions (id)
values ('main')
on conflict (id) do nothing;

alter table public.rush_sessions enable row level security;
alter table public.rush_players enable row level security;
alter table public.rush_answers enable row level security;
alter table public.rush_students enable row level security;

drop policy if exists "read game session" on public.rush_sessions;
drop policy if exists "read players" on public.rush_players;
drop policy if exists "read answers" on public.rush_answers;
drop policy if exists "admin-ish update session" on public.rush_sessions;

create policy "read game session"
on public.rush_sessions for select
to anon
using (true);

create policy "read players"
on public.rush_players for select
to anon
using (role = 'student');

create policy "read answers"
on public.rush_answers for select
to anon
using (true);

create or replace function public.mask_student_id(student_id_input text)
returns text
language sql
immutable
as $$
  select case
    when length(regexp_replace(student_id_input, '\s', '', 'g')) <= 4
      then 'ID-' || regexp_replace(student_id_input, '\s', '', 'g')
    else substring(regexp_replace(student_id_input, '\s', '', 'g') from 1 for 2)
      || '***'
      || right(regexp_replace(student_id_input, '\s', '', 'g'), 3)
  end;
$$;

create or replace function public.correct_style_for_question(question_id_input int)
returns text
language sql
immutable
as $$
  select case question_id_input
    when 1 then 'Accommodating'
    when 2 then 'Competing'
    when 3 then 'Avoiding'
    when 4 then 'Compromising'
    when 5 then 'Collaborating'
    when 6 then 'Avoiding'
    when 7 then 'Compromising'
    when 8 then 'Collaborating'
  end;
$$;

drop function if exists public.register_rush_student(text, text, text);

create or replace function public.register_rush_student(
  student_id_input text,
  display_name_input text,
  password_input text
)
returns public.rush_players
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

  return joined_player;
exception
  when unique_violation then
    raise exception 'This student ID is already registered. Please log in.';
end;
$$;

drop function if exists public.join_rush_game(text, text);

create or replace function public.join_rush_game(student_id_input text, password_input text)
returns public.rush_players
language plpgsql
security definer
set search_path = public
as $$
declare
  student_record public.rush_students%rowtype;
  joined_player public.rush_players%rowtype;
  normalized_id text := trim(student_id_input);
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

  return joined_player;
end;
$$;

create or replace function public.is_rush_admin(admin_player_id_input uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rush_players
    where id = admin_player_id_input
      and role = 'admin'
  );
$$;

create or replace function public.admin_update_rush_session(
  admin_player_id_input uuid,
  status_input text default null,
  current_question_input int default null,
  countdown_started_at_input timestamptz default null,
  question_started_at_input timestamptz default null,
  reveal_started_at_input timestamptz default null
)
returns public.rush_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  session_record public.rush_sessions%rowtype;
begin
  if not public.is_rush_admin(admin_player_id_input) then
    raise exception 'Admin role required.';
  end if;

  update public.rush_sessions
  set
    status = coalesce(status_input, status),
    current_question = coalesce(current_question_input, current_question),
    countdown_started_at = countdown_started_at_input,
    question_started_at = question_started_at_input,
    reveal_started_at = reveal_started_at_input,
    updated_at = now()
  where id = 'main'
  returning * into session_record;

  return session_record;
end;
$$;

create or replace function public.admin_restart_rush_game(admin_player_id_input uuid)
returns public.rush_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  session_record public.rush_sessions%rowtype;
begin
  if not public.is_rush_admin(admin_player_id_input) then
    raise exception 'Admin role required.';
  end if;

  delete from public.rush_answers;

  update public.rush_players
  set
    score = 0,
    correct_count = 0,
    total_answered = 0,
    total_response_ms = 0,
    favorite_style = null;

  update public.rush_sessions
  set
    status = 'LOBBY',
    current_question = 0,
    countdown_started_at = null,
    question_started_at = null,
    reveal_started_at = null,
    updated_at = now()
  where id = 'main'
  returning * into session_record;

  return session_record;
end;
$$;

drop function if exists public.submit_rush_answer(uuid, int, text);
drop function if exists public.submit_rush_answer(uuid, int, text, int);

create or replace function public.submit_rush_answer(
  player_id_input uuid,
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
    question_id,
    selected_style,
    is_correct,
    points,
    response_ms
  )
  values (
    player_id_input,
    question_id_input,
    selected_style_input,
    is_correct_value,
    points_value,
    response_ms_value
  )
  on conflict (player_id, question_id) do update
    set selected_style = public.rush_answers.selected_style
  returning * into answer_record;

  update public.rush_players
  set
    score = (
      select coalesce(sum(points), 0)
      from public.rush_answers
      where player_id = player_id_input
    ),
    correct_count = (
      select count(*)::int
      from public.rush_answers
      where player_id = player_id_input and is_correct
    ),
    total_answered = (
      select count(*)::int
      from public.rush_answers
      where player_id = player_id_input
    ),
    total_response_ms = (
      select coalesce(sum(response_ms), 0)::int
      from public.rush_answers
      where player_id = player_id_input
    ),
    favorite_style = selected_style_input
  where id = player_id_input;

  return answer_record;
end;
$$;

grant execute on function public.register_rush_student(text, text, text) to anon;
grant execute on function public.join_rush_game(text, text) to anon;
grant execute on function public.admin_update_rush_session(uuid, text, int, timestamptz, timestamptz, timestamptz) to anon;
grant execute on function public.admin_restart_rush_game(uuid) to anon;
grant execute on function public.submit_rush_answer(uuid, int, text, int) to anon;

notify pgrst, 'reload schema';
