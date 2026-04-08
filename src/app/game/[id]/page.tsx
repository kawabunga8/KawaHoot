'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import HostGate from '@/components/HostGate'
import type { Game, Player, QuizQuestion, LeaderboardEntry, Team, KawaClass } from '@/types'

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
  const [playerAnswers, setPlayerAnswers] = useState<Record<string, { selected_answer: string; is_correct: boolean; response_time_ms: number }>>({})
  const [showTeacherPanel, setShowTeacherPanel] = useState(false)
  const [savedGames, setSavedGames] = useState<{ id: string; title: string; pin: string }[]>([])
  const [showRestartPicker, setShowRestartPicker] = useState(false)
  const [showMusicPanel, setShowMusicPanel] = useState(false)
  const [musicTrackName, setMusicTrackName] = useState('')
  const [musicPlaying, setMusicPlaying] = useState(false)
  const [musicVolume, setMusicVolume] = useState(0.5)
  const [musicLoop, setMusicLoop] = useState(true)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const musicFileRef = useRef<HTMLInputElement | null>(null)
  const [classes, setClasses] = useState<KawaClass[]>([])
  const [showRosterPanel, setShowRosterPanel] = useState(false)
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [attendance, setAttendance] = useState<Record<string, boolean>>({})
  const [importingStudents, setImportingStudents] = useState(false)

  const questionsRef = useRef<QuizQuestion[]>([])
  questionsRef.current = questions

  const teamScores = useMemo(() =>
    teams.map(t => ({
      ...t,
      score: players.filter(p => p.team_id === t.id).reduce((sum, p) => sum + p.score, 0),
    })).sort((a, b) => b.score - a.score),
  [teams, players])

  // Load classes from shared API (group-maker data)
  useEffect(() => {
    fetch('/api/classes').then(r => r.ok ? r.json() : Promise.reject()).then(data => {
      if (Array.isArray(data)) setClasses(data)
    }).catch(() => {})
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
        setSavedGames(saved)
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

  // Per-player answers for teacher panel
  useEffect(() => {
    if (!currentQuestion) { setPlayerAnswers({}); return }
    function refetch() {
      supabase.from('answers')
        .select('player_id, selected_answer, is_correct, response_time_ms')
        .eq('question_id', currentQuestion!.id)
        .then(({ data }) => {
          const map: Record<string, { selected_answer: string; is_correct: boolean; response_time_ms: number }> = {}
          data?.forEach(a => { map[a.player_id] = { selected_answer: a.selected_answer, is_correct: a.is_correct, response_time_ms: a.response_time_ms } })
          setPlayerAnswers(map)
        })
    }
    refetch()
    const poll = setInterval(refetch, 2000)
    return () => clearInterval(poll)
  }, [currentQuestion?.id, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Countdown timer — auto-reveals answer when time runs out
  const autoRevealedRef = useRef(false)
  useEffect(() => {
    if (!game || game.status !== 'question' || !currentQuestion || !game.current_question_started_at) return
    autoRevealedRef.current = false
    const startedAt = new Date(game.current_question_started_at).getTime()
    const tick = setInterval(() => {
      const left = Math.max(0, currentQuestion.time_limit - (Date.now() - startedAt) / 1000)
      setTimeLeft(Math.ceil(left))
      if (left <= 0) {
        clearInterval(tick)
        if (!autoRevealedRef.current) {
          autoRevealedRef.current = true
          fetch('/api/game/reveal', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId: id }),
          })
        }
      }
    }, 200)
    return () => clearInterval(tick)
  }, [game?.status, game?.current_question_started_at, currentQuestion, id]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const TEAM_COLOR_HEX: Record<string, string> = {
    kawared: '#EF4444',
    kawaBlue: '#3B82F6',
    kawaYellow: '#F59E0B',
    kawaGreen: '#22C55E',
    kawaPurple: '#7C3AED',
    kawaCoral: '#F97316',
  }

  const importStudents = useCallback(async () => {
    const cls = classes.find(c => c.id === selectedClassId)
    if (!cls) return
    const present = cls.students.filter(s => attendance[s.full_name] !== false).map(s => s.full_name)
    if (!present.length) return
    setImportingStudents(true)
    await fetch('/api/game/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'pre_register', names: present }),
    })
    setImportingStudents(false)
  }, [id, classes, selectedClassId, attendance])

  const markAbsent = useCallback(async (playerId: string) => {
    setPlayers(prev => prev.filter(p => p.id !== playerId))
    await fetch('/api/game/teams', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id, action: 'remove_player', playerId }),
    })
  }, [id])

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
    else alert(`Failed to add team: ${data.error || 'Unknown error'}`)
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
    setGame(prev => prev ? { ...prev, status: 'answer_reveal' } : prev)
    setLoading(false)
  }, [id])

  const showScores = useCallback(async () => {
    setLoading(true)
    await fetch('/api/game/show-scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    setGame(prev => prev ? { ...prev, status: 'scores' } : prev)
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

  const replayGame = useCallback(async (sourceId?: string) => {
    setReplaying(true)
    const targetId = sourceId || id
    const res = await fetch('/api/game/replay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: targetId }),
    })
    const data = await res.json()
    if (data.success) {
      try {
        const saved = JSON.parse(localStorage.getItem('kawahoot_games') || '[]')
        const updated = saved.map((g: { id: string }) =>
          g.id === targetId ? { ...g, nextGameId: data.gameId } : g
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

  async function openDisplay() {
    const url = `/game/${id}/display`
    if ('getScreenDetails' in window) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sd = await (window as any).getScreenDetails()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ext = sd.screens.find((s: any) => !s.isPrimary) || sd.screens[0]
        window.open(url, '_blank',
          `left=${ext.availLeft},top=${ext.availTop},width=${ext.availWidth},height=${ext.availHeight}`)
        return
      } catch { /* permission denied or unsupported */ }
    }
    window.open(url, '_blank')
  }

  function handleMusicFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = url
      audioRef.current.loop = musicLoop
      audioRef.current.volume = musicVolume
      audioRef.current.play()
      setMusicPlaying(true)
    } else {
      const audio = new Audio(url)
      audio.loop = musicLoop
      audio.volume = musicVolume
      audio.play()
      audioRef.current = audio
      audio.addEventListener('ended', () => { if (!audio.loop) setMusicPlaying(false) })
      setMusicPlaying(true)
    }
    setMusicTrackName(file.name.replace(/\.[^.]+$/, ''))
  }

  function togglePlayPause() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) { audio.play(); setMusicPlaying(true) }
    else { audio.pause(); setMusicPlaying(false) }
  }

  function handleVolumeChange(v: number) {
    setMusicVolume(v)
    if (audioRef.current) audioRef.current.volume = v
  }

  function toggleLoop() {
    const next = !musicLoop
    setMusicLoop(next)
    if (audioRef.current) audioRef.current.loop = next
  }

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
    <HostGate>
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

      {/* TEACHER DATA PANEL */}
      {showTeacherPanel && players.length > 0 && (
        <div className="max-w-3xl mx-auto mb-5">
          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <p className="text-white font-bold text-sm uppercase tracking-widest">📋 Teacher Panel</p>
              <p className="text-white/40 text-xs">{players.length} players</p>
            </div>
            <div className="overflow-auto max-h-64">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-4 py-2 text-white/40 font-bold uppercase tracking-wider text-xs">Real Name</th>
                    <th className="text-left px-4 py-2 text-white/40 font-bold uppercase tracking-wider text-xs">Game Name</th>
                    <th className="text-right px-4 py-2 text-white/40 font-bold uppercase tracking-wider text-xs">Score</th>
                    {currentQuestion && (
                      <>
                        <th className="text-center px-4 py-2 text-white/40 font-bold uppercase tracking-wider text-xs">Answer</th>
                        <th className="text-right px-4 py-2 text-white/40 font-bold uppercase tracking-wider text-xs">Time</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {players.map(p => {
                    const ans = playerAnswers[p.id]
                    return (
                      <tr key={p.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="px-4 py-2 text-white/70">{p.real_name || <span className="text-white/25 italic">guest</span>}</td>
                        <td className="px-4 py-2 text-white font-bold">{p.nickname}</td>
                        <td className="px-4 py-2 text-kawaYellow font-bold text-right">{p.score.toLocaleString()}</td>
                        {currentQuestion && (
                          <>
                            <td className="px-4 py-2 text-center">
                              {ans ? (
                                <span className={`font-bold px-2 py-0.5 rounded text-xs ${ans.is_correct ? 'bg-kawaGreen/30 text-kawaGreen' : 'bg-kawared/30 text-kawared'}`}>
                                  {ans.selected_answer} {ans.is_correct ? '✓' : '✗'}
                                </span>
                              ) : (
                                <span className="text-white/20 text-xs italic">–</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-white/50 text-right text-xs">
                              {ans ? `${(ans.response_time_ms / 1000).toFixed(1)}s` : ''}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
                          cls.students.forEach(s => { att[s.full_name] = true })
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
                    const presentCount = cls.students.filter(s => attendance[s.full_name] !== false).length
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-white/60 text-xs font-bold uppercase tracking-widest">{presentCount} present</p>
                          <div className="flex gap-3">
                            <button onClick={() => { const all: Record<string, boolean> = {}; cls.students.forEach(s => { all[s.full_name] = true }); setAttendance(all) }} className="text-kawaGreen text-xs font-bold hover:underline">All</button>
                            <button onClick={() => { const none: Record<string, boolean> = {}; cls.students.forEach(s => { none[s.full_name] = false }); setAttendance(none) }} className="text-kawared text-xs font-bold hover:underline">None</button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto">
                          {cls.students.map(student => {
                            const present = attendance[student.full_name] !== false
                            return (
                              <button
                                key={student.id || student.full_name}
                                onClick={() => setAttendance(prev => ({ ...prev, [student.full_name]: !present }))}
                                className={`text-xs font-bold px-2 py-1.5 rounded-lg transition-all text-left truncate ${present ? 'bg-kawaGreen/30 border border-kawaGreen/60 text-white' : 'bg-white/5 border border-white/10 text-white/25 line-through'}`}
                              >
                                {student.full_name}
                              </button>
                            )
                          })}
                        </div>
                        {(() => {
                          const preReg = players.filter(p => p.is_pre_registered)
                          const claimed = preReg.filter(p => p.is_claimed).length
                          const total = preReg.length
                          if (total > 0) {
                            const ratio = total > 0 ? claimed / total : 0
                            const bg = ratio === 1 ? 'bg-kawaGreen' : ratio >= 0.5 ? 'bg-kawaYellow' : 'bg-kawaCoral'
                            const fg = ratio >= 0.5 ? 'text-kawaDark' : 'text-white'
                            return (
                              <button
                                onClick={importStudents}
                                disabled={importingStudents}
                                className={`w-full mt-3 ${bg} disabled:opacity-70 ${fg} font-bold py-3 rounded-xl transition-all`}
                                style={{ fontFamily: "'Fredoka One', cursive" }}
                              >
                                {importingStudents ? 'Importing...' : `Imported ✓ — ${claimed}/${total} joined`}
                              </button>
                            )
                          }
                          return (
                            <button
                              onClick={importStudents}
                              disabled={importingStudents || presentCount === 0}
                              className="w-full mt-3 bg-kawaPurple hover:bg-purple-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all"
                              style={{ fontFamily: "'Fredoka One', cursive" }}
                            >
                              {importingStudents ? 'Importing...' : `Import ${presentCount} Present Student${presentCount !== 1 ? 's' : ''}`}
                            </button>
                          )
                        })()}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Student check-in panel — shown when class is imported */}
          {(() => {
            const preReg = players.filter(p => p.is_pre_registered)
            if (preReg.length === 0) return null
            const claimed = preReg.filter(p => p.is_claimed)
            const unclaimed = preReg.filter(p => !p.is_claimed)
            return (
              <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 mb-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-white font-bold text-sm uppercase tracking-widest" style={{ fontFamily: "'Fredoka One', cursive" }}>
                    🎓 Student Check-In
                  </p>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${unclaimed.length === 0 ? 'bg-kawaGreen/30 text-kawaGreen' : 'bg-kawaYellow/30 text-kawaYellow'}`}>
                    {claimed.length} / {preReg.length} joined
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
                  {preReg.map(p => {
                    const playerTeam = game.mode === 'teams' ? teams.find(t => t.id === p.team_id) : null
                    return (
                      <div key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm ${p.is_claimed ? 'bg-kawaGreen/20 border border-kawaGreen/40' : 'bg-white/5 border border-white/10'}`}>
                        <span className={`flex-shrink-0 ${p.is_claimed ? 'text-kawaGreen' : 'text-white/25'}`}>
                          {p.is_claimed ? '✓' : '○'}
                        </span>
                        <span className={`flex-1 font-bold truncate ${p.is_claimed ? 'text-white' : 'text-white/50'}`}>
                          {p.real_name || p.nickname}
                          {p.is_claimed && p.nickname !== (p.real_name || p.nickname) && (
                            <span className="text-white/40 font-normal"> → {p.nickname}</span>
                          )}
                        </span>
                        {playerTeam && (
                          <span
                            className="flex-shrink-0 w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: TEAM_COLOR_HEX[playerTeam.color] ?? playerTeam.color }}
                            title={playerTeam.name}
                          />
                        )}
                        {!p.is_claimed && (
                          <button
                            onClick={() => markAbsent(p.id)}
                            className="flex-shrink-0 text-white/25 hover:text-kawared text-xs font-bold transition-colors"
                            title="Mark absent"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                {unclaimed.length > 0 && (
                  <p className="text-white/40 text-xs mt-2 text-center">
                    Waiting for {unclaimed.length} student{unclaimed.length !== 1 ? 's' : ''} — click ✕ to mark absent
                  </p>
                )}
              </div>
            )
          })()}

          {/* Individual mode: player chips */}
          {game.mode === 'individual' && players.length > 0 && (
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 mb-5">
              <div className="flex flex-wrap gap-2 justify-center">
                {players.map(p => (
                  <span key={p.id} className="inline-flex items-center gap-1 bg-kawaPurple/40 border border-kawaPurple text-white text-sm font-bold pl-3 pr-1.5 py-1.5 rounded-full animate-bounce-in">
                    {p.nickname}
                    <button onClick={() => markAbsent(p.id)} className="text-white/40 hover:text-kawared transition-colors leading-none" title="Remove player">×</button>
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
                    <span key={p.id} className={`inline-flex items-center gap-1 text-sm font-bold rounded-full transition-all ${assigningPlayer === p.id ? 'bg-kawaYellow text-kawaDark scale-110 ring-2 ring-white pl-3 pr-1.5 py-1.5' : 'bg-kawaPurple/40 border border-kawaPurple text-white pl-3 pr-1.5 py-1.5'}`}>
                      <button onClick={() => setAssigningPlayer(assigningPlayer === p.id ? null : p.id)} className="font-bold">
                        {p.nickname}
                      </button>
                      <button onClick={() => markAbsent(p.id)} className="text-current opacity-40 hover:opacity-100 hover:text-kawared transition-all leading-none" title="Remove player">×</button>
                    </span>
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

          {(() => {
            const unclaimed = players.filter(p => p.is_pre_registered && !p.is_claimed)
            const unassigned = game.mode === 'teams' ? players.filter(p => !p.team_id) : []
            const blocked = unclaimed.length > 0 || unassigned.length > 0
            return (
              <button onClick={startGame} disabled={loading || players.length === 0 || blocked}
                className="w-full bg-kawaGreen hover:bg-green-400 disabled:opacity-50 text-white font-bold text-2xl py-5 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-xl"
                style={{ fontFamily: "'Fredoka One', cursive" }}>
                {loading ? 'Starting...'
                  : players.length === 0 ? 'Waiting for players...'
                  : unclaimed.length > 0 ? `⏳ Waiting for ${unclaimed.length} student${unclaimed.length !== 1 ? 's' : ''} to join...`
                  : unassigned.length > 0 ? `👥 ${unassigned.length} player${unassigned.length !== 1 ? 's' : ''} not assigned to a team`
                  : `Start Game (${players.length} players) 🚀`}
              </button>
            )
          })()}
        </div>
      )}

      {/* QUESTION PHASE */}
      {(game.status === 'question' || game.status === 'answer_reveal' || game.status === 'scores') && currentQuestion && (
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
                    ${(game.status === 'answer_reveal' || game.status === 'scores') && isCorrect ? 'ring-4 ring-white' : ''}
                    ${(game.status === 'answer_reveal' || game.status === 'scores') && !isCorrect ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{color.shape}</span>
                    <span className="font-bold truncate">
                      {currentQuestion[`option_${opt.toLowerCase()}` as 'option_a' | 'option_b' | 'option_c' | 'option_d']}
                    </span>
                    {(game.status === 'answer_reveal' || game.status === 'scores') && isCorrect && <span className="ml-auto text-xl">✓</span>}
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

          {game.status === 'scores' && game.mode === 'teams' && teamScores.length > 0 && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4 mb-4">
              <h3 className="text-white font-bold mb-3 text-center" style={{ fontFamily: "'Fredoka One', cursive" }}>Team Scores</h3>
              <div className="space-y-2">
                {teamScores.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-3">
                    <span className="text-2xl">{['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] ?? `${i + 1}`}</span>
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: TEAM_COLOR_HEX[t.color] ?? t.color }} />
                    <span className="flex-1 text-white font-semibold">{t.name}</span>
                    <span className="text-kawaYellow font-bold">{t.score.toLocaleString()} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {game.status === 'scores' && game.mode !== 'teams' && leaderboard.length > 0 && (
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
              <button onClick={showScores} disabled={loading}
                className="flex-1 bg-kawaPurple hover:bg-purple-600 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                style={{ fontFamily: "'Fredoka One', cursive" }}>
                {loading ? '...' : 'Show Scores →'}
              </button>
            )}
            {game.status === 'scores' && (
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
                  <button onClick={restartGame} disabled={restarting}
                    className="bg-kawaGreen hover:bg-green-400 border border-white/20 disabled:opacity-50 text-white font-bold text-xl py-4 px-5 rounded-2xl transition-all hover:scale-105 active:scale-95"
                    title="Restart from question 1"
                    style={{ fontFamily: "'Fredoka One', cursive" }}>
                    {restarting ? '...' : '↺'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={endGame} disabled={loading}
                    className="flex-1 bg-kawaYellow hover:bg-yellow-400 disabled:opacity-50 text-kawaDark font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                    style={{ fontFamily: "'Fredoka One', cursive" }}>
                    {loading ? '...' : '🏆 End Game & Final Scores'}
                  </button>
                  <button onClick={restartGame} disabled={restarting}
                    className="bg-kawaGreen hover:bg-green-400 border border-white/20 disabled:opacity-50 text-white font-bold text-xl py-4 px-5 rounded-2xl transition-all hover:scale-105 active:scale-95"
                    title="Restart from question 1"
                    style={{ fontFamily: "'Fredoka One', cursive" }}>
                    {restarting ? '...' : '↺'}
                  </button>
                </>
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
                  <span key={p.id} className="inline-flex items-center gap-1 bg-kawaPurple/40 border border-kawaPurple text-white text-sm font-bold pl-3 pr-1.5 py-1.5 rounded-full">
                    {p.nickname}
                    <button onClick={() => markAbsent(p.id)} className="text-white/40 hover:text-kawared transition-colors leading-none" title="Remove player">×</button>
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
                    <span key={p.id} className={`inline-flex items-center gap-1 text-sm font-bold rounded-full transition-all ${assigningPlayer === p.id ? 'bg-kawaYellow text-kawaDark scale-110 ring-2 ring-white pl-3 pr-1.5 py-1.5' : 'bg-kawaPurple/40 border border-kawaPurple text-white pl-3 pr-1.5 py-1.5'}`}>
                      <button onClick={() => setAssigningPlayer(assigningPlayer === p.id ? null : p.id)} className="font-bold">
                        {p.nickname}
                      </button>
                      <button onClick={() => markAbsent(p.id)} className="text-current opacity-40 hover:opacity-100 hover:text-kawared transition-all leading-none" title="Remove player">×</button>
                    </span>
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
          <div className="flex gap-3 mb-3">
            <button
              onClick={() => setShowRestartPicker(p => !p)}
              disabled={restarting || replaying}
              className={`flex-1 font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg disabled:opacity-60 ${showRestartPicker ? 'bg-kawaGreen text-white ring-2 ring-white' : 'bg-kawaGreen hover:bg-green-400 text-white'}`}
              style={{ fontFamily: "'Fredoka One', cursive" }}
            >
              {restarting ? 'Restarting...' : '↺ Play Again'}
            </button>
            <a href="/host"
              className="flex-1 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 text-center"
              style={{ fontFamily: "'Fredoka One', cursive" }}>
              🎮 New Quiz
            </a>
          </div>

          {/* Game picker panel */}
          {showRestartPicker && (
            <div className="bg-white/10 border border-white/20 rounded-2xl overflow-hidden mb-3">
              <p className="text-white/50 text-xs font-bold uppercase tracking-widest px-4 pt-3 pb-2">Choose a quiz to play</p>

              {/* Current game — restart */}
              <button
                onClick={() => { setShowRestartPicker(false); restartGame() }}
                disabled={restarting}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left border-b border-white/10"
              >
                <span className="text-xl">↺</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold truncate">{game.title}</p>
                  <p className="text-white/40 text-xs">Restart this quiz (same players, reset scores)</p>
                </div>
                <span className="text-kawaGreen text-xs font-bold uppercase tracking-wider">Current</span>
              </button>

              {/* Other saved games */}
              {savedGames.filter(g => g.id !== id).map(g => (
                <button
                  key={g.id}
                  onClick={() => { setShowRestartPicker(false); replayGame(g.id) }}
                  disabled={replaying}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/10 transition-colors text-left border-b border-white/10 last:border-b-0"
                >
                  <span className="text-xl">🎮</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-bold truncate">{g.title}</p>
                    <p className="text-white/40 text-xs">PIN {g.pin} · Fresh start, new players join</p>
                  </div>
                  <span className="text-kawaYellow text-xs font-bold">{replaying ? '...' : 'Play →'}</span>
                </button>
              ))}

              {savedGames.filter(g => g.id !== id).length === 0 && (
                <p className="px-4 py-3 text-white/30 text-sm italic">No other saved quizzes</p>
              )}
            </div>
          )}
        </div>
        )
      })()}
      {/* Floating teacher tools — always visible, bottom-left */}
      <div className="fixed bottom-5 left-5 z-50">
        {/* Music panel */}
        {showMusicPanel && (
          <div className="mb-3 bg-kawaDark/95 backdrop-blur border border-white/20 rounded-2xl p-4 shadow-2xl w-72">
            <p className="text-white/50 text-xs font-bold uppercase tracking-widest mb-3">🎵 Music Player</p>

            {/* File picker */}
            <input ref={musicFileRef} type="file" accept="audio/*" className="hidden" onChange={handleMusicFile} />
            <button
              onClick={() => musicFileRef.current?.click()}
              className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-bold py-2 px-3 rounded-xl mb-3 transition-all truncate text-left"
            >
              {musicTrackName || '📂 Choose music file...'}
            </button>

            {/* Controls */}
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={togglePlayPause}
                disabled={!musicTrackName}
                className="w-10 h-10 rounded-xl bg-kawaYellow hover:bg-yellow-400 disabled:opacity-30 text-kawaDark font-bold text-lg transition-all flex items-center justify-center"
              >
                {musicPlaying ? '⏸' : '▶'}
              </button>
              <button
                onClick={toggleLoop}
                className={`w-10 h-10 rounded-xl font-bold text-sm transition-all border ${musicLoop ? 'bg-kawaPurple border-kawaPurple text-white' : 'bg-white/10 border-white/20 text-white/50'}`}
                title="Loop"
              >
                🔁
              </button>
              <div className="flex-1 flex items-center gap-2">
                <span className="text-white/30 text-xs">🔈</span>
                <input
                  type="range" min={0} max={1} step={0.05} value={musicVolume}
                  onChange={e => handleVolumeChange(Number(e.target.value))}
                  className="flex-1 accent-kawaYellow"
                />
                <span className="text-white/30 text-xs">🔊</span>
              </div>
            </div>

            {musicTrackName && (
              <p className="text-white/40 text-xs truncate">{musicPlaying ? '▶ Playing:' : '⏸ Paused:'} {musicTrackName}</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => setShowTeacherPanel(p => !p)}
            className={`w-12 h-12 rounded-2xl font-bold text-xl shadow-lg transition-all hover:scale-110 active:scale-95 border ${showTeacherPanel ? 'bg-kawaYellow text-kawaDark border-kawaYellow' : 'bg-kawaDark/80 backdrop-blur border-white/20 text-white hover:bg-white/20'}`}
            title="Teacher data panel"
          >
            📋
          </button>
          <button
            onClick={openDisplay}
            className="w-12 h-12 rounded-2xl font-bold text-xl shadow-lg transition-all hover:scale-110 active:scale-95 bg-kawaDark/80 backdrop-blur border border-white/20 text-white hover:bg-white/20"
            title="Open display for projector"
          >
            📺
          </button>
          <button
            onClick={() => setShowMusicPanel(p => !p)}
            className={`w-12 h-12 rounded-2xl font-bold text-xl shadow-lg transition-all hover:scale-110 active:scale-95 border ${showMusicPanel ? 'bg-kawaPurple border-kawaPurple text-white' : 'bg-kawaDark/80 backdrop-blur border-white/20 text-white hover:bg-white/20'} ${musicPlaying ? 'animate-pulse' : ''}`}
            title="Music player"
          >
            🎵
          </button>
        </div>
      </div>
    </div>
    </HostGate>
  )
}
