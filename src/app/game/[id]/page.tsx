'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Game, Player, QuizQuestion, LeaderboardEntry, Team } from '@/types'

const ANSWER_COLORS = {
  A: { bg: 'bg-kawared', text: 'text-white', shape: '▲' },
  B: { bg: 'bg-kawaBlue', text: 'text-white', shape: '◆' },
  C: { bg: 'bg-kawaYellow', text: 'text-kawaDark', shape: '●' },
  D: { bg: 'bg-kawaGreen', text: 'text-white', shape: '■' },
}

export default function GameHostPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  // Stable client — never recreated across renders
  const supabase = useMemo(() => createClient(), [])

  const [game, setGame] = useState<Game | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [answerCounts, setAnswerCounts] = useState({ A: 0, B: 0, C: 0, D: 0 })
  const [loading, setLoading] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [assigningPlayer, setAssigningPlayer] = useState<string | null>(null) // playerId being assigned
  const [classes, setClasses] = useState<{ id: string; name: string; students: string[] }[]>([])
  const [showRosterPanel, setShowRosterPanel] = useState(false)
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [attendance, setAttendance] = useState<Record<string, boolean>>({})
  const [importingStudents, setImportingStudents] = useState(false)

  const questionsRef = useRef<QuizQuestion[]>([])
  questionsRef.current = questions

  // Load classes from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('kawahoot_classes')
      if (stored) setClasses(JSON.parse(stored))
    } catch {}
  }, [])

  // Initial load
  useEffect(() => {
    async function load() {
      const { data: gameData } = await supabase.from('games').select('*').eq('id', id).single()
      if (!gameData) { router.push('/host'); return }
      setGame(gameData)

      const { data: qData } = await supabase
        .from('quiz_questions').select('*').eq('game_id', id).order('order_index')
      setQuestions(qData || [])

      if (gameData.current_question_index >= 0 && qData) {
        setCurrentQuestion(qData[gameData.current_question_index] || null)
      }

      // Save to local game library
      try {
        const saved = JSON.parse(localStorage.getItem('kawahoot_games') || '[]')
        const exists = saved.some((g: { id: string }) => g.id === id)
        if (!exists) {
          saved.unshift({ id, title: gameData.title, pin: gameData.pin, createdAt: gameData.created_at })
          localStorage.setItem('kawahoot_games', JSON.stringify(saved.slice(0, 20)))
        }
      } catch {}
    }
    load()
  }, [id, router, supabase])

  // Players: poll every 3s + realtime (client-side filtered)
  useEffect(() => {
    function refetch() {
      supabase.from('players').select('*').eq('game_id', id).order('score', { ascending: false })
        .then(({ data }) => setPlayers(data || []))
    }
    refetch()
    const poll = setInterval(refetch, 3000)
    const sub = supabase.channel(`host-players-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, (payload) => {
        const row = (payload.new || payload.old) as { game_id?: string } | null
        if (row?.game_id === id) refetch()
      })
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(sub) }
  }, [id, supabase])

  // Teams: fetch + realtime
  useEffect(() => {
    function refetch() {
      supabase.from('teams').select('*').eq('game_id', id).order('created_at')
        .then(({ data }) => setTeams(data || []))
    }
    refetch()
    const sub = supabase.channel(`host-teams-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, (payload) => {
        const row = (payload.new || payload.old) as { game_id?: string } | null
        if (row?.game_id === id) refetch()
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [id, supabase])

  // Host drives all game state changes via button clicks — no polling needed here.
  // Polling game state would race against optimistic updates and revert them.

  // Answer counts: poll + realtime
  useEffect(() => {
    if (!currentQuestion) return
    function refetch() {
      supabase.from('answers').select('selected_answer').eq('question_id', currentQuestion!.id)
        .then(({ data }) => {
          const counts = { A: 0, B: 0, C: 0, D: 0 }
          data?.forEach(a => { counts[a.selected_answer as keyof typeof counts]++ })
          setAnswerCounts(counts)
        })
    }
    refetch()
    const poll = setInterval(refetch, 2000)
    const sub = supabase.channel(`host-answers-${currentQuestion.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers' }, (payload) => {
        const row = payload.new as { question_id?: string } | null
        if (row?.question_id === currentQuestion.id) refetch()
      })
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(sub) }
  }, [currentQuestion?.id, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown timer
  useEffect(() => {
    if (!game || game.status !== 'question' || !currentQuestion || !game.current_question_started_at) return
    const startedAt = new Date(game.current_question_started_at).getTime()
    const tick = setInterval(() => {
      const left = Math.max(0, currentQuestion.time_limit - (Date.now() - startedAt) / 1000)
      setTimeLeft(Math.ceil(left))
      if (left <= 0) clearInterval(tick)
    }, 200)
    return () => clearInterval(tick)
  }, [game?.status, game?.current_question_started_at, currentQuestion]) // eslint-disable-line react-hooks/exhaustive-deps

  const TEAM_PRESETS = [
    { name: 'Red Team', color: 'kawared' },
    { name: 'Blue Team', color: 'kawaBlue' },
    { name: 'Yellow Team', color: 'kawaYellow' },
    { name: 'Green Team', color: 'kawaGreen' },
    { name: 'Purple Team', color: 'kawaPurple' },
    { name: 'Orange Team', color: 'kawaCoral' },
  ]

  const TEAM_COLORS: Record<string, string> = {
    kawared: 'bg-kawared',
    kawaBlue: 'bg-kawaBlue',
    kawaYellow: 'bg-kawaYellow',
    kawaGreen: 'bg-kawaGreen',
    kawaPurple: 'bg-kawaPurple',
    kawaCoral: 'bg-kawaCoral',
  }

  const importStudents = useCallback(async () => {
    const cls = classes.find(c => c.id === selectedClassId)
    if (!cls) return
    const present = cls.students.filter(s => attendance[s] !== false)
    if (!present.length) return
    setImportingStudents(true)
    await fetch('/api/game/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'pre_register', names: present }),
    })
    setImportingStudents(false)
    setShowRosterPanel(false)
    setSelectedClassId(null)
    setAttendance({})
  }, [id, classes, selectedClassId, attendance])

  const autoAssignTeams = useCallback(async () => {
    const res = await fetch('/api/game/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'auto_assign' }),
    })
    const data = await res.json()
    if (data.success && data.assignments) {
      setPlayers(prev => prev.map(p => {
        const a = data.assignments.find((x: { playerId: string; teamId: string }) => x.playerId === p.id)
        return a ? { ...p, team_id: a.teamId } : p
      }))
    }
  }, [id])

  const setMode = useCallback(async (mode: 'individual' | 'teams') => {
    setGame(prev => prev ? { ...prev, mode } : prev)
    await fetch('/api/game/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'set_mode', mode }),
    })
    if (mode === 'individual') {
      setPlayers(prev => prev.map(p => ({ ...p, team_id: null })))
    }
  }, [id])

  const addTeam = useCallback(async () => {
    const used = teams.map(t => t.name)
    const preset = TEAM_PRESETS.find(p => !used.includes(p.name)) || { name: `Team ${teams.length + 1}`, color: 'kawaPurple' }
    const res = await fetch('/api/game/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'create', name: preset.name, color: preset.color }),
    })
    const data = await res.json()
    if (data.success) setTeams(prev => [...prev, data.team])
  }, [id, teams]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteTeam = useCallback(async (teamId: string) => {
    setTeams(prev => prev.filter(t => t.id !== teamId))
    setPlayers(prev => prev.map(p => p.team_id === teamId ? { ...p, team_id: null } : p))
    await fetch('/api/game/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'delete', teamId }),
    })
  }, [id])

  const assignPlayer = useCallback(async (playerId: string, teamId: string | null) => {
    setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, team_id: teamId } : p))
    setAssigningPlayer(null)
    await fetch('/api/game/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'assign', playerId, teamId }),
    })
  }, [id])

  const startGame = useCallback(async () => {
    setLoading(true)
    await fetch('/api/game/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    const q = questionsRef.current[0]
    if (q) {
      setCurrentQuestion(q)
      setAnswerCounts({ A: 0, B: 0, C: 0, D: 0 })
      setGame(prev => prev ? { ...prev, status: 'question', current_question_index: 0, current_question_started_at: new Date().toISOString() } : prev)
    }
    setLoading(false)
  }, [id])

  const revealAnswer = useCallback(async () => {
    setLoading(true)
    await fetch('/api/game/reveal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    // Optimistic local update so UI doesn't wait for realtime/poll
    setGame(prev => prev ? { ...prev, status: 'answer_reveal' } : prev)
    const { data } = await supabase
      .from('players').select('*').eq('game_id', id).order('score', { ascending: false }).limit(10)
    setLeaderboard((data || []).map((p, i) => ({ player_id: p.id, nickname: p.nickname, score: p.score, rank: i + 1 })))
    setLoading(false)
  }, [id, supabase])

  const nextQuestion = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/game/next-question', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    const data = await res.json()
    if (data.question) {
      setCurrentQuestion(data.question)
      setAnswerCounts({ A: 0, B: 0, C: 0, D: 0 })
      // Optimistic local update
      setGame(prev => prev ? { ...prev, status: 'question', current_question_index: prev.current_question_index + 1, current_question_started_at: new Date().toISOString() } : prev)
    }
    setLoading(false)
  }, [id])

  const randomQuestion = useCallback(async () => {
    setLoading(true)
    const played = game?.current_question_index ?? 0
    const remaining = questionsRef.current
      .map((_, i) => i)
      .filter(i => i > played)
    if (!remaining.length) return setLoading(false)
    const targetIndex = remaining[Math.floor(Math.random() * remaining.length)]
    const res = await fetch('/api/game/next-question', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, targetIndex }),
    })
    const data = await res.json()
    if (data.question) {
      setCurrentQuestion(data.question)
      setAnswerCounts({ A: 0, B: 0, C: 0, D: 0 })
      setGame(prev => prev ? { ...prev, status: 'question', current_question_index: targetIndex, current_question_started_at: new Date().toISOString() } : prev)
    }
    setLoading(false)
  }, [id, game?.current_question_index])

  const replayGame = useCallback(async () => {
    setReplaying(true)
    const res = await fetch('/api/game/replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    const data = await res.json()
    if (data.success) {
      // Persist new game to saved library
      try {
        const saved = JSON.parse(localStorage.getItem('kawahoot_games') || '[]')
        const updated = saved.map((g: { id: string }) =>
          g.id === id ? { ...g, nextGameId: data.gameId } : g
        )
        localStorage.setItem('kawahoot_games', JSON.stringify(updated))
      } catch {}
      router.push(`/game/${data.gameId}`)
    } else {
      setReplaying(false)
    }
  }, [id, router])

  const restartGame = useCallback(async () => {
    setRestarting(true)
    await fetch('/api/game/restart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    setGame(prev => prev ? { ...prev, status: 'waiting', current_question_index: -1, current_question_started_at: null } : prev)
    setPlayers(prev => prev.map(p => ({ ...p, score: 0 })))
    setCurrentQuestion(null)
    setLeaderboard([])
    setAnswerCounts({ A: 0, B: 0, C: 0, D: 0 })
    setRestarting(false)
  }, [id])

  const endGame = useCallback(async () => {
    setLoading(true)
    await fetch('/api/game/end', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    setGame(prev => prev ? { ...prev, status: 'finished' } : prev)
    setLoading(false)
  }, [id])

  const pauseGame = useCallback(async () => {
    setGame(prev => prev ? { ...prev, status: 'paused' } : prev)
    await fetch('/api/game/pause', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'pause' }),
    })
  }, [id])

  const resumeGame = useCallback(async () => {
    setGame(prev => prev ? { ...prev, status: 'answer_reveal' } : prev)
    setAssigningPlayer(null)
    await fetch('/api/game/pause', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'resume' }),
    })
  }, [id])

  if (!game) {
    return (
      <div className="min-h-screen bg-kawaDark flex items-center justify-center">
        <div className="text-white text-xl animate-pulse">Loading game...</div>
      </div>
    )
  }

  const isLast = game.current_question_index >= questions.length - 1
  const totalAnswers = answerCounts.A + answerCounts.B + answerCounts.C + answerCounts.D

  return (
    <div className="min-h-screen bg-kawaDark p-4 md:p-6">
      {/* Header — compact during question phase to make room for the question banner */}
      {(game.status === 'question' || game.status === 'answer_reveal') && currentQuestion ? (
        <div className="flex items-center gap-4 mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/rcs-logo.png" alt="RCS" className="h-16 flex-shrink-0 pointer-events-none" />
          <div className="flex-1 bg-white rounded-2xl shadow-2xl border-4 border-kawaYellow px-6 py-4 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-white to-yellow-50 pointer-events-none" />
            <div className="relative z-10">
              <p className="text-kawaDark/50 text-xs font-bold uppercase tracking-widest mb-1">
                Q{game.current_question_index + 1} / {questions.length}
              </p>
              <p className="text-kawaDark font-bold text-2xl md:text-3xl lg:text-4xl leading-tight" style={{ fontFamily: "'Fredoka One', cursive" }}>
                {currentQuestion.question_text}
              </p>
            </div>
          </div>
          <div className="text-center bg-white/10 border border-white/20 rounded-2xl px-4 py-2 flex-shrink-0">
            <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">PIN</p>
            <p className="text-kawaYellow font-bold text-2xl tracking-widest" style={{ fontFamily: "'Fredoka One', cursive" }}>
              {game.pin}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-white font-bold text-xl md:text-2xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
              {game.title}
            </h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/rcs-logo.png" alt="RCS" className="h-40 mt-3 pointer-events-none" />
          </div>
          <div className="text-center bg-white/10 border border-white/20 rounded-2xl px-6 py-3">
            <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">Game PIN</p>
            <p className="text-kawaYellow font-bold text-3xl tracking-widest" style={{ fontFamily: "'Fredoka One', cursive" }}>
              {game.pin}
            </p>
          </div>
        </div>
      )}

      {/* WAITING LOBBY */}
      {game.status === 'waiting' && (
        <div className="max-w-2xl mx-auto">
          {/* PIN display */}
          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-3xl p-6 mb-5 text-center">
            <p className="text-white/60 mb-2 text-sm">Students join at <span className="text-kawaYellow font-bold">kawahoot.vercel.app</span></p>
            <div className="my-4 flex justify-center">
              <div className="bg-kawaDark border-4 border-kawaYellow rounded-2xl px-8 py-4 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-kawaYellow text-kawaDark text-xs font-bold px-3 py-1 rounded-full">GAME PIN</div>
                <p className="text-white font-bold text-6xl tracking-[0.2em]" style={{ fontFamily: "'Fredoka One', cursive" }}>{game.pin}</p>
              </div>
            </div>
            <div className="flex items-center justify-center gap-3">
              <div className="w-3 h-3 rounded-full bg-kawaGreen animate-pulse" />
              <p className="text-white font-semibold">{players.length} player{players.length !== 1 ? 's' : ''} waiting</p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 mb-5">
            <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 text-center">Game Mode</p>
            <div className="flex gap-3">
              <button
                onClick={() => setMode('individual')}
                className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${game.mode === 'individual' ? 'bg-kawaPurple text-white scale-105' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                👤 Individual
              </button>
              <button
                onClick={() => setMode('teams')}
                className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${game.mode === 'teams' ? 'bg-kawaCoral text-white scale-105' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                👥 Teams
              </button>
            </div>
          </div>

          {/* Class Roster panel */}
          {classes.length > 0 && (
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 mb-5">
              <button
                onClick={() => setShowRosterPanel(!showRosterPanel)}
                className="w-full flex items-center justify-between text-white font-bold"
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                <span>🎓 Use Class Roster</span>
                <span className="text-white/40 text-sm">{showRosterPanel ? '▲' : '▼'}</span>
              </button>
              {showRosterPanel && (
                <div className="mt-4 space-y-3">
                  {/* Class selector */}
                  <div className="flex flex-wrap gap-2">
                    {classes.map(cls => (
                      <button
                        key={cls.id}
                        onClick={() => {
                          setSelectedClassId(cls.id)
                          const att: Record<string, boolean> = {}
                          cls.students.forEach(s => { att[s] = true })
                          setAttendance(att)
                        }}
                        className={`px-3 py-1.5 rounded-xl font-bold text-sm transition-all ${selectedClassId === cls.id ? 'bg-kawaPurple text-white' : 'bg-white/10 text-white/70 hover:bg-white/20'}`}
                      >
                        {cls.name} ({cls.students.length})
                      </button>
                    ))}
                  </div>

                  {/* Attendance */}
                  {selectedClassId && (() => {
                    const cls = classes.find(c => c.id === selectedClassId)!
                    const presentCount = cls.students.filter(s => attendance[s] !== false).length
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-white/60 text-xs font-bold uppercase tracking-widest">{presentCount} present</p>
                          <div className="flex gap-3">
                            <button onClick={() => { const all: Record<string, boolean> = {}; cls.students.forEach(s => { all[s] = true }); setAttendance(all) }} className="text-kawaGreen text-xs font-bold hover:underline">All</button>
                            <button onClick={() => { const none: Record<string, boolean> = {}; cls.students.forEach(s => { none[s] = false }); setAttendance(none) }} className="text-kawared text-xs font-bold hover:underline">None</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto">
                          {cls.students.map(student => {
                            const present = attendance[student] !== false
                            return (
                              <button
                                key={student}
                                onClick={() => setAttendance(prev => ({ ...prev, [student]: !present }))}
                                className={`text-xs font-bold px-2 py-1.5 rounded-lg transition-all text-left truncate ${present ? 'bg-kawaGreen/30 border border-kawaGreen/60 text-white' : 'bg-white/5 border border-white/10 text-white/25 line-through'}`}
                              >
                                {student}
                              </button>
                            )
                          })}
                        </div>
                        <button
                          onClick={importStudents}
                          disabled={importingStudents || presentCount === 0}
                          className="w-full mt-3 bg-kawaPurple hover:bg-purple-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all"
                          style={{ fontFamily: "'Fredoka One', cursive" }}
                        >
                          {importingStudents ? 'Importing...' : `Import ${presentCount} Present Student${presentCount !== 1 ? 's' : ''}`}
                        </button>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Individual mode: player chips */}
          {game.mode === 'individual' && players.length > 0 && (
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 mb-5">
              <div className="flex flex-wrap gap-2 justify-center">
                {players.map(p => (
                  <span key={p.id} className="bg-kawaPurple/40 border border-kawaPurple text-white text-sm font-bold px-3 py-1.5 rounded-full animate-bounce-in">
                    {p.nickname}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Teams mode: team builder */}
          {game.mode === 'teams' && (
            <div className="space-y-4 mb-5">
              {/* Unassigned players */}
              <div className="bg-white/10 border border-white/20 rounded-2xl p-4">
                <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-3">
                  Players ({players.filter(p => !p.team_id).length} unassigned)
                </p>
                <div className="flex flex-wrap gap-2 min-h-[36px]">
                  {players.filter(p => !p.team_id).map(p => (
                    <button
                      key={p.id}
                      onClick={() => setAssigningPlayer(assigningPlayer === p.id ? null : p.id)}
                      className={`text-white text-sm font-bold px-3 py-1.5 rounded-full transition-all ${assigningPlayer === p.id ? 'bg-kawaYellow text-kawaDark scale-110 ring-2 ring-white' : 'bg-kawaPurple/40 border border-kawaPurple hover:bg-kawaPurple/60'}`}
                    >
                      {p.nickname}
                    </button>
                  ))}
                  {players.filter(p => !p.team_id).length === 0 && (
                    <p className="text-white/30 text-sm italic">All players assigned</p>
                  )}
                </div>
                {assigningPlayer && (
                  <p className="text-kawaYellow text-xs mt-2 animate-pulse">
                    ↓ Click a team to assign <strong>{players.find(p => p.id === assigningPlayer)?.nickname}</strong>
                  </p>
                )}
                {teams.length > 0 && players.filter(p => !p.team_id).length > 0 && (
                  <button
                    onClick={autoAssignTeams}
                    className="mt-3 w-full bg-kawaCoral/20 border border-kawaCoral/40 hover:bg-kawaCoral/30 text-kawaCoral font-bold py-2 rounded-xl transition-all text-sm"
                  >
                    🎲 Auto-assign all to teams
                  </button>
                )}
              </div>

              {/* Teams */}
              {teams.map(team => {
                const teamPlayers = players.filter(p => p.team_id === team.id)
                const colorClass = TEAM_COLORS[team.color] || 'bg-kawaPurple'
                return (
                  <div
                    key={team.id}
                    onClick={() => assigningPlayer && assignPlayer(assigningPlayer, team.id)}
                    className={`border-2 rounded-2xl p-4 transition-all ${assigningPlayer ? 'border-kawaYellow cursor-pointer hover:scale-[1.02] hover:bg-white/10' : 'border-white/20'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full ${colorClass}`} />
                        <p className="text-white font-bold">{team.name}</p>
                        <span className="text-white/40 text-sm">({teamPlayers.length})</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTeam(team.id) }}
                        className="text-white/30 hover:text-kawared text-lg transition-colors"
                      >×</button>
                    </div>
                    <div className="flex flex-wrap gap-2 min-h-[28px]">
                      {teamPlayers.map(p => (
                        <button
                          key={p.id}
                          onClick={(e) => { e.stopPropagation(); assignPlayer(p.id, null) }}
                          className={`${colorClass} text-white text-xs font-bold px-2.5 py-1 rounded-full hover:opacity-70 transition-opacity`}
                          title="Click to unassign"
                        >
                          {p.nickname} ×
                        </button>
                      ))}
                      {teamPlayers.length === 0 && (
                        <p className="text-white/20 text-xs italic">No players yet</p>
                      )}
                    </div>
                  </div>
                )
              })}

              {teams.length < 6 && (
                <button
                  onClick={addTeam}
                  className="w-full border-2 border-dashed border-white/20 rounded-2xl py-3 text-white/50 hover:text-white hover:border-white/40 transition-all font-bold"
                >
                  + Add Team
                </button>
              )}
            </div>
          )}

          <button onClick={startGame} disabled={loading || players.length === 0}
            className="w-full bg-kawaGreen hover:bg-green-400 disabled:opacity-50 text-white font-bold text-2xl py-5 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-xl"
            style={{ fontFamily: "'Fredoka One', cursive" }}>
            {loading ? 'Starting...' : players.length === 0 ? 'Waiting for players...' : `Start Game (${players.length} players) 🚀`}
          </button>
        </div>
      )}

      {/* QUESTION PHASE */}
      {(game.status === 'question' || game.status === 'answer_reveal') && currentQuestion && (
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <span className="text-white/50 text-sm">{players.length} players</span>
            <div className="flex items-center gap-3">
              <span className="text-white/60 text-sm">{totalAnswers} / {players.length} answered</span>
              {game.status === 'question' && players.length - totalAnswers > 0 && (
                <span className="bg-kawared/20 border border-kawared/50 text-kawared font-bold text-sm px-3 py-1 rounded-full animate-pulse">
                  {players.length - totalAnswers} left
                </span>
              )}
              {game.status === 'question' && players.length > 0 && players.length - totalAnswers === 0 && (
                <span className="bg-kawaGreen/20 border border-kawaGreen/50 text-kawaGreen font-bold text-sm px-3 py-1 rounded-full">
                  All answered ✓
                </span>
              )}
            </div>
          </div>

          {game.status === 'question' && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-white/60 mb-1">
                <span>Time left</span>
                <span className={`font-bold text-lg ${timeLeft <= 5 ? 'text-kawared' : 'text-kawaYellow'}`}>{timeLeft}s</span>
              </div>
              <div className="h-4 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-kawaYellow to-kawaCoral rounded-full transition-all duration-200"
                  style={{ width: `${(timeLeft / currentQuestion.time_limit) * 100}%` }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-4">
            {(['A', 'B', 'C', 'D'] as const).map(opt => {
              const color = ANSWER_COLORS[opt]
              const count = answerCounts[opt]
              const pct = totalAnswers > 0 ? (count / totalAnswers) * 100 : 0
              const isCorrect = currentQuestion.correct_answer === opt
              return (
                <div key={opt}
                  className={`${color.bg} ${color.text} rounded-xl p-3 relative overflow-hidden
                    ${game.status === 'answer_reveal' && isCorrect ? 'ring-4 ring-white' : ''}
                    ${game.status === 'answer_reveal' && !isCorrect ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{color.shape}</span>
                    <span className="font-bold truncate">
                      {currentQuestion[`option_${opt.toLowerCase()}` as 'option_a' | 'option_b' | 'option_c' | 'option_d']}
                    </span>
                    {game.status === 'answer_reveal' && isCorrect && <span className="ml-auto text-xl">✓</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-black/20 rounded-full">
                      <div className="h-full bg-white/40 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-bold opacity-80">{count}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {game.status === 'answer_reveal' && leaderboard.length > 0 && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4 mb-4">
              <h3 className="text-white font-bold mb-3 text-center" style={{ fontFamily: "'Fredoka One', cursive" }}>Top Players</h3>
              <div className="space-y-2">
                {leaderboard.slice(0, 5).map((entry, i) => (
                  <div key={entry.player_id} className="flex items-center gap-3">
                    <span className="text-2xl">{['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]}</span>
                    <span className="flex-1 text-white font-semibold">{entry.nickname}</span>
                    <span className="text-kawaYellow font-bold">{entry.score.toLocaleString()} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            {game.status === 'question' && (
              <button onClick={revealAnswer} disabled={loading}
                className="flex-1 bg-kawaCoral hover:bg-orange-500 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                style={{ fontFamily: "'Fredoka One', cursive" }}>
                {loading ? '...' : 'Reveal Answer →'}
              </button>
            )}
            {game.status === 'answer_reveal' && (
              !isLast ? (
                <>
                  <button onClick={nextQuestion} disabled={loading}
                    className="flex-1 bg-kawaPurple hover:bg-purple-600 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                    style={{ fontFamily: "'Fredoka One', cursive" }}>
                    {loading ? '...' : 'Next →'}
                  </button>
                  <button onClick={randomQuestion} disabled={loading}
                    className="flex-1 bg-kawaCoral hover:bg-orange-500 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                    style={{ fontFamily: "'Fredoka One', cursive" }}>
                    {loading ? '...' : '🎲 Random'}
                  </button>
                  <button onClick={pauseGame} disabled={loading}
                    className="bg-white/10 hover:bg-white/20 border border-white/20 disabled:opacity-50 text-white font-bold text-xl py-4 px-5 rounded-2xl transition-all hover:scale-105 active:scale-95"
                    title="Pause & edit teams"
                    style={{ fontFamily: "'Fredoka One', cursive" }}>
                    ⏸
                  </button>
                </>
              ) : (
                <button onClick={endGame} disabled={loading}
                  className="flex-1 bg-kawaYellow hover:bg-yellow-400 disabled:opacity-50 text-kawaDark font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                  style={{ fontFamily: "'Fredoka One', cursive" }}>
                  {loading ? '...' : '🏆 End Game & Final Scores'}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* PAUSED */}
      {game.status === 'paused' && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-kawaYellow/20 border-2 border-kawaYellow rounded-3xl p-5 mb-5 text-center">
            <p className="text-kawaYellow font-bold text-2xl mb-1" style={{ fontFamily: "'Fredoka One', cursive" }}>
              ⏸ Game Paused
            </p>
            <p className="text-white/60 text-sm">Reconfigure teams below, then resume when ready.</p>
          </div>

          {/* Mode toggle */}
          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 mb-5">
            <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-3 text-center">Game Mode</p>
            <div className="flex gap-3">
              <button
                onClick={() => setMode('individual')}
                className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${game.mode === 'individual' ? 'bg-kawaPurple text-white scale-105' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                👤 Individual
              </button>
              <button
                onClick={() => setMode('teams')}
                className={`flex-1 py-3 rounded-xl font-bold text-lg transition-all ${game.mode === 'teams' ? 'bg-kawaCoral text-white scale-105' : 'bg-white/10 text-white/50 hover:bg-white/20'}`}
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                👥 Teams
              </button>
            </div>
          </div>

          {/* Individual mode: player chips */}
          {game.mode === 'individual' && players.length > 0 && (
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 mb-5">
              <div className="flex flex-wrap gap-2 justify-center">
                {players.map(p => (
                  <span key={p.id} className="bg-kawaPurple/40 border border-kawaPurple text-white text-sm font-bold px-3 py-1.5 rounded-full">
                    {p.nickname}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Teams mode: team builder */}
          {game.mode === 'teams' && (
            <div className="space-y-4 mb-5">
              <div className="bg-white/10 border border-white/20 rounded-2xl p-4">
                <p className="text-white/60 text-xs font-bold uppercase tracking-widest mb-3">
                  Players ({players.filter(p => !p.team_id).length} unassigned)
                </p>
                <div className="flex flex-wrap gap-2 min-h-[36px]">
                  {players.filter(p => !p.team_id).map(p => (
                    <button
                      key={p.id}
                      onClick={() => setAssigningPlayer(assigningPlayer === p.id ? null : p.id)}
                      className={`text-white text-sm font-bold px-3 py-1.5 rounded-full transition-all ${assigningPlayer === p.id ? 'bg-kawaYellow text-kawaDark scale-110 ring-2 ring-white' : 'bg-kawaPurple/40 border border-kawaPurple hover:bg-kawaPurple/60'}`}
                    >
                      {p.nickname}
                    </button>
                  ))}
                  {players.filter(p => !p.team_id).length === 0 && (
                    <p className="text-white/30 text-sm italic">All players assigned</p>
                  )}
                </div>
                {assigningPlayer && (
                  <p className="text-kawaYellow text-xs mt-2 animate-pulse">
                    ↓ Click a team to assign <strong>{players.find(p => p.id === assigningPlayer)?.nickname}</strong>
                  </p>
                )}
                {teams.length > 0 && players.filter(p => !p.team_id).length > 0 && (
                  <button
                    onClick={autoAssignTeams}
                    className="mt-3 w-full bg-kawaCoral/20 border border-kawaCoral/40 hover:bg-kawaCoral/30 text-kawaCoral font-bold py-2 rounded-xl transition-all text-sm"
                  >
                    🎲 Auto-assign all to teams
                  </button>
                )}
              </div>

              {teams.map(team => {
                const teamPlayers = players.filter(p => p.team_id === team.id)
                const colorClass = TEAM_COLORS[team.color] || 'bg-kawaPurple'
                return (
                  <div
                    key={team.id}
                    onClick={() => assigningPlayer && assignPlayer(assigningPlayer, team.id)}
                    className={`border-2 rounded-2xl p-4 transition-all ${assigningPlayer ? 'border-kawaYellow cursor-pointer hover:scale-[1.02] hover:bg-white/10' : 'border-white/20'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-4 h-4 rounded-full ${colorClass}`} />
                        <p className="text-white font-bold">{team.name}</p>
                        <span className="text-white/40 text-sm">({teamPlayers.length})</span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTeam(team.id) }}
                        className="text-white/30 hover:text-kawared text-lg transition-colors"
                      >×</button>
                    </div>
                    <div className="flex flex-wrap gap-2 min-h-[28px]">
                      {teamPlayers.map(p => (
                        <button
                          key={p.id}
                          onClick={(e) => { e.stopPropagation(); assignPlayer(p.id, null) }}
                          className={`${colorClass} text-white text-xs font-bold px-2.5 py-1 rounded-full hover:opacity-70 transition-opacity`}
                          title="Click to unassign"
                        >
                          {p.nickname} ×
                        </button>
                      ))}
                      {teamPlayers.length === 0 && (
                        <p className="text-white/20 text-xs italic">No players yet</p>
                      )}
                    </div>
                  </div>
                )
              })}

              {teams.length < 6 && (
                <button
                  onClick={addTeam}
                  className="w-full border-2 border-dashed border-white/20 rounded-2xl py-3 text-white/50 hover:text-white hover:border-white/40 transition-all font-bold"
                >
                  + Add Team
                </button>
              )}
            </div>
          )}

          <button onClick={resumeGame}
            className="w-full bg-kawaGreen hover:bg-green-400 text-white font-bold text-2xl py-5 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-xl"
            style={{ fontFamily: "'Fredoka One', cursive" }}>
            ▶ Resume Game
          </button>
        </div>
      )}

      {/* FINISHED */}
      {game.status === 'finished' && (() => {
        // Compute team scores
        const teamScores = teams.map(team => ({
          team,
          score: players.filter(p => p.team_id === team.id).reduce((sum, p) => sum + p.score, 0),
          members: players.filter(p => p.team_id === team.id),
        })).sort((a, b) => b.score - a.score)

        return (
        <div className="max-w-lg mx-auto">
          {/* Header */}
          <div className="text-center mb-8 animate-bounce-in">
            <div className="text-7xl mb-3">🏆</div>
            <h2 className="text-white font-bold text-5xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
              Game Over!
            </h2>
            <p className="text-purple-300 mt-1">{game.title}</p>
          </div>

          {/* Winning team banner (teams mode only) */}
          {game.mode === 'teams' && teamScores.length > 0 && (
            <div className={`${TEAM_COLORS[teamScores[0].team.color] || 'bg-kawaPurple'} rounded-3xl p-6 mb-6 text-center shadow-xl animate-bounce-in`}>
              <p className="text-white/80 text-sm font-bold uppercase tracking-widest mb-1">Winning Team</p>
              <p className="text-white font-bold text-4xl mb-1" style={{ fontFamily: "'Fredoka One', cursive" }}>
                🏆 {teamScores[0].team.name}
              </p>
              <p className="text-white/80 font-bold text-2xl">{teamScores[0].score.toLocaleString()} pts</p>
              <div className="flex flex-wrap gap-2 justify-center mt-3">
                {teamScores[0].members.map(p => (
                  <span key={p.id} className="bg-white/20 text-white text-sm font-bold px-3 py-1 rounded-full">{p.nickname}</span>
                ))}
              </div>
            </div>
          )}

          {/* All teams scoreboard (teams mode) */}
          {game.mode === 'teams' && teamScores.length > 1 && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4 mb-6">
              <h3 className="text-white font-bold mb-3 text-center" style={{ fontFamily: "'Fredoka One', cursive" }}>Team Scores</h3>
              <div className="space-y-2">
                {teamScores.map((ts, i) => (
                  <div key={ts.team.id} className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
                    <span className="text-xl">{['🥇','🥈','🥉','4','5','6'][i]}</span>
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${TEAM_COLORS[ts.team.color] || 'bg-kawaPurple'}`} />
                    <span className="flex-1 text-white font-semibold">{ts.team.name}</span>
                    <span className="text-kawaYellow font-bold">{ts.score.toLocaleString()} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top 3 podium — individual scores */}
          {game.mode === 'teams' && players.length > 0 && (
            <p className="text-white/60 text-xs font-bold uppercase tracking-widest text-center mb-3">Top Individuals</p>
          )}
          {players.length >= 1 && (
            <div className="flex items-end justify-center gap-3 mb-6">
              {/* 2nd */}
              {players[1] && (
                <div className="flex-1 text-center animate-slide-up" style={{ animationDelay: '0.1s' }}>
                  <div className="text-3xl mb-1">🥈</div>
                  <div className="bg-white/20 border border-white/30 rounded-t-2xl px-2 py-3" style={{ height: 100 }}>
                    <p className="text-white font-bold text-sm truncate">{players[1].nickname}</p>
                    <p className="text-kawaYellow font-bold text-lg">{players[1].score.toLocaleString()}</p>
                    <p className="text-white/40 text-xs">pts</p>
                  </div>
                </div>
              )}
              {/* 1st */}
              <div className="flex-1 text-center animate-slide-up">
                <div className="text-4xl mb-1">🥇</div>
                <div className="bg-kawaYellow/30 border-2 border-kawaYellow rounded-t-2xl px-2 py-3" style={{ height: 130 }}>
                  <p className="text-white font-bold text-sm truncate">{players[0].nickname}</p>
                  <p className="text-kawaYellow font-bold text-xl">{players[0].score.toLocaleString()}</p>
                  <p className="text-white/40 text-xs">pts</p>
                </div>
              </div>
              {/* 3rd */}
              {players[2] && (
                <div className="flex-1 text-center animate-slide-up" style={{ animationDelay: '0.2s' }}>
                  <div className="text-3xl mb-1">🥉</div>
                  <div className="bg-white/10 border border-white/20 rounded-t-2xl px-2 py-3" style={{ height: 80 }}>
                    <p className="text-white font-bold text-sm truncate">{players[2].nickname}</p>
                    <p className="text-kawaYellow font-bold text-base">{players[2].score.toLocaleString()}</p>
                    <p className="text-white/40 text-xs">pts</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Full scoreboard */}
          {players.length > 3 && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4 mb-6 space-y-2">
              {players.slice(3, 10).map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
                  <span className="text-white/50 font-bold w-6 text-center text-sm">{i + 4}</span>
                  <span className="flex-1 text-white font-semibold">{p.nickname}</span>
                  <span className="text-kawaYellow font-bold">{p.score.toLocaleString()} pts</span>
                </div>
              ))}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={restartGame}
              disabled={restarting}
              className="flex-1 bg-kawaGreen hover:bg-green-400 disabled:opacity-60 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg"
              style={{ fontFamily: "'Fredoka One', cursive" }}
            >
              {restarting ? 'Restarting...' : '↺ Restart'}
            </button>
            <button
              onClick={replayGame}
              disabled={replaying}
              className="flex-1 bg-kawaYellow hover:bg-yellow-400 disabled:opacity-60 text-kawaDark font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg"
              style={{ fontFamily: "'Fredoka One', cursive" }}
            >
              {replaying ? 'Starting...' : '🔁 Play Again'}
            </button>
            <a href="/host"
              className="flex-1 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 text-center"
              style={{ fontFamily: "'Fredoka One', cursive" }}>
              🎮 New Game
            </a>
          </div>
        </div>
        )
      })()}
    </div>
  )
}
