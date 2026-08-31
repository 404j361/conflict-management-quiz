import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  CloudFog,
  HeartHandshake,
  IdCard,
  LockKeyhole,
  LogOut,
  Monitor,
  RotateCcw,
  Scale,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCircle,
  UserRoundPlus,
  UsersRound,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react'
import clsx from 'clsx'
import './App.css'
import {
  questions,
  styleMeta,
  styles,
  TOTAL_TIME,
  type ConflictStyle,
} from './questions'
import {
  ensureSession,
  finishGame,
  getCurrentMonthKey,
  isSupabaseConfigured,
  joinGame,
  loadPlayers,
  registerStudent,
  restartGame,
  applyAnswerToPlayer,
  revealQuestion,
  startCountdown,
  startQuestion,
  submitAnswer,
  supabase,
  updateGameSession,
  updateProfile,
  type Answer,
  type GameSession,
  type Player,
} from './supabase'

const iconMap = {
  Zap,
  HeartHandshake,
  CloudFog,
  Scale,
  UsersRound,
}

const PLAYER_STORAGE_KEY = 'rush-player'
const PLAYER_MONTH_STORAGE_KEY = 'rush-player-month'

function rememberPlayer(player: Player) {
  window.localStorage.setItem(PLAYER_STORAGE_KEY, JSON.stringify(player))
  window.localStorage.setItem(PLAYER_MONTH_STORAGE_KEY, getCurrentMonthKey())
}

function secondsSince(iso: string | null) {
  if (!iso) return 0
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
}

function useTicker() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((tick) => tick + 1), 200)
    return () => window.clearInterval(id)
  }, [])
  return tick
}

function rankPlayers(players: Player[]) {
  return [...players].sort((a, b) => b.score - a.score)
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return fallback
}

