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

grant execute on function public.submit_rush_answer(uuid, int, text, int) to anon;

notify pgrst, 'reload schema';
