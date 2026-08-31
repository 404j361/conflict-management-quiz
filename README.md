# Conflict Style Rush

A polished multiplayer classroom game for practicing conflict-management styles in organizations.

## Run Locally

```bash
npm install
npm run dev
```

Open the student game at the Vite URL. Open the instructor/projector dashboard with:

```text
http://localhost:5173/?admin=1
```

## Supabase Setup

The client uses only public Supabase values from `.env.local`.

```bash
VITE_SUPABASE_URL=https://ywfjdddugftnuawfwfpz.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Do not place the service role token in frontend code. To create the database tables and RPC functions, paste `supabase-schema.sql` into the Supabase SQL editor for project `ywfjdddugftnuawfwfpz` and run it.

Students register themselves from the app with student ID, name, and password. The database stores a password hash and only shows masked student IDs in the lobby.

## Make An Admin Account

Register once in the student app, then promote your own student ID in Supabase SQL Editor:

```sql
update public.rush_students
set role = 'admin'
where student_id = 'YOUR_STUDENT_ID';

update public.rush_players
set role = 'admin'
where student_id_hash = md5('YOUR_STUDENT_ID');

notify pgrst, 'reload schema';
```

After that, open `/?admin=1` and log in with that same student ID and password.

Optional manual seed:

```sql
insert into public.rush_students (student_id, display_name, password_hash)
values (
  '6612345',
  'Maya',
  md5('6612345' || ':' || 'student-password')
);
```

## Game Flow

- Student self-registration with Student ID, name, and password.
- Returning student login with Student ID and password.
- Lobby with masked player identifiers and a student-controlled start button.
- 8 rapid-fire scenarios, 50 seconds each.
- Students can complete one scored run per calendar month.
- Monthly leaderboards use only answers from the current month.
- A new scored run opens automatically when the next month begins.
- Final stats and leaderboard.
- Admin dashboard is protected by the `admin` role and can monitor/reset classroom data.