function App() {
  const tick = useTicker()
  const params = new URLSearchParams(window.location.search)
  const isAdmin = params.get('admin') === '1' || params.get('mode') === 'admin'
  const [screen, setScreen] = useState<'landing' | 'login' | 'register' | 'settings' | 'game'>(
    isAdmin ? 'login' : 'landing',
  )
  const [session, setSession] = useState<GameSession | null>(null)
  const [localSession, setLocalSession] = useState<GameSession>({
    id: 'local',
    status: 'LOBBY',
    current_question: 0,
    question_started_at: null,
    countdown_started_at: null,
    reveal_started_at: null,
  })
  const [players, setPlayers] = useState<Player[]>([])
  const [player, setPlayer] = useState<Player | null>(() => {
    const saved = window.localStorage.getItem(PLAYER_STORAGE_KEY)
    const savedMonth = window.localStorage.getItem(PLAYER_MONTH_STORAGE_KEY)
    if (savedMonth && savedMonth !== getCurrentMonthKey()) {
      window.localStorage.removeItem(PLAYER_STORAGE_KEY)
      window.localStorage.removeItem(PLAYER_MONTH_STORAGE_KEY)
      return null
    }
    return saved ? (JSON.parse(saved) as Player) : null
  })
  const [answers, setAnswers] = useState<Answer[]>([])
  const [feedback, setFeedback] = useState<Answer | null>(null)
  const [answering, setAnswering] = useState(false)
  const [recordThisRun, setRecordThisRun] = useState(false)
  const [muted, setMuted] = useState(true)
  const [dbNotice, setDbNotice] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [freshSession, freshPlayers] = await Promise.all([
        ensureSession(),
        loadPlayers(),
      ])
      setSession(freshSession)
      setPlayers(freshPlayers)
      setPlayer((current) => {
        if (!current) return current
        const freshPlayer = freshPlayers.find((item) => item.id === current.id)
        if (!freshPlayer) return current
        if (freshPlayer.total_answered < current.total_answered) {
          return current
        }
        rememberPlayer(freshPlayer)
        return freshPlayer
      })
    } catch (error) {
      setDbNotice(getErrorMessage(error, 'Supabase setup needed. Running local demo mode.'))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    const channel = client
      .channel('conflict-style-rush')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rush_sessions' }, () =>
        void refresh(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rush_players' }, () =>
        void refresh(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rush_answers' }, () =>
        void refresh(),
      )
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [refresh])

  const isAdminAuthorized = Boolean(isAdmin && player?.role === 'admin')
  const activeSession = isAdminAuthorized ? session : localSession

  useEffect(() => {
    if (!session || !isAdminAuthorized) return
    if (session.status === 'COUNTDOWN' && secondsSince(session.countdown_started_at) >= 4) {
      void startQuestion(0, player?.id).then(setSession).catch(() => undefined)
    }
    if (session.status === 'QUESTION' && secondsSince(session.question_started_at) >= TOTAL_TIME) {
      void revealQuestion(player?.id).then(setSession).catch(() => undefined)
    }
  }, [isAdminAuthorized, player?.id, session, tick])

  useEffect(() => {
    if (isAdmin || !player) return
    if (
      localSession.status === 'COUNTDOWN' &&
      secondsSince(localSession.countdown_started_at) >= 4
    ) {
      setLocalSession((current) => ({
        ...current,
        status: 'QUESTION',
        current_question: 0,
        question_started_at: new Date().toISOString(),
        reveal_started_at: null,
      }))
    }
    if (
      localSession.status === 'QUESTION' &&
      !answering &&
      secondsSince(localSession.question_started_at) >= TOTAL_TIME
    ) {
      void handleAnswer(null)
    }
  }, [answering, isAdmin, localSession, player, tick])

  const currentQuestion = activeSession ? questions[activeSession.current_question] : questions[0]
  const remainingTime =
    activeSession?.status === 'QUESTION'
      ? Math.max(0, TOTAL_TIME - secondsSince(activeSession.question_started_at))
      : TOTAL_TIME
  const progress = ((TOTAL_TIME - remainingTime) / TOTAL_TIME) * 100
  const visiblePlayers = useMemo(() => {
    if (!player) return players
    return [player, ...players.filter((item) => item.id !== player.id)]
  }, [player, players])
  const rankedPlayers = useMemo(() => rankPlayers(visiblePlayers), [visiblePlayers])
  const playerRank = player ? rankedPlayers.findIndex((item) => item.id === player.id) + 1 : 0
  const ownAnswers = player ? answers.filter((answer) => answer.player_id === player.id) : answers
  const hasCompletedMonth = (player?.total_answered ?? 0) >= questions.length

  async function enterLobby(joined: Player) {
    setProfileOpen(false)
    setPlayer(joined)
    rememberPlayer(joined)
    setScreen('game')
    setDbNotice('')
    await refresh()
  }

  async function handleLogin(studentId: string, password: string) {
    const joined = await joinGame(studentId, password)
    if (isAdmin && joined.role !== 'admin') {
      throw new Error('This account is not an admin.')
    }
    await enterLobby(joined)
  }

  async function handleRegister(studentId: string, displayName: string, password: string) {
    await enterLobby(await registerStudent(studentId, displayName, password))
  }

  async function handleProfileUpdate(displayName: string, password: string) {
    if (!player) return
    const updated = await updateProfile(player, displayName, password)
    setPlayer(updated)
    rememberPlayer(updated)
    setDbNotice('Profile updated.')
    setProfileOpen(false)
    setScreen('game')
    await refresh()
  }

  function handleLogout() {
    window.localStorage.removeItem(PLAYER_STORAGE_KEY)
    window.localStorage.removeItem(PLAYER_MONTH_STORAGE_KEY)
    setPlayer(null)
    setAnswers([])
    setFeedback(null)
    setProfileOpen(false)
    setScreen(isAdmin ? 'login' : 'landing')
  }

  function startPersonalRun() {
    if (hasCompletedMonth) return
    setProfileOpen(false)
    setFeedback(null)
    setAnswers([])
    setRecordThisRun((player?.total_answered ?? 0) === 0)
    setLocalSession({
      id: 'local',
      status: 'COUNTDOWN',
      current_question: 0,
      question_started_at: null,
      countdown_started_at: new Date().toISOString(),
      reveal_started_at: null,
    })
  }

  async function handleAnswer(style: ConflictStyle | null) {
    const runSession = activeSession
    if (!player || !runSession || feedback || answering || runSession.status !== 'QUESTION') return
    setAnswering(true)
    const question = questions[runSession.current_question]
    const selectedStyle = style ?? styles.find((item) => item !== question.correctAnswer) ?? 'Avoiding'
    const timeoutSession =
      style === null
        ? {
            ...runSession,
            question_started_at: new Date(Date.now() - TOTAL_TIME * 1000).toISOString(),
          }
        : runSession
    let answer: Answer
    try {
      answer = await submitAnswer(player, selectedStyle, timeoutSession, recordThisRun)
    } catch (error) {
      setDbNotice(
        `${getErrorMessage(error, 'Could not save this answer.')} Continuing this run locally.`,
      )
      answer = await submitAnswer(player, selectedStyle, timeoutSession, false)
    }
    setFeedback(answer)
    setAnswers((existing) => [...existing.filter((item) => item.question_id !== answer.question_id), answer])
    if (recordThisRun) {
      const updatedPlayer = applyAnswerToPlayer(player, answer, selectedStyle)
      setPlayer(updatedPlayer)
      rememberPlayer(updatedPlayer)
      setPlayers((existing) =>
        existing.some((item) => item.id === updatedPlayer.id)
          ? existing.map((item) => (item.id === updatedPlayer.id ? updatedPlayer : item))
          : [...existing, updatedPlayer],
      )
    }
    window.setTimeout(() => {
      setFeedback(null)
      setAnswering(false)
      if (!isAdminAuthorized) {
        advancePersonalRun()
      }
    }, 2200)
  }

  function advancePersonalRun() {
    setLocalSession((current) => {
      if (current.current_question >= questions.length - 1) {
        void refresh()
        return {
          ...current,
          status: 'FINAL_RESULTS',
          question_started_at: null,
          reveal_started_at: new Date().toISOString(),
        }
      }

      return {
        ...current,
        status: 'QUESTION',
        current_question: current.current_question + 1,
        question_started_at: new Date().toISOString(),
        reveal_started_at: null,
      }
    })
  }

  async function handleNextQuestion() {
    if (!session) return
    if (session.current_question >= questions.length - 1) {
      setSession(await finishGame(player?.id))
      return
    }
    setFeedback(null)
    setSession(await startQuestion(session.current_question + 1, player?.id))
  }

  return (
    <main className="app-shell">
      <div className="grid-bg" />
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="noise" />

      <header className="topbar">
        <button
          className="brand-chip"
          type="button"
          onClick={() => {
            setProfileOpen(false)
            setScreen(isAdmin ? 'login' : 'landing')
          }}
        >
          <Sparkles size={18} />
          Conflict Style Rush
        </button>
        <div className="topbar-actions">
          {!isAdmin && player?.role === 'admin' && (
            <button
              className="portal-button"
              type="button"
              onClick={() => {
                window.history.pushState(null, '', '/?admin=1')
                window.location.reload()
              }}
            >
              <Monitor size={17} />
              Admin Portal
            </button>
          )}
          <span className={clsx('db-chip', isSupabaseConfigured && 'online')}>
            {isSupabaseConfigured ? 'Supabase live' : 'Demo mode'}
          </span>
          {player && (
            <div className="profile-menu">
              <button
                className="profile-chip"
                type="button"
                onClick={() => setProfileOpen((value) => !value)}
              >
                <UserCircle size={19} />
                <span>{player.display_name}</span>
              </button>
              {profileOpen && (
                <div className="profile-dropdown">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false)
                      setScreen('settings')
                    }}
                  >
                    <Settings size={17} />
                    Settings
                  </button>
                  <button type="button" onClick={handleLogout}>
                    <LogOut size={17} />
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}
          <button className="icon-button" type="button" onClick={() => setMuted((value) => !value)}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
      </header>

      {dbNotice && <p className="notice">{dbNotice}</p>}

      <AnimatePresence mode="wait">
        {screen === 'landing' && !isAdmin && (
          <Landing key="landing" onEnter={() => setScreen(player ? 'game' : 'login')} />
        )}
        {screen === 'login' && (
          <Login
            key="login"
            onLogin={handleLogin}
            onShowRegister={isAdmin ? undefined : () => setScreen('register')}
            title={isAdmin ? 'ADMIN LOGIN' : 'PLAYER LOGIN'}
            subtitle={
              isAdmin
                ? 'Log in with an account whose database role is admin.'
                : 'Enter your student ID and password to join the live lobby.'
            }
          />
        )}
        {screen === 'register' && !isAdmin && (
          <Register
            key="register"
            onRegister={handleRegister}
            onShowLogin={() => setScreen('login')}
          />
        )}
        {screen === 'settings' && player && (
          <SettingsPage
            key="settings"
            player={player}
            onSave={handleProfileUpdate}
            onCancel={() => {
              setProfileOpen(false)
              setScreen('game')
            }}
          />
        )}
        {screen === 'game' && activeSession && (
          <GameSurface
            key="game"
            isAdmin={isAdminAuthorized}
            session={activeSession}
            player={player}
            players={rankedPlayers}
            currentQuestion={currentQuestion}
            remainingTime={remainingTime}
            progress={progress}
            answers={ownAnswers}
            feedback={feedback}
            isRecordedRun={recordThisRun}
            playerRank={playerRank}
            monthKey={getCurrentMonthKey()}
            onAnswer={(style) => void handleAnswer(style)}
            onPlayerStart={startPersonalRun}
            onStart={async () => setSession(await startCountdown(player?.id))}
            onPause={async () =>
              setSession(await updateGameSession({ status: 'PAUSED' }, player?.id))
            }
            onResume={async () => setSession(await startQuestion(activeSession.current_question, player?.id))}
            onReveal={async () => setSession(await revealQuestion(player?.id))}
            onNext={handleNextQuestion}
            onRestart={async () => {
              setFeedback(null)
              setAnswers([])
              if (isAdminAuthorized) {
                setSession(await restartGame(player?.id))
                await refresh()
              } else {
                startPersonalRun()
              }
            }}
          />
        )}
      </AnimatePresence>
    </main>
  )
}

