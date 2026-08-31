alter table public.rush_students
add column if not exists student_id_hash text;

update public.rush_students
set student_id_hash = md5(student_id)
where student_id_hash is null;

create unique index if not exists rush_students_student_id_hash_key
on public.rush_students (student_id_hash);

drop function if exists public.update_rush_profile(uuid, text, text);

create or replace function public.update_rush_profile(
  player_id_input uuid,
  display_name_input text,
  password_input text default null
)
returns public.rush_players
language plpgsql
security definer
set search_path = public
as $$
declare
  player_record public.rush_players%rowtype;
  updated_player public.rush_players%rowtype;
  normalized_name text := trim(display_name_input);
begin
  if normalized_name = '' then
    raise exception 'Name is required.';
  end if;

  if password_input is not null and password_input <> '' and length(password_input) < 6 then
    raise exception 'Password must be at least 6 characters.';
  end if;

  select * into player_record
  from public.rush_players
  where id = player_id_input;

  if not found then
    raise exception 'Player not found.';
  end if;

  update public.rush_players
  set display_name = normalized_name
  where id = player_id_input
  returning * into updated_player;

  update public.rush_students
  set
    display_name = normalized_name,
    password_hash = case
      when password_input is not null and password_input <> ''
        then md5(student_id || ':' || password_input)
      else password_hash
    end
  where student_id_hash = player_record.student_id_hash;

  return updated_player;
end;
$$;

grant execute on function public.update_rush_profile(uuid, text, text) to anon;

notify pgrst, 'reload schema';
