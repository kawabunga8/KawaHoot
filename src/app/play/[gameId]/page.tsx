'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Game, QuizQuestion, Player, Team } from '@/types'

const ANSWER_CONFIG = {
  A: { bg: 'bg-kawared hover:bg-red-500', shape: '▲' },
  B: { bg: 'bg-kawaBlue hover:bg-blue-600', shape: '◆' },
  C: { bg: 'bg-kawaYellow hover:bg-yellow-400 text-kawaDark', shape: '●' },
  D: { bg: 'bg-kawaGreen hover:bg-green-400', shape: '■' },
} as const

type AnswerKey = 'A' | 'B' | 'C' | 'D'

export default function PlayPage() {
  const { gameId } = useParams<{ gameId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const playerId = searchParams.get('playerId')

  // Stable client — never recreated
  const supabase = useMemo(() => createClient(), [])

  const [game, setGame] = useState<Game | null>(null)
  const [player, setPlayer] = useState<Player | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null)
  const [selectedAnswer, setSelectedAnswer] = useState<AnswerKey | null>(null)
  const [answerResult, setAnswerResult] = useState<{ correct: boolean; points: number; selected: AnswerKey; correctAnswer: AnswerKey } | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [leaderboard, setLeaderboard] = useState<Player[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const [followingReplay, setFollowingReplay] = useState(false)
  const [myTeam, setMyTeam] = useState<Team | null>(null)

  // Keep current game/question in refs so async callbacks always see the latest value
  const gameRef = useRef<Game | null>(null)
  gameRef.current = game
  const currentQuestionRef = useRef<QuizQuestion | null>(null)
  currentQuestionRef.current = currentQuestion

  // Load player + team once; re-check team whenever player's team_id might change
  useEffect(() => {
    if (!playerId) { router.push('/'); return }
    supabase.from('players').select('*').eq('id', playerId).single()
      .then(async ({ data }) => {
        if (!data) return
        setPlayer(data)
        if (data.team_id) {
          const { data: teamData } = await supabase.from('teams').select('*').eq('id', data.team_id).single()
          if (teamData) setMyTeam(teamData)
        }
      })
    // Poll for team assignment (host may assign after player joins)
    const poll = setInterval(async () => {
      const { data } = await supabase.from('players').select('team_id').eq('id', playerId).single()
      if (!data) return
      if (data.team_id) {
        const { data: teamData } = await supabase.from('teams').select('*').eq('id', data.team_id).single()
        setMyTeam(teamData ?? null)
      } else {
        setMyTeam(null)
      }
    }, 3000)
    return () => clearInterval(poll)
  }, [playerId, router, supabase])

  // Handle a game state update
  const handleGameUpdate = useCallback(async (g: Game) => {
    setGame(g)

    if (g.status === 'waiting') {
      // Game was restarted — reset local state
      setSelectedAnswer(null)
      setAnswerResult(null)
      setCurrentQuestion(null)
      setLeaderboard([])
      setMyRank(null)
      setPlayer(prev => prev ? { ...prev, score: 0 } : prev)
    }

    if (g.status === 'question') {
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
      }
    }

    if (g.status === 'answer_reveal') {
      // Fetch leaderboard
      const { data: players } = await supabase
        .from('players').select('*').eq('game_id', gameId).order('score', { ascending: false })
      setLeaderboard(players || [])
      const rank = (players || []).findIndex(p => p.id === playerId) + 1
      setMyRank(rank > 0 ? rank : null)

      // Now reveal this player's answer result and update their score
      if (playerId && currentQuestionRef.current) {
        const { data: answer } = await supabase
          .from('answers')
          .select('is_correct, points_earned, selected_answer')
          .eq('player_id', playerId)
          .eq('question_id', currentQuestionRef.current.id)
          .single()
        if (answer) {
          setAnswerResult({
            correct: answer.is_correct,
            points: answer.points_earned,
            selected: answer.selected_answer as AnswerKey,
            correctAnswer: currentQuestionRef.current.correct_answer as AnswerKey,
          })
          // Update displayed score from the authoritative DB value
          const me = (players || []).find(p => p.id === playerId)
          if (me) setPlayer(prev => prev ? { ...prev, score: me.score } : prev)
        }
      }
    }
  }, [gameId, playerId, supabase])

  // Initial load + polling fallback every 2s
  useEffect(() => {
    async function fetchGame() {
      const { data } = await supabase.from('games').select('*').eq('id', gameId).single()
      if (!data) { router.push('/'); return }
      // Only trigger a full update if something actually changed
      const prev = gameRef.current
      if (!prev || prev.status !== data.status || prev.current_question_index !== data.current_question_index) {
        handleGameUpdate(data)
      } else {
        setGame(data)
      }
    }

    fetchGame()
    const poll = setInterval(fetchGame, 2000)

    // Realtime subscription — no server-side filter (client-side filter below)
    const sub = supabase
      .channel(`play-game-${gameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' },
        ({ new: updated }) => {
          const g = updated as Game
          if (g.id !== gameId) return
          const prev = gameRef.current
          if (!prev || prev.status !== g.status || prev.current_question_index !== g.current_question_index) {
            handleGameUpdate(g)
          } else {
            setGame(g)
          }
        }
      )
      .subscribe()

    return () => {
      clearInterval(poll)
      supabase.removeChannel(sub)
    }
  }, [gameId, router, supabase, handleGameUpdate])

  // Poll for replay: when teacher hits Play Again, next_game_id gets set on this game.
  // Find the player's new ID in the new game and redirect them automatically.
  useEffect(() => {
    if (game?.status !== 'finished' || !playerId) return
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from('games').select('next_game_id').eq('id', gameId).single()
      if (!data?.next_game_id) return
      // Find this player in the new game by matching nickname
      const { data: playerData } = await supabase
        .from('players').select('id').eq('game_id', data.next_game_id).eq('nickname', player?.nickname || '').single()
      if (playerData) {
        clearInterval(poll)
        setFollowingReplay(true)
        router.push(`/play/${data.next_game_id}?playerId=${playerData.id}`)
      }
    }, 2000)
    return () => clearInterval(poll)
  }, [game?.status, gameId, playerId, player?.nickname, supabase, router])

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

  const submitAnswer = useCallback(async (answer: AnswerKey) => {
    const g = gameRef.current
    if (selectedAnswer || !currentQuestion || !playerId || !g?.current_question_started_at) return
    setSelectedAnswer(answer)
    const responseTime = Date.now() - new Date(g.current_question_started_at).getTime()
    // Fire and forget — result is revealed only when teacher presses Reveal Answer
    fetch('/api/game/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId, playerId,
        questionId: currentQuestion.id,
        selectedAnswer: answer,
        responseTimeMs: responseTime,
      }),
    })
  }, [selectedAnswer, currentQuestion, playerId, gameId])

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
            {myTeam && (
              <p className="text-white/70 font-semibold mt-2 text-sm">
                👥 {myTeam.name}
              </p>
            )}
          </div>
          <div className="mt-8 flex justify-center gap-1">
            {[0, 1, 2].map(i => (
              <div key={i} className="w-3 h-3 rounded-full bg-kawaPurple animate-bounce"
                style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
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
        <div className="h-3 bg-white/10">
          <div
            className={`h-full transition-all duration-200 ${timeLeft <= 5 ? 'bg-kawared' : 'bg-kawaYellow'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex-1 flex flex-col p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-white/50 text-sm font-semibold">{player.nickname}</span>
              {myTeam && <p className="text-white/40 text-xs">👥 {myTeam.name}</p>}
            </div>
            <span className={`font-bold text-2xl ${timeLeft <= 5 ? 'text-kawared animate-pulse' : 'text-kawaYellow'}`}
              style={{ fontFamily: "'Fredoka One', cursive" }}>
              {timeLeft}s
            </span>
            <span className="text-white/50 text-sm font-semibold">{player.score.toLocaleString()} pts</span>
          </div>

          {/* Question only shown after answering — keeps focus on the buttons */}
          {selectedAnswer && (
            <div className="bg-white text-kawaDark rounded-2xl p-5 mb-6 text-center flex-shrink-0 shadow-xl animate-slide-up">
              <p className="font-bold text-xl md:text-2xl leading-tight">{currentQuestion.question_text}</p>
            </div>
          )}

          {!selectedAnswer ? (
            <div className="grid grid-cols-2 gap-3 flex-1">
              {(['A', 'B', 'C', 'D'] as AnswerKey[]).map(opt => {
                const cfg = ANSWER_CONFIG[opt]
                return (
                  <button key={opt} onClick={() => submitAnswer(opt)}
                    className={`${cfg.bg} text-white font-bold rounded-2xl flex flex-col items-center justify-center gap-3 p-5 min-h-[140px] transition-all hover:scale-105 active:scale-95 shadow-lg`}>
                    <span className="text-4xl">{cfg.shape}</span>
                    <span className="text-xl text-center leading-tight font-bold">
                      {currentQuestion[`option_${opt.toLowerCase()}` as 'option_a' | 'option_b' | 'option_c' | 'option_d']}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-5xl mb-4 animate-bounce">⏳</div>
              <p className="text-white font-bold text-xl">
                Answer locked in!
              </p>
              <p className="text-white/50 mt-2">Waiting for the teacher to reveal...</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ANSWER REVEAL
  if (game.status === 'answer_reveal' && currentQuestion) {
    const optionLabels: Record<string, string> = {
      A: currentQuestion.option_a,
      B: currentQuestion.option_b,
      C: currentQuestion.option_c,
      D: currentQuestion.option_d,
    }
    const optionColors: Record<string, string> = {
      A: 'bg-kawared',
      B: 'bg-kawaBlue',
      C: 'bg-kawaYellow text-kawaDark',
      D: 'bg-kawaGreen',
    }

    return (
      <div className="min-h-screen bg-kawaDark flex flex-col px-4 py-6 overflow-y-auto">
        <div className="w-full max-w-sm mx-auto space-y-4">

          {/* Result banner */}
          {answerResult ? (
            <div className={`rounded-2xl p-4 text-center animate-bounce-in ${answerResult.correct ? 'bg-kawaGreen/20 border border-kawaGreen/50' : 'bg-kawared/20 border border-kawared/50'}`}>
              <div className="text-5xl mb-2">{answerResult.correct ? '🎉' : '😬'}</div>
              <p className="text-white font-bold text-2xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
                {answerResult.correct ? 'Correct!' : 'Not quite!'}
              </p>
              {answerResult.correct && (
                <p className="text-kawaYellow font-bold text-lg">+{answerResult.points} points</p>
              )}
            </div>
          ) : (
            <div className="rounded-2xl p-4 text-center bg-white/10 border border-white/20">
              <p className="text-white/60">You didn&apos;t answer in time</p>
            </div>
          )}

          {/* Question */}
          <div className="bg-white text-kawaDark rounded-2xl p-4 text-center">
            <p className="font-bold text-base leading-snug">{currentQuestion.question_text}</p>
          </div>

          {/* All 4 options — highlight correct + what player chose */}
          <div className="grid grid-cols-2 gap-2">
            {(['A', 'B', 'C', 'D'] as AnswerKey[]).map(opt => {
              const isCorrect = opt === answerResult?.correctAnswer
              const isPicked = opt === answerResult?.selected
              const base = optionColors[opt]
              return (
                <div
                  key={opt}
                  className={`${base} rounded-xl p-3 text-white relative transition-all
                    ${isCorrect ? 'ring-4 ring-white scale-105' : 'opacity-50'}
                  `}
                >
                  <p className="font-bold text-xs leading-tight">{optionLabels[opt]}</p>
                  {/* Badges */}
                  <div className="flex gap-1 mt-1.5 flex-wrap">
                    {isCorrect && (
                      <span className="bg-white/30 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">✓ Correct</span>
                    )}
                    {isPicked && !isCorrect && (
                      <span className="bg-black/30 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">✗ Your pick</span>
                    )}
                    {isPicked && isCorrect && (
                      <span className="bg-white/30 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">Your pick</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Rank */}
          {myRank && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-3 flex items-center gap-3">
              <p className="text-kawaYellow font-bold text-3xl" style={{ fontFamily: "'Fredoka One', cursive" }}>#{myRank}</p>
              <div>
                <p className="text-white font-semibold text-sm">Your Rank</p>
                <p className="text-white/50 text-xs">{player.score.toLocaleString()} pts total</p>
              </div>
            </div>
          )}

          {/* Leaderboard */}
          {leaderboard.length > 0 && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4">
              <h3 className="text-white font-bold mb-3 text-xs uppercase tracking-widest">Leaderboard</h3>
              <div className="space-y-2">
                {leaderboard.slice(0, 5).map((p, i) => (
                  <div key={p.id}
                    className={`flex items-center gap-2 p-2 rounded-xl ${p.id === playerId ? 'bg-kawaPurple/30 border border-kawaPurple' : ''}`}>
                    <span className="text-base w-6">{['🥇', '🥈', '🥉', '4', '5'][i]}</span>
                    <span className={`flex-1 text-left text-sm font-semibold ${p.id === playerId ? 'text-kawaYellow' : 'text-white'}`}>
                      {p.nickname}
                    </span>
                    <span className="text-white/70 text-sm font-bold">{p.score.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-white/30 text-xs text-center animate-pulse">Waiting for next question...</p>
        </div>
      </div>
    )
  }

  // FINISHED
  if (game.status === 'finished') {
    if (followingReplay) {
      return (
        <div className="min-h-screen bg-kawaDark flex flex-col items-center justify-center text-center px-4">
          <div className="text-6xl mb-4 animate-bounce">🚀</div>
          <p className="text-white font-bold text-2xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
            New game starting!
          </p>
          <p className="text-purple-300 mt-2">Joining you in automatically...</p>
        </div>
      )
    }
    const podiumEmoji = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '🎉'
    return (
      <div className="min-h-screen bg-kawaDark flex flex-col items-center justify-center px-4 py-8 text-center">
        <div className="w-full max-w-sm space-y-5">
          {/* Trophy + result */}
          <div className="animate-bounce-in">
            <div className="text-7xl mb-3">{podiumEmoji}</div>
            <h1 className="text-white font-bold text-4xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
              Game Over!
            </h1>
            <p className="text-purple-300 mt-1">Well played, {player.nickname}!</p>
          </div>

          {/* Score card */}
          <div className={`rounded-2xl p-5 border ${myRank === 1 ? 'bg-kawaYellow/20 border-kawaYellow/60' : 'bg-white/10 border-white/20'}`}>
            <p className="text-white/60 text-sm mb-1">Final Score</p>
            <p className="text-kawaYellow font-bold text-6xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
              {player.score.toLocaleString()}
            </p>
            {myRank && (
              <p className="text-white/70 font-semibold mt-1">
                {myRank === 1 ? '🏆 Champion!' : myRank === 2 ? 'Runner Up' : myRank === 3 ? 'Third Place' : `Rank #${myRank}`}
              </p>
            )}
          </div>

          {/* Leaderboard */}
          {leaderboard.length > 0 && (
            <div className="bg-white/10 border border-white/20 rounded-2xl p-4">
              <h3 className="text-white font-bold mb-3 text-xs uppercase tracking-widest">Final Leaderboard</h3>
              <div className="space-y-2">
                {leaderboard.slice(0, 5).map((p, i) => (
                  <div key={p.id}
                    className={`flex items-center gap-2 p-2 rounded-xl ${p.id === playerId ? 'bg-kawaPurple/30 border border-kawaPurple' : ''}`}>
                    <span className="text-base w-6">{['🥇', '🥈', '🥉', '4', '5'][i]}</span>
                    <span className={`flex-1 text-left text-sm font-semibold ${p.id === playerId ? 'text-kawaYellow' : 'text-white'}`}>
                      {p.nickname}
                    </span>
                    <span className="text-white/70 text-sm font-bold">{p.score.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-white/30 text-xs animate-pulse">
            🔁 If the teacher replays, you&apos;ll be moved automatically
          </p>

          <a href="/"
            className="block w-full bg-kawaPurple hover:bg-purple-600 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95"
            style={{ fontFamily: "'Fredoka One', cursive" }}>
            Leave Game →
          </a>
        </div>
      </div>
    )
  }

  return null
}