function Landing({ onEnter }: { onEnter: () => void }) {
  return (
    <motion.section className="landing hero-band" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="arena-orbit" aria-hidden="true">
        <div className="ring ring-one" />
        <div className="ring ring-two" />
        <div className="core-mark">
          <ShieldCheck size={76} />
        </div>
      </div>
      <div className="hero-copy">
        <p className="eyebrow">University + Esports + Corporate Training</p>
        <h1>CONFLICT STYLE RUSH</h1>
        <h2>Think Fast. Manage Conflict. Win.</h2>
        <p>A rapid-fire organizational conflict management challenge.</p>
        <div className="style-badges">
          {styles.map((style) => (
            <StyleBadge key={style} style={style} />
          ))}
        </div>
        <button className="primary-button huge" type="button" onClick={onEnter}>
          ENTER GAME <ArrowRight size={22} />
        </button>
        <p className="microcopy">8 Conflicts • 4 Minutes • 1 Champion</p>
      </div>
    </motion.section>
  )
}

function Login({
  onLogin,
  onShowRegister,
  title,
  subtitle,
}: {
  onLogin: (studentId: string, password: string) => Promise<void>
  onShowRegister?: () => void
  title?: string
  subtitle?: string
}) {
  const [studentId, setStudentId] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onLogin(studentId, password)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not join the game.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.section className="auth-panel panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div>
        <p className="eyebrow">Secure classroom entry</p>
        <h1>{title ?? 'PLAYER LOGIN'}</h1>
        <p>{subtitle ?? 'Enter your student ID and password to join the live lobby.'}</p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Student ID</span>
          <div className="input-wrap">
            <IdCard size={19} />
            <input value={studentId} onChange={(event) => setStudentId(event.target.value)} placeholder="Enter your student ID" required />
          </div>
        </label>
        <label>
          <span>Password</span>
          <div className="input-wrap">
            <LockKeyhole size={19} />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              type="password"
            />
          </div>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={loading} type="submit">
          {loading ? 'JOINING...' : 'JOIN GAME'} <ArrowRight size={20} />
        </button>
      </form>
      {onShowRegister && (
        <button className="text-button" type="button" onClick={onShowRegister}>
          New player? Register first
        </button>
      )}
    </motion.section>
  )
}

