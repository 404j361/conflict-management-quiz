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
  where players.role in ('student', 'admin')
  group by players.id
  order by score desc, correct_count desc, total_response_ms asc, players.joined_at asc;
$$;

grant execute on function public.get_monthly_rush_leaderboard(text) to anon;

notify pgrst, 'reload schema';
