'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Game, Player, QuizQuestion, LeaderboardEntry } from '@/types'

const ANSWER_COLORS = {
  A: { bg: 'bg-kawared', text: 'text-white', shape: '▲' },
  B: { bg: 'bg-kawaBlue', text: 'text-white', shape: '◆' },
  C: { bg: 'bg-kawaYellow', text: 'text-kawaDark', shape: '●' },
  D: { bg: 'bg-kawaGreen', text: 'text-white', shape: '■' },
}

export default function GameHostPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [game, setGame] = useState<Game | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [answerCounts, setAnswerCounts] = useState({ A: 0, B: 0, C: 0, D: 0 })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: gameData } = await supabase
        .from('games')
        .select('*')
        .eq('id', id)
        .single()
      if (!gameData) { router.push('/host'); return }
      setGame(gameData)

      const { data: qData } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('game_id', id)
        .order('order_index')
      setQuestions(qData || [])

      if (gameData.current_question_index >= 0 && qData) {
        setCurrentQuestion(qData[gameData.current_question_index] || null)
      }
    }
    load()
  }, [id, router, supabase])

  // Real-time: players joining — re-fetch full list on any change to the players table
  useEffect(() => {
    function refetchPlayers() {
      supabase.from('players').select('*').eq('game_id', id).order('score', { ascending: false })
        .then(({ data }) => setPlayers(data || []))
    }

    // Initial load
    refetchPlayers()

    // Polling fallback every 3s ensures the lobby stays live even if realtime
    // isn't configured yet (REPLICA IDENTITY FULL not set in Supabase)
    const poll = setInterval(refetchPlayers, 3000)

    // Realtime subscription (works once REPLICA IDENTITY FULL is set)
    const sub = supabase
      .channel(`game-${id}-players`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' },
        (payload) => {
          // Filter client-side so we only react to this game's players
          const row = (payload.new || payload.old) as { game_id?: string } | null
          if (!row || row.game_id !== id) return
          refetchPlayers()
        }
      )
      .subscribe()

    return () => {
      clearInterval(poll)
      supabase.removeChannel(sub)
    }
  }, [id, supabase])

  // Real-time: game state changes
  useEffect(() => {
    const sub = supabase
      .channel(`game-${id}-state`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` },
        ({ new: updated }) => setGame(updated as Game)
      )
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [id, supabase])

  // Countdown timer
  useEffect(() => {
    if (!game || game.status !== 'question' || !currentQuestion || !game.current_question_started_at) return
    const tick = setInterval(() => {
      const elapsed = (Date.now() - new Date(game.current_question_started_at!).getTime()) / 1000
      const left = Math.max(0, currentQuestion.time_limit - elapsed)
      setTimeLeft(Math.ceil(left))
      if (left <= 0) clearInterval(tick)
    }, 200)
    return () => clearInterval(tick)
  }, [game, currentQuestion])

  // Answer counts
  useEffect(() => {
    if (!currentQuestion || game?.status !== 'question') return
    const sub = supabase
      .channel(`answers-${currentQuestion.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers', filter: `question_id=eq.${currentQuestion.id}` },
        async () => {
          const { data } = await supabase
            .from('answers')
            .select('selected_answer')
            .eq('question_id', currentQuestion.id)
          const counts = { A: 0, B: 0, C: 0, D: 0 }
          data?.forEach(a => { counts[a.selected_answer as keyof typeof counts]++ })
          setAnswerCounts(counts)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [currentQuestion, game?.status, supabase])

  const startGame = useCallback(async () => {
    setLoading(true)
    await fetch(`/api/game/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: id }) })
    setLoading(false)
  }, [id])

  const nextQuestion = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/game/next-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    const data = await res.json()
    setLoading(false)
    if (data.question) setCurrentQuestion(data.question)
  }, [id])

  const revealAnswer = useCallback(async () => {
    setLoading(true)
    await fetch('/api/game/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    const { data } = await supabase
      .from('players')
      .select('*')
      .eq('game_id', id)
      .order('score', { ascending: false })
      .limit(10)
    setLeaderboard((data || []).map((p, i) => ({ player_id: p.id, nickname: p.nickname, score: p.score, rank: i + 1 })))
    setLoading(false)
  }, [id, supabase])

  const endGame = useCallback(async () => {
    setLoading(true)
    await fetch('/api/game/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: id }),
    })
    setLoading(false)
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white font-bold text-xl md:text-2xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
            {game.title}
          </h1>
          <p className="text-purple-300 text-sm">Host View</p>
        </div>
        <div className="text-center bg-white/10 border border-white/20 rounded-2xl px-6 py-3">
          <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">Game PIN</p>
          <p className="text-kawaYellow font-bold text-3xl tracking-widest" style={{ fontFamily: "'Fredoka One', cursive" }}>
            {game.pin}
          </p>
        </div>
      </div>

      {/* WAITING LOBBY */}
      {game.status === 'waiting' && (
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-3xl p-8 mb-6">
            <p className="text-white/60 mb-2">Students join at</p>
            <p className="text-kawaYellow font-bold text-lg">kawahoot.vercel.app</p>
            <div className="my-6 flex justify-center">
              <div className="bg-kawaDark border-4 border-kawaYellow rounded-2xl px-8 py-4 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-kawaYellow text-kawaDark text-xs font-bold px-3 py-1 rounded-full">
                  GAME PIN
                </div>
                <p className="text-white font-bold text-6xl tracking-[0.2em]" style={{ fontFamily: "'Fredoka One', cursive" }}>
                  {game.pin}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-center gap-3">
              <div className="w-3 h-3 rounded-full bg-kawaGreen animate-pulse" />
              <p className="text-white font-semibold">{players.length} player{players.length !== 1 ? 's' : ''} waiting</p>
            </div>
          </div>

          {/* Player list */}
          {players.length > 0 && (
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-4 mb-6">
              <div className="flex flex-wrap gap-2 justify-center">
                {players.map(p => (
                  <span key={p.id} className="bg-kawaPurple/40 border border-kawaPurple text-white text-sm font-bold px-3 py-1.5 rounded-full animate-bounce-in">
                    {p.nickname}
                  </span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={startGame}
            disabled={loading || players.length === 0}
            className="w-full bg-kawaGreen hover:bg-green-400 disabled:opacity-50 text-white font-bold text-2xl py-5 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-xl"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          >
            {loading ? 'Starting...' : players.length === 0 ? 'Waiting for players...' : `Start Game (${players.length} players) 🚀`}
          </button>
        </div>
      )}

      {/* QUESTION PHASE */}
      {(game.status === 'question' || game.status === 'answer_reveal') && currentQuestion && (
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4 text-sm text-white/50">
            <span>Question {game.current_question_index + 1} / {questions.length}</span>
            <span>{players.length} players</span>
          </div>

          {/* Question card */}
          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-6 mb-4 text-center">
            <p className="text-white font-bold text-2xl md:text-3xl">{currentQuestion.question_text}</p>
          </div>

          {/* Timer bar */}
          {game.status === 'question' && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-white/60 mb-1">
                <span>Time left</span>
                <span className={`font-bold text-lg ${timeLeft <= 5 ? 'text-kawared' : 'text-kawaYellow'}`}>{timeLeft}s</span>
              </div>
              <div className="h-4 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-kawaYellow to-kawaCoral rounded-full transition-all duration-200"
                  style={{ width: `${(timeLeft / currentQuestion.time_limit) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Answer options with counts */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {(['A','B','C','D'] as const).map(opt => {
              const color = ANSWER_COLORS[opt]
              const count = answerCounts[opt]
              const pct = totalAnswers > 0 ? (count / totalAnswers) * 100 : 0
              const isCorrect = currentQuestion.correct_answer === opt
              return (
                <div
                  key={opt}
                  className={`${color.bg} ${color.text} rounded-xl p-3 relative overflow-hidden ${game.status === 'answer_reveal' && isCorrect ? 'ring-4 ring-white' : ''} ${game.status === 'answer_reveal' && !isCorrect ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xl">{color.shape}</span>
                    <span className="font-bold truncate">{currentQuestion[`option_${opt.toLowerCase()}` as 'option_a'|'option_b'|'option_c'|'option_d']}</span>
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

          <div className="text-center text-white/50 text-sm mb-4">
            {totalAnswers} / {players.length} answered
          </div>

          {/* Leaderboard preview */}
          {game.status === 'answer_reveal' && leaderboard.length > 0 && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4 mb-4">
              <h3 className="text-white font-bold mb-3 text-center" style={{ fontFamily: "'Fredoka One', cursive" }}>Top Players</h3>
              <div className="space-y-2">
                {leaderboard.slice(0, 5).map((entry, i) => (
                  <div key={entry.player_id} className="flex items-center gap-3">
                    <span className="text-2xl">{['🥇','🥈','🥉','4️⃣','5️⃣'][i]}</span>
                    <span className="flex-1 text-white font-semibold">{entry.nickname}</span>
                    <span className="text-kawaYellow font-bold">{entry.score.toLocaleString()} pts</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-3">
            {game.status === 'question' && (
              <button
                onClick={revealAnswer}
                disabled={loading}
                className="flex-1 bg-kawaCoral hover:bg-orange-500 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                {loading ? '...' : 'Reveal Answer →'}
              </button>
            )}
            {game.status === 'answer_reveal' && (
              <>
                {!isLast ? (
                  <button
                    onClick={nextQuestion}
                    disabled={loading}
                    className="flex-1 bg-kawaPurple hover:bg-purple-600 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                    style={{ fontFamily: "'Fredoka One', cursive" }}
                  >
                    {loading ? '...' : 'Next Question →'}
                  </button>
                ) : (
                  <button
                    onClick={endGame}
                    disabled={loading}
                    className="flex-1 bg-kawaYellow hover:bg-yellow-400 disabled:opacity-50 text-kawaDark font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
                    style={{ fontFamily: "'Fredoka One', cursive" }}
                  >
                    {loading ? '...' : '🏆 End Game & Final Scores'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* FINISHED */}
      {game.status === 'finished' && (
        <div className="max-w-lg mx-auto text-center">
          <div className="text-6xl mb-4 animate-bounce-in">🏆</div>
          <h2 className="text-white font-bold text-4xl mb-2" style={{ fontFamily: "'Fredoka One', cursive" }}>
            Game Over!
          </h2>
          <p className="text-purple-300 mb-6">Final Leaderboard</p>
          <div className="bg-white/10 border border-white/20 rounded-2xl p-6 space-y-3">
            {players.slice(0, 10).map((p, i) => (
              <div key={p.id} className={`flex items-center gap-3 p-3 rounded-xl ${i === 0 ? 'bg-kawaYellow/20 border border-kawaYellow/40' : 'bg-white/5'}`}>
                <span className="text-2xl w-8">{['🥇','🥈','🥉'][i] || `${i+1}.`}</span>
                <span className="flex-1 text-white font-bold text-left">{p.nickname}</span>
                <span className="text-kawaYellow font-bold">{p.score.toLocaleString()} pts</span>
              </div>
            ))}
          </div>
          <a
            href="/host"
            className="mt-6 inline-block bg-kawaPurple hover:bg-purple-600 text-white font-bold text-xl px-8 py-4 rounded-2xl transition-all hover:scale-105"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          >
            🎮 Play Again
          </a>
        </div>
      )}
    </div>
  )
}