function Register({
  onRegister,
  onShowLogin,
}: {
  onRegister: (studentId: string, displayName: string, password: string) => Promise<void>
  onShowLogin: () => void
}) {
  const [studentId, setStudentId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters.')
      }
      await onRegister(studentId, displayName, password)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not register this player.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.section className="auth-panel panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div>
        <p className="eyebrow">First-time player setup</p>
        <h1>REGISTER</h1>
        <p>Create your player profile before entering the lobby.</p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Student ID</span>
          <div className="input-wrap">
            <IdCard size={19} />
            <input
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder="Enter your student ID"
              required
            />
          </div>
        </label>
        <label>
          <span>Name</span>
          <div className="input-wrap">
            <UserRoundPlus size={19} />
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Enter your name"
              required
            />
          </div>
        </label>
        <label>
          <span>Password</span>
          <div className="input-wrap">
            <LockKeyhole size={19} />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Create a password"
              required
              type="password"
            />
          </div>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={loading} type="submit">
          {loading ? 'REGISTERING...' : 'REGISTER & JOIN'} <ArrowRight size={20} />
        </button>
      </form>
      <button className="text-button" type="button" onClick={onShowLogin}>
        Already registered? Log in
      </button>
    </motion.section>
  )
}

function SettingsPage({
  player,
  onSave,
  onCancel,
}: {
  player: Player
  onSave: (displayName: string, password: string) => Promise<void>
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState(player.display_name)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (password && password.length < 6) {
        throw new Error('New password must be at least 6 characters.')
      }
      await onSave(displayName, password)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not update profile.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.section className="auth-panel panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div>
        <p className="eyebrow">Account Settings</p>
        <h1>PROFILE</h1>
        <p>Update your display name or set a new password.</p>
      </div>
      <form onSubmit={submit}>
        <label>
          <span>Name</span>
          <div className="input-wrap">
            <UserRoundPlus size={19} />
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Enter your name"
              required
            />
          </div>
        </label>
        <label>
          <span>New Password</span>
          <div className="input-wrap">
            <LockKeyhole size={19} />
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Leave blank to keep current password"
              type="password"
            />
          </div>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={loading} type="submit">
          {loading ? 'SAVING...' : 'SAVE PROFILE'} <ArrowRight size={20} />
        </button>
      </form>
      <button className="text-button" type="button" onClick={onCancel}>
        Back to game
      </button>
    </motion.section>
  )
}

