'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Game, QuizQuestion, Player } from '@/types'

const ANSWER_CONFIG = {
  A: { bg: 'bg-kawared hover:bg-red-500', shape: '▲', label: 'A' },
  B: { bg: 'bg-kawaBlue hover:bg-blue-600', shape: '◆', label: 'B' },
  C: { bg: 'bg-kawaYellow hover:bg-yellow-400 text-kawaDark', shape: '●', label: 'C' },
  D: { bg: 'bg-kawaGreen hover:bg-green-400', shape: '■', label: 'D' },
} as const

type AnswerKey = 'A' | 'B' | 'C' | 'D'

export default function PlayPage() {
  const { gameId } = useParams<{ gameId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const playerId = searchParams.get('playerId')
  const supabase = createClient()

  const [game, setGame] = useState<Game | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState<AnswerKey | null>(null)
  const [answerResult, setAnswerResult] = useState<{ correct: boolean; points: number } | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [leaderboard, setLeaderboard] = useState<Player[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const joinedAt = useRef<number>(Date.now())

  useEffect(() => {
    if (!playerId) { router.push('/'); return }
    supabase.from('players').select('*').eq('id', playerId).single()
      .then(({ data }) => setPlayer(data))
  }, [playerId, router, supabase])

  // Load game state
  useEffect(() => {
    supabase.from('games').select('*').eq('id', gameId).single()
      .then(({ data }) => {
        if (!data) { router.push('/'); return }
        setGame(data)
      })
  }, [gameId, router, supabase])

  // Real-time game updates
  useEffect(() => {
    const sub = supabase
      .channel(`play-${gameId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}`,
      }, async ({ new: updated }) => {
        const g = updated as Game
        setGame(g)

        if (g.status === 'question') {
          // Load the current question
          const { data: questions } = await supabase
            .from('quiz_questions')
            .select('*')
            .eq('game_id', gameId)
            .order('order_index')
          const q = questions?.[g.current_question_index]
          if (q) {
            setCurrentQuestion(q)
            setSelectedAnswer(null)
            setAnswerResult(null)
            joinedAt.current = Date.now()
          }
        }

        if (g.status === 'answer_reveal') {
          // Load leaderboard
          const { data: players } = await supabase
            .from('players').select('*').eq('game_id', gameId).order('score', { ascending: false })
          setLeaderboard(players || [])
          const rank = (players || []).findIndex(p => p.id === playerId) + 1
          setMyRank(rank || null)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [gameId, playerId, supabase])

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

  const submitAnswer = useCallback(async (answer: AnswerKey) => {
    if (selectedAnswer || !currentQuestion || !playerId) return
    setSelectedAnswer(answer)
    const responseTime = Date.now() - new Date(game!.current_question_started_at!).getTime()
    const res = await fetch('/api/game/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId,
        playerId,
        questionId: currentQuestion.id,
        selectedAnswer: answer,
        responseTimeMs: responseTime,
      }),
    })
    const data = await res.json()
    setAnswerResult({ correct: data.isCorrect, points: data.pointsEarned })
    if (player) setPlayer(prev => prev ? { ...prev, score: prev.score + data.pointsEarned } : prev)
  }, [selectedAnswer, currentQuestion, playerId, game, gameId, player])

  if (!game || !player) {
    return (
      <div className="min-h-screen bg-kawaDark flex items-center justify-center">
        <div className="text-white text-xl animate-pulse">Loading...</div>
      </div>
    )
  }

  // WAITING
  if (game.status === 'waiting') {
    return (
      <div className="min-h-screen bg-kawaDark flex flex-col items-center justify-center px-4 text-center">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-96 h-96 bg-kawaPurple/20 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-[-20%] right-[-10%] w-80 h-80 bg-kawaCoral/15 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
        </div>
        <div className="relative z-10">
          <div className="text-8xl mb-4 animate-bounce">🎮</div>
          <h1 className="text-4xl text-white font-bold mb-2" style={{ fontFamily: "'Fredoka One', cursive" }}>
            You&apos;re In!
          </h1>
          <p className="text-purple-300 text-lg mb-6">Waiting for the teacher to start...</p>
          <div className="bg-white/10 border border-white/20 rounded-2xl px-8 py-5 inline-block">
            <p className="text-white/60 text-sm mb-1">Playing as</p>
            <p className="text-kawaYellow font-bold text-3xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
              {player.nickname}
            </p>
          </div>
          <div className="mt-8 flex justify-center">
            <div className="flex gap-1">
              {[0,1,2].map(i => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-full bg-kawaPurple animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // QUESTION
  if (game.status === 'question' && currentQuestion) {
    const progress = (timeLeft / currentQuestion.time_limit) * 100
    return (
      <div className="min-h-screen bg-kawaDark flex flex-col">
        {/* Timer bar */}
        <div className="h-3 bg-white/10">
          <div
            className={`h-full transition-all duration-200 ${timeLeft <= 5 ? 'bg-kawared' : 'bg-kawaYellow'}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex-1 flex flex-col p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <span className="text-white/50 text-sm font-semibold">{player.nickname}</span>
            <span className={`font-bold text-2xl ${timeLeft <= 5 ? 'text-kawared animate-pulse' : 'text-kawaYellow'}`} style={{ fontFamily: "'Fredoka One', cursive" }}>
              {timeLeft}s
            </span>
            <span className="text-white/50 text-sm font-semibold">{player.score.toLocaleString()} pts</span>
          </div>

          {/* Question */}
          <div className="bg-white text-kawaDark rounded-2xl p-5 mb-6 text-center flex-shrink-0 shadow-xl">
            <p className="font-bold text-xl md:text-2xl leading-tight">{currentQuestion.question_text}</p>
          </div>

          {/* Answer buttons */}
          {!selectedAnswer ? (
            <div className="grid grid-cols-2 gap-3 flex-1">
              {(['A','B','C','D'] as AnswerKey[]).map(opt => {
                const cfg = ANSWER_CONFIG[opt]
                return (
                  <button
                    key={opt}
                    onClick={() => submitAnswer(opt)}
                    className={`${cfg.bg} text-white font-bold rounded-2xl flex flex-col items-center justify-center gap-2 p-4 min-h-[120px] transition-all hover:scale-105 active:scale-95 shadow-lg`}
                  >
                    <span className="text-3xl">{cfg.shape}</span>
                    <span className="text-sm text-center leading-tight">
                      {currentQuestion[`option_${opt.toLowerCase()}` as 'option_a'|'option_b'|'option_c'|'option_d']}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              {answerResult ? (
                <div className="animate-bounce-in">
                  <div className="text-7xl mb-4">{answerResult.correct ? '✅' : '❌'}</div>
                  <p className="text-white font-bold text-3xl mb-2" style={{ fontFamily: "'Fredoka One', cursive" }}>
                    {answerResult.correct ? 'Correct!' : 'Oops!'}
                  </p>
                  {answerResult.correct && (
                    <p className="text-kawaYellow font-bold text-2xl animate-score-pop">
                      +{answerResult.points} pts
                    </p>
                  )}
                  <p className="text-white/50 mt-4">Waiting for reveal...</p>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-5xl mb-4 animate-bounce">⏳</div>
                  <p className="text-white font-bold text-xl">Answer locked in: <span className="text-kawaYellow">{selectedAnswer}</span></p>
                  <p className="text-white/50 mt-2">Waiting for results...</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ANSWER REVEAL / LEADERBOARD
  if (game.status === 'answer_reveal') {
    return (
      <div className="min-h-screen bg-kawaDark flex flex-col items-center justify-center px-4 text-center">
        <div className="w-full max-w-sm">
          {/* Result */}
          {answerResult ? (
            <div className="mb-6 animate-bounce-in">
              <div className="text-6xl mb-3">{answerResult.correct ? '🎉' : '😬'}</div>
              <p className="text-white font-bold text-3xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
                {answerResult.correct ? 'Correct!' : 'Not quite!'}
              </p>
              {answerResult.correct && (
                <p className="text-kawaYellow font-bold text-xl">+{answerResult.points} points</p>
              )}
            </div>
          ) : (
            <div className="mb-6">
              <p className="text-white/50 text-lg">Time&apos;s up!</p>
            </div>
          )}

          {/* My rank */}
          {myRank && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4 mb-4">
              <p className="text-white/50 text-sm mb-1">Your Rank</p>
              <p className="text-kawaYellow font-bold text-4xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
                #{myRank}
              </p>
              <p className="text-white font-semibold">{player.score.toLocaleString()} pts total</p>
            </div>
          )}

          {/* Mini leaderboard */}
          {leaderboard.length > 0 && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4">
              <h3 className="text-white font-bold mb-3 text-sm uppercase tracking-widest">Leaderboard</h3>
              <div className="space-y-2">
                {leaderboard.slice(0, 5).map((p, i) => (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 p-2 rounded-xl ${p.id === playerId ? 'bg-kawaPurple/30 border border-kawaPurple' : ''}`}
                  >
                    <span className="text-lg w-6">{['🥇','🥈','🥉','4','5'][i]}</span>
                    <span className={`flex-1 text-left text-sm font-semibold ${p.id === playerId ? 'text-kawaYellow' : 'text-white'}`}>
                      {p.nickname}
                    </span>
                    <span className="text-white/70 text-sm font-bold">{p.score.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-white/30 text-sm mt-4 animate-pulse">Waiting for next question...</p>
        </div>
      </div>
    )
  }

  // FINISHED
  if (game.status === 'finished') {
    return (
      <div className="min-h-screen bg-kawaDark flex flex-col items-center justify-center px-4 text-center">
        <div className="text-6xl mb-4 animate-bounce-in">🏆</div>
        <h1 className="text-white font-bold text-4xl mb-2" style={{ fontFamily: "'Fredoka One', cursive" }}>
          Game Over!
        </h1>
        <p className="text-purple-300 mb-6">Thanks for playing, {player.nickname}!</p>
        <div className="bg-white/10 border border-white/20 rounded-2xl p-6 mb-6 w-full max-w-sm">
          <p className="text-white/50 text-sm mb-1">Your Final Score</p>
          <p className="text-kawaYellow font-bold text-5xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
            {player.score.toLocaleString()}
          </p>
          {myRank && <p className="text-white/60 mt-1">Rank #{myRank}</p>}
        </div>
        <a
          href="/"
          className="bg-kawaPurple hover:bg-purple-600 text-white font-bold text-xl px-8 py-4 rounded-2xl transition-all hover:scale-105"
          style={{ fontFamily: "'Fredoka One', cursive" }}
        >
          Play Again →
        </a>
      </div>
    )
  }

  return null
}
