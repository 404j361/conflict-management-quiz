import { createClient } from '@supabase/supabase-js'
import { calculateScore, questions, type ConflictStyle } from './questions'

export type GameStatus =
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'QUESTION'
  | 'ANSWER_REVEAL'
  | 'FINAL_RESULTS'
  | 'LEADERBOARD'
  | 'PAUSED'

export type GameSession = {
  id: string
  status: GameStatus
  current_question: number
  question_started_at: string | null
  countdown_started_at: string | null
  reveal_started_at: string | null
}

export type Player = {
  id: string
  student_id_mask: string
  display_name: string
  role: 'student' | 'admin'
  score: number
  correct_count: number
  total_answered: number
  total_response_ms: number
  favorite_style: ConflictStyle | null
  joined_at?: string
}

export type Answer = {
  id: string
  player_id: string
  question_id: number
  selected_style: ConflictStyle
  is_correct: boolean
  points: number
  response_ms: number
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null

export const isSupabaseConfigured = Boolean(supabase)

const nowIso = () => new Date().toISOString()

function maskStudentId(studentId: string) {
  const cleaned = studentId.replace(/\s/g, '')
  if (cleaned.length <= 4) return `ID-${cleaned}`
  return `${cleaned.slice(0, 2)}***${cleaned.slice(-3)}`
}

function nameFromId(studentId: string) {
  const tail = studentId.replace(/\D/g, '').slice(-3) || Math.floor(Math.random() * 900 + 100)
  return `Player ${tail}`
}

const demoPlayers: Player[] = [
  'Mira',
  'Napat',
  'Alex',
  'June',
  'Taylor',
  'Pim',
  'Kai',
  'Sam',
].map((name, index) => ({
  id: `demo-${index}`,
  student_id_mask: `ID-***${index + 21}`,
  display_name: name,
  role: index === 0 ? 'admin' : 'student',
  score: 760 - index * 39,
  correct_count: Math.max(3, 7 - (index % 4)),
  total_answered: 8,
  total_response_ms: 32000 + index * 1800,
  favorite_style: index % 2 ? 'Compromising' : 'Collaborating',
}))

export const fallbackSession: GameSession = {
  id: 'main',
  status: 'LOBBY',
  current_question: 0,
  question_started_at: null,
  countdown_started_at: null,
  reveal_started_at: null,
}

export async function ensureSession(): Promise<GameSession> {
  if (!supabase) return fallbackSession
  const { data, error } = await supabase
    .from('rush_sessions')
    .select('*')
    .eq('id', 'main')
    .maybeSingle()

  if (error) throw error
  if (data) return data as GameSession

  const { data: created, error: createError } = await supabase
    .from('rush_sessions')
    .insert({ id: 'main' })
    .select('*')
    .single()

  if (createError) throw createError
  return created as GameSession
}

export async function registerStudent(
  studentId: string,
  displayName: string,
  password: string,
): Promise<Player> {
  if (!supabase) {
    return {
      id: crypto.randomUUID(),
      student_id_mask: maskStudentId(studentId),
      display_name: displayName.trim() || nameFromId(studentId),
      role: 'student',
      score: 0,
      correct_count: 0,
      total_answered: 0,
      total_response_ms: 0,
      favorite_style: null,
    }
  }

  const { data, error } = await supabase.rpc('register_rush_student', {
    student_id_input: studentId,
    display_name_input: displayName,
    password_input: password,
  })

  if (error) throw error
  return data as Player
}

export async function joinGame(studentId: string, password: string): Promise<Player> {
  if (!supabase) {
    return {
      id: crypto.randomUUID(),
      student_id_mask: maskStudentId(studentId),
      display_name: nameFromId(studentId),
      role: 'student',
      score: 0,
      correct_count: 0,
      total_answered: 0,
      total_response_ms: 0,
      favorite_style: null,
    }
  }

  const { data, error } = await supabase.rpc('join_rush_game', {
    student_id_input: studentId,
    password_input: password,
  })

  if (error) throw error
  return data as Player
}

export async function loadPlayers(): Promise<Player[]> {
  if (!supabase) return demoPlayers
  const { data, error } = await supabase
    .from('rush_players')
    .select('*')
    .eq('role', 'student')
    .order('score', { ascending: false })
    .limit(50)

  if (error) throw error
  return data as Player[]
}

export async function loadAnswers(playerId?: string): Promise<Answer[]> {
  if (!supabase || !playerId) return []
  const { data, error } = await supabase
    .from('rush_answers')
    .select('*')
    .eq('player_id', playerId)
    .order('question_id')

  if (error) throw error
  return data as Answer[]
}

export async function updateGameSession(patch: Partial<GameSession>, adminPlayerId?: string) {
  if (!supabase) return { ...fallbackSession, ...patch }
  const { data, error } = await supabase.rpc('admin_update_rush_session', {
    admin_player_id_input: adminPlayerId ?? null,
    status_input: patch.status ?? null,
    current_question_input: patch.current_question ?? null,
    countdown_started_at_input: patch.countdown_started_at ?? null,
    question_started_at_input: patch.question_started_at ?? null,
    reveal_started_at_input: patch.reveal_started_at ?? null,
  })

  if (error) throw error
  return data as GameSession
}

export async function startCountdown(adminPlayerId?: string) {
  return updateGameSession({
    status: 'COUNTDOWN',
    current_question: 0,
    countdown_started_at: nowIso(),
    question_started_at: null,
    reveal_started_at: null,
  }, adminPlayerId)
}

export async function startQuestion(index: number, adminPlayerId?: string) {
  return updateGameSession({
    status: 'QUESTION',
    current_question: index,
    question_started_at: nowIso(),
    reveal_started_at: null,
  }, adminPlayerId)
}

export async function revealQuestion(adminPlayerId?: string) {
  return updateGameSession({
    status: 'ANSWER_REVEAL',
    reveal_started_at: nowIso(),
  }, adminPlayerId)
}

export async function finishGame(adminPlayerId?: string) {
  return updateGameSession({ status: 'FINAL_RESULTS' }, adminPlayerId)
}

export async function restartGame(adminPlayerId?: string) {
  if (supabase) {
    const { data, error } = await supabase.rpc('admin_restart_rush_game', {
      admin_player_id_input: adminPlayerId ?? null,
    })

    if (error) throw error
    return data as GameSession
  }
  return updateGameSession({
    status: 'LOBBY',
    current_question: 0,
    question_started_at: null,
    countdown_started_at: null,
    reveal_started_at: null,
  }, adminPlayerId)
}

export async function submitAnswer(
  player: Player,
  selectedStyle: ConflictStyle,
  session: GameSession,
  shouldRecord = true,
) {
  const question = questions[session.current_question]
  const startedAt = session.question_started_at
    ? new Date(session.question_started_at).getTime()
    : Date.now()
  const responseMs = Math.max(0, Date.now() - startedAt)
  const remaining = Math.max(0, 50 - responseMs / 1000)
  const isCorrect = selectedStyle === question.correctAnswer
  const points = calculateScore(isCorrect, remaining)

  const localAnswer = {
    id: crypto.randomUUID(),
    player_id: player.id,
    question_id: question.id,
    selected_style: selectedStyle,
    is_correct: isCorrect,
    points,
    response_ms: responseMs,
  } satisfies Answer

  if (!supabase || !shouldRecord) {
    return localAnswer
  }

  const { data, error } = await supabase.rpc('submit_rush_answer', {
    player_id_input: player.id,
    question_id_input: question.id,
    selected_style_input: selectedStyle,
    response_ms_input: responseMs,
  })

  if (error) throw error
  return data as Answer
}

export function applyAnswerToPlayer(player: Player, answer: Answer, selectedStyle: ConflictStyle) {
  return {
    ...player,
    score: player.score + answer.points,
    correct_count: player.correct_count + (answer.is_correct ? 1 : 0),
    total_answered: player.total_answered + 1,
    total_response_ms: player.total_response_ms + answer.response_ms,
    favorite_style: selectedStyle,
  }
}

export function createLocalAnswer(
  player: Player,
  selectedStyle: ConflictStyle,
  session: GameSession,
) {
  const question = questions[session.current_question]
  const startedAt = session.question_started_at
    ? new Date(session.question_started_at).getTime()
    : Date.now()
  const responseMs = Math.max(0, Date.now() - startedAt)
  const remaining = Math.max(0, 50 - responseMs / 1000)
  const isCorrect = selectedStyle === question.correctAnswer
  const points = calculateScore(isCorrect, remaining)

  return {
    id: crypto.randomUUID(),
    player_id: player.id,
    question_id: question.id,
    selected_style: selectedStyle,
    is_correct: isCorrect,
    points,
    response_ms: responseMs,
  } satisfies Answer
}