type GameSurfaceProps = {
  isAdmin: boolean
  session: GameSession
  player: Player | null
  players: Player[]
  currentQuestion: (typeof questions)[number]
  remainingTime: number
  progress: number
  answers: Answer[]
  feedback: Answer | null
  isRecordedRun: boolean
  playerRank: number
  monthKey: string
  onAnswer: (style: ConflictStyle) => void
  onPlayerStart: () => void
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onReveal: () => void
  onNext: () => void
  onRestart: () => void
}

function GameSurface(props: GameSurfaceProps) {
  if (props.isAdmin) return <AdminDisplay {...props} />
  if (!props.player) return null
  if (props.session.status === 'LOBBY' || props.session.status === 'PAUSED') {
    return <Lobby {...props} />
  }
  if (props.session.status === 'COUNTDOWN') return <Countdown session={props.session} />
  if (props.session.status === 'FINAL_RESULTS' || props.session.status === 'LEADERBOARD') {
    return <FinalResults {...props} />
  }
  return <QuestionScreen {...props} />
}

function Lobby({ player, players, session, onPlayerStart, playerRank, monthKey }: GameSurfaceProps) {
  const hasCompletedMonth = (player?.total_answered ?? 0) >= questions.length

  return (
    <motion.section className="lobby layout-two" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="panel lobby-main">
        <p className="eyebrow">Welcome, {player?.display_name}</p>
        <h1>GAME LOBBY</h1>
        <h2>{session.status === 'PAUSED' ? 'GAME PAUSED' : hasCompletedMonth ? 'MONTHLY RUN COMPLETE' : 'READY WHEN YOU ARE'}</h2>
        <button
          className="primary-button huge lobby-start"
          disabled={hasCompletedMonth}
          type="button"
          onClick={onPlayerStart}
        >
          {hasCompletedMonth ? 'COME BACK NEXT MONTH' : 'START GAME'} <ArrowRight size={22} />
        </button>
        {hasCompletedMonth ? (
          <p className="attempt-note">
            Your {monthKey} score is locked on the leaderboard. A new run opens next month.
          </p>
        ) : player?.total_answered ? (
          <p className="attempt-note">You have a partial monthly run. Only unanswered conflicts can still improve this month.</p>
        ) : (
          <p className="attempt-note">Your first completed run this month will count for the leaderboard.</p>
        )}
        <div className="ready-meter">
          <strong>{players.length} / 30</strong>
          <span>Players Ready</span>
        </div>
      </div>
      <Leaderboard players={players} playerId={player?.id} playerRank={playerRank} monthKey={monthKey} />
    </motion.section>
  )
}

function Countdown({ session }: { session: GameSession }) {
  const elapsed = secondsSince(session.countdown_started_at)
  const value = elapsed < 1 ? '3' : elapsed < 2 ? '2' : elapsed < 3 ? '1' : 'GO!'
  return (
    <section className="countdown">
      <motion.div key={value} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.5, opacity: 0 }}>
        {value}
      </motion.div>
    </section>
  )
}

function QuestionScreen({
  session,
  currentQuestion,
  remainingTime,
  progress,
  answers,
  feedback,
  onAnswer,
}: GameSurfaceProps) {
  const answered = Boolean(feedback || answers.some((answer) => answer.question_id === currentQuestion.id))
  const selected = feedback?.selected_style

  return (
    <motion.section className={clsx('game-board', currentQuestion.final && 'final-board')} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="game-hud">
        <div>
          <p className="eyebrow">{currentQuestion.final ? 'FINAL BOSS' : `CONFLICT ${String(session.current_question + 1).padStart(2, '0')} / 08`}</p>
          <ProgressDots answers={answers} currentIndex={session.current_question} />
        </div>
        <div className="timer-block">
          <span>TIME</span>
          <strong>{Math.ceil(remainingTime)}</strong>
        </div>
      </div>
      <div className="timer-bar"><span style={{ width: `${progress}%` }} /></div>

      <article className="scenario-card panel">
        {currentQuestion.final && <span className="boss-chip">FINAL CHALLENGE</span>}
        <h1>{currentQuestion.final ? 'FINAL CONFLICT' : currentQuestion.title}</h1>
        <p>{currentQuestion.scenario}</p>
        <h2>{currentQuestion.prompt}</h2>
      </article>

      <div className="answers-grid">
        {styles.map((style) => (
          <AnswerButton
            key={style}
            style={style}
            disabled={answered}
            selected={selected === style}
            correct={feedback?.is_correct && selected === style}
            wrong={feedback && selected === style && !feedback.is_correct}
            onClick={() => onAnswer(style)}
          />
        ))}
      </div>

      <AnimatePresence>
        {feedback && <Feedback answer={feedback} question={currentQuestion} />}
      </AnimatePresence>
    </motion.section>
  )
}

function Feedback({ answer, question }: { answer: Answer; question: (typeof questions)[number] }) {
  return (
    <motion.div className={clsx('feedback', answer.is_correct ? 'correct' : 'wrong')} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <strong>{answer.is_correct ? '✓ CORRECT' : '✕ NOT THIS TIME'}</strong>
      <span>{question.correctAnswer}</span>
      <p>{question.explanation}</p>
      <b>+{answer.points} XP</b>
    </motion.div>
  )
}

function FinalResults({ answers, players, playerRank, onRestart, isRecordedRun, player, monthKey }: GameSurfaceProps) {
  const score = answers.reduce((total, answer) => total + answer.points, 0)
  const correct = answers.filter((answer) => answer.is_correct).length
  const answered = Math.max(answers.length, 1)
  const avgMs =
    answers.reduce((total, answer) => total + answer.response_ms, 0)
  const dominant = getDominantStyle(answers)

  return (
    <section className="results layout-two">
      <div className="panel">
        <p className="eyebrow">GAME COMPLETE</p>
        <h1>{score} XP</h1>
        <p className="attempt-note">
          {isRecordedRun
            ? `This ${monthKey} score is recorded on the leaderboard.`
            : `This run is practice only. Your ${monthKey} leaderboard score is unchanged.`}
        </p>
        <div className="stat-grid">
          <Stat label="Accuracy" value={`${Math.round((correct / answered) * 100)}%`} />
          <Stat label="Avg Response" value={`${(avgMs / answered / 1000).toFixed(1)} sec`} />
          <Stat label="Correct Answers" value={`${correct} / 8`} />
        </div>
        <div className="style-result">
          <h2>YOUR CONFLICT STYLE</h2>
          <h3>{dominant}</h3>
          <p>{styleMeta[dominant].description}</p>
        </div>
        {isRecordedRun ? (
          <p className="attempt-note">Your next scored run opens next month.</p>
        ) : (
          <button className="primary-button retry-button" type="button" onClick={onRestart}>
            RETRY GAME <RotateCcw size={20} />
          </button>
        )}
      </div>
      <Leaderboard players={players} playerId={player?.id} playerRank={playerRank} monthKey={monthKey} />
    </section>
  )
}

function AdminDisplay(props: GameSurfaceProps) {
  const { players, onRestart } = props
  return (
    <section className="admin layout-two wide">
      <div className="panel projector">
        <div className="admin-hud">
          <span><Monitor size={18} /> Game Master Display</span>
          <strong>{players.length} live players</strong>
        </div>
        <ProjectorLeaderboard players={players} />
      </div>
      <aside className="panel admin-controls">
        <h2>Admin Room</h2>
        <button type="button" onClick={onRestart}><RotateCcw size={18} /> RESET CLASS DATA</button>
        <Leaderboard players={players} compact />
      </aside>
    </section>
  )
}

function ProjectorLeaderboard({ players }: { players: Player[] }) {
  const scoringPlayers = players.filter((leader) => leader.total_answered > 0)
  const podium = scoringPlayers.slice(0, 3)
  const runners = scoringPlayers.slice(3, 10)

  return (
    <div className="projector-board">
      <div className="projector-title">
        <Trophy size={54} />
        <div>
          <p className="eyebrow">{getCurrentMonthKey()} Monthly Scores</p>
          <h1>TOP CONFLICT MANAGERS</h1>
        </div>
      </div>

      {scoringPlayers.length === 0 ? (
        <div className="empty-leaderboard">
          <Trophy size={72} />
          <h2>Waiting For First Scores</h2>
          <p>Students can start from their own devices. Their monthly score will appear here.</p>
        </div>
      ) : (
        <>
          <div className="podium-grid">
            {podium.map((leader, index) => (
              <motion.div className={clsx('podium-card', `rank-${index + 1}`)} key={leader.id} layout>
                <span>{index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}</span>
                <strong>{leader.display_name}</strong>
                <b>{leader.score} XP</b>
                <small>{leader.correct_count} / 8 correct</small>
              </motion.div>
            ))}
          </div>
          <div className="projector-runners">
            {runners.map((leader, index) => (
              <motion.div className="runner-row" key={leader.id} layout>
                <span>#{index + 4}</span>
                <strong>{leader.display_name}</strong>
                <b>{leader.score} XP</b>
              </motion.div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Leaderboard({
  players,
  playerId,
  playerRank,
  compact = false,
  monthKey,
}: {
  players: Player[]
  playerId?: string
  playerRank?: number
  compact?: boolean
  monthKey?: string
}) {
  const visiblePlayers = compact
    ? players.filter((leader) => leader.total_answered > 0)
    : players

  return (
    <div className={clsx('leaderboard', compact && 'compact')}>
      <h2><Trophy size={24} /> {monthKey ? `${monthKey} LEADERBOARD` : 'TOP CONFLICT MANAGERS'}</h2>
      {visiblePlayers.slice(0, compact ? 5 : 8).map((leader, index) => (
        <motion.div className={clsx('leader-row', leader.id === playerId && 'you')} key={leader.id} layout>
          <span>{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}</span>
          <strong>{leader.id === playerId ? 'YOU' : leader.display_name}</strong>
          <b>{leader.score} XP</b>
        </motion.div>
      ))}
      {visiblePlayers.length === 0 && <p className="attempt-note">No first scores yet.</p>}
      {playerRank ? <p className="own-rank">YOU — #{playerRank} — {players.find((item) => item.id === playerId)?.score ?? 0} XP</p> : null}
    </div>
  )
}

function AnswerButton({
  style,
  disabled,
  selected,
  correct,
  wrong,
  onClick,
}: {
  style: ConflictStyle
  disabled: boolean
  selected?: boolean
  correct?: boolean
  wrong?: boolean | null
  onClick: () => void
}) {
  const meta = styleMeta[style]
  const Icon = iconMap[meta.icon as keyof typeof iconMap]
  return (
    <motion.button
      className={clsx('answer-button', selected && 'selected', correct && 'correct', wrong && 'wrong')}
      style={{ '--style-color': meta.color } as React.CSSProperties}
      whileTap={{ scale: 0.98 }}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <Icon size={25} />
      <span>{style}</span>
      <small>{meta.short}</small>
    </motion.button>
  )
}

function StyleBadge({ style }: { style: ConflictStyle }) {
  const meta = styleMeta[style]
  return (
    <span className="style-badge" style={{ '--style-color': meta.color } as React.CSSProperties}>
      {style}
    </span>
  )
}

function ProgressDots({ answers, currentIndex }: { answers: Answer[]; currentIndex: number }) {
  return (
    <div className="progress-dots">
      {questions.map((question, index) => {
        const answer = answers.find((item) => item.question_id === question.id)
        return (
          <span
            className={clsx(index === currentIndex && 'current', answer?.is_correct && 'good', answer && !answer.is_correct && 'bad')}
            key={question.id}
          />
        )
      })}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function getDominantStyle(answers: Answer[]) {
  const counts = styles.reduce(
    (acc, style) => ({ ...acc, [style]: 0 }),
    {} as Record<ConflictStyle, number>,
  )
  answers.forEach((answer) => {
    counts[answer.selected_style] += 1
  })
  return styles.reduce((winner, style) => (counts[style] > counts[winner] ? style : winner), 'Collaborating')
}

export default App
