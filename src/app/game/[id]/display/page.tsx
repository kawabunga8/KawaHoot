'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Game, Player, QuizQuestion } from '@/types'

const ANSWER_COLORS = {
  A: { bg: 'bg-kawared', text: 'text-white', shape: '▲' },
  B: { bg: 'bg-kawaBlue', text: 'text-white', shape: '◆' },
  C: { bg: 'bg-kawaYellow', text: 'text-kawaDark', shape: '●' },
  D: { bg: 'bg-kawaGreen', text: 'text-white', shape: '■' },
}

export default function DisplayPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useMemo(() => createClient(), [])

  const [game, setGame] = useState<Game | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [answerCounts, setAnswerCounts] = useState({ A: 0, B: 0, C: 0, D: 0 })
  const [timeLeft, setTimeLeft] = useState(0)

  // Initial load
  useEffect(() => {
    async function load() {
      const { data: gameData } = await supabase.from('games').select('*').eq('id', id).single()
      if (!gameData) return
      setGame(gameData)

      const { data: qData } = await supabase
        .from('quiz_questions').select('*').eq('game_id', id).order('order_index')
      setQuestions(qData || [])
      if (gameData.current_question_index >= 0 && qData) {
        setCurrentQuestion(qData[gameData.current_question_index] || null)
      }
    }
    load()
  }, [id, supabase])

  // Poll game state
  useEffect(() => {
    const poll = setInterval(async () => {
      const { data } = await supabase.from('games').select('*').eq('id', id).single()
      if (!data) return
      setGame(data)
      setQuestions(prev => {
        if (data.current_question_index >= 0 && prev.length > 0) {
          setCurrentQuestion(prev[data.current_question_index] || null)
        }
        return prev
      })
    }, 2000)
    const sub = supabase.channel(`display-game-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games' }, (payload) => {
        const row = payload.new as Game
        if (row.id === id) {
          setGame(row)
          setQuestions(prev => {
            if (row.current_question_index >= 0 && prev.length > 0) {
              setCurrentQuestion(prev[row.current_question_index] || null)
            }
            return prev
          })
        }
      })
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(sub) }
  }, [id, supabase])

  // Players
  useEffect(() => {
    const poll = setInterval(() => {
      supabase.from('players').select('*').eq('game_id', id).order('score', { ascending: false })
        .then(({ data }) => setPlayers(data || []))
    }, 3000)
    supabase.from('players').select('*').eq('game_id', id).order('score', { ascending: false })
      .then(({ data }) => setPlayers(data || []))
    return () => clearInterval(poll)
  }, [id, supabase])

  // Answer counts
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
    const sub = supabase.channel(`display-answers-${currentQuestion.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers' }, (payload) => {
        const row = payload.new as { question_id?: string }
        if (row?.question_id === currentQuestion.id) refetch()
      })
      .subscribe()
    return () => { clearInterval(poll); supabase.removeChannel(sub) }
  }, [currentQuestion?.id, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Timer
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

  if (!game) {
    return (
      <div className="min-h-screen bg-kawaDark flex items-center justify-center">
        <div className="text-white text-2xl animate-pulse">Loading...</div>
      </div>
    )
  }

  const totalAnswers = answerCounts.A + answerCounts.B + answerCounts.C + answerCounts.D
  const maxCount = Math.max(answerCounts.A, answerCounts.B, answerCounts.C, answerCounts.D, 1)

  return (
    <div className="min-h-screen bg-kawaDark flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-white/10">
        <h1 className="text-white font-bold text-2xl" style={{ fontFamily: "'Fredoka One', cursive" }}>
          <span className="text-white">Kawa</span><span className="text-kawaYellow">hoot</span><span className="text-kawaCoral">!</span>
        </h1>
        <div className="text-center">
          <p className="text-white/40 text-xs font-bold uppercase tracking-widest">Game PIN</p>
          <p className="text-kawaYellow font-bold text-3xl tracking-widest" style={{ fontFamily: "'Fredoka One', cursive" }}>
            {game.pin}
          </p>
        </div>
        <div className="text-right">
          <p className="text-white/40 text-xs font-bold uppercase tracking-widest">Players</p>
          <p className="text-white font-bold text-2xl">{players.length}</p>
        </div>
      </div>

      {/* WAITING */}
      {game.status === 'waiting' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div className="text-8xl mb-6">🎮</div>
          <h2 className="text-white font-bold text-6xl mb-4" style={{ fontFamily: "'Fredoka One', cursive" }}>
            {game.title}
          </h2>
          <p className="text-purple-300 text-2xl mb-8">Join at <span className="text-kawaYellow font-bold">kawahoot.vercel.app</span></p>
          <div className="bg-white/10 border-4 border-kawaYellow rounded-3xl px-16 py-8">
            <p className="text-white/60 text-lg mb-2 font-bold uppercase tracking-widest">Game PIN</p>
            <p className="text-white font-bold text-8xl tracking-[0.3em]" style={{ fontFamily: "'Fredoka One', cursive" }}>
              {game.pin}
            </p>
          </div>
          <div className="mt-8 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full bg-kawaGreen animate-pulse" />
            <p className="text-white text-2xl font-semibold">{players.length} player{players.length !== 1 ? 's' : ''} waiting</p>
          </div>
        </div>
      )}

      {/* QUESTION / ANSWER REVEAL */}
      {(game.status === 'question' || game.status === 'answer_reveal') && currentQuestion && (
        <div className="flex-1 flex flex-col px-8 py-6">
          {/* Question */}
          <div className="bg-white rounded-3xl shadow-2xl border-4 border-kawaYellow px-10 py-8 mb-6 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-white to-yellow-50 pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <p className="text-kawaDark/40 text-sm font-bold uppercase tracking-widest">
                  Q{game.current_question_index + 1} / {questions.length}
                </p>
                {game.status === 'question' && (
                  <div className={`font-bold text-4xl ${timeLeft <= 5 ? 'text-kawared' : 'text-kawaDark'}`}
                    style={{ fontFamily: "'Fredoka One', cursive" }}>
                    {timeLeft}s
                  </div>
                )}
                <p className="text-kawaDark/60 text-sm font-bold">{totalAnswers} / {players.length} answered</p>
              </div>
              {game.status === 'question' && (
                <div className="h-3 bg-kawaDark/10 rounded-full overflow-hidden mb-4">
                  <div
                    className="h-full bg-gradient-to-r from-kawaYellow to-kawaCoral rounded-full transition-all duration-200"
                    style={{ width: `${(timeLeft / currentQuestion.time_limit) * 100}%` }}
                  />
                </div>
              )}
              <p className="text-kawaDark font-bold text-4xl md:text-5xl leading-tight" style={{ fontFamily: "'Fredoka One', cursive" }}>
                {currentQuestion.question_text}
              </p>
            </div>
          </div>

          {/* Answer options */}
          <div className="grid grid-cols-2 gap-4 flex-1">
            {(['A', 'B', 'C', 'D'] as const).map(opt => {
              const color = ANSWER_COLORS[opt]
              const count = answerCounts[opt]
              const pct = (count / maxCount) * 100
              const isCorrect = currentQuestion.correct_answer === opt
              const revealed = game.status === 'answer_reveal'
              return (
                <div
                  key={opt}
                  className={`${color.bg} ${color.text} rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between
                    ${revealed && isCorrect ? 'ring-8 ring-white scale-105' : ''}
                    ${revealed && !isCorrect ? 'opacity-40' : ''}`}
                  style={{ transition: 'all 0.3s' }}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-3xl">{color.shape}</span>
                    <span className="font-bold text-2xl md:text-3xl leading-tight flex-1" style={{ fontFamily: "'Fredoka One', cursive" }}>
                      {currentQuestion[`option_${opt.toLowerCase()}` as 'option_a' | 'option_b' | 'option_c' | 'option_d']}
                    </span>
                    {revealed && isCorrect && <span className="text-4xl">✓</span>}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xl opacity-80">{count} vote{count !== 1 ? 's' : ''}</span>
                      {totalAnswers > 0 && (
                        <span className="font-bold text-xl opacity-80">{Math.round((count / totalAnswers) * 100)}%</span>
                      )}
                    </div>
                    <div className="h-3 bg-black/20 rounded-full overflow-hidden">
                      <div className="h-full bg-white/50 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* PAUSED */}
      {game.status === 'paused' && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="text-8xl mb-6">⏸</div>
          <p className="text-kawaYellow font-bold text-5xl" style={{ fontFamily: "'Fredoka One', cursive" }}>Game Paused</p>
          <p className="text-white/50 text-xl mt-3">Your teacher will resume shortly</p>
        </div>
      )}

      {/* FINISHED */}
      {game.status === 'finished' && (
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div className="text-8xl mb-4">🏆</div>
          <h2 className="text-white font-bold text-6xl mb-8" style={{ fontFamily: "'Fredoka One', cursive" }}>Game Over!</h2>

          {players.length >= 1 && (
            <div className="flex items-end justify-center gap-6 w-full max-w-2xl">
              {players[1] && (
                <div className="flex-1 text-center">
                  <div className="text-4xl mb-2">🥈</div>
                  <div className="bg-white/20 border border-white/30 rounded-t-2xl px-4 py-4" style={{ height: 140 }}>
                    <p className="text-white font-bold text-xl truncate">{players[1].nickname}</p>
                    {players[1].real_name && players[1].real_name !== players[1].nickname && (
                      <p className="text-white/50 text-sm truncate">{players[1].real_name}</p>
                    )}
                    <p className="text-kawaYellow font-bold text-2xl mt-1">{players[1].score.toLocaleString()}</p>
                    <p className="text-white/40 text-sm">pts</p>
                  </div>
                </div>
              )}
              <div className="flex-1 text-center">
                <div className="text-5xl mb-2">🥇</div>
                <div className="bg-kawaYellow/30 border-2 border-kawaYellow rounded-t-2xl px-4 py-4" style={{ height: 180 }}>
                  <p className="text-white font-bold text-2xl truncate">{players[0].nickname}</p>
                  {players[0].real_name && players[0].real_name !== players[0].nickname && (
                    <p className="text-white/50 text-sm truncate">{players[0].real_name}</p>
                  )}
                  <p className="text-kawaYellow font-bold text-3xl mt-1">{players[0].score.toLocaleString()}</p>
                  <p className="text-white/40 text-sm">pts</p>
                </div>
              </div>
              {players[2] && (
                <div className="flex-1 text-center">
                  <div className="text-4xl mb-2">🥉</div>
                  <div className="bg-white/10 border border-white/20 rounded-t-2xl px-4 py-4" style={{ height: 110 }}>
                    <p className="text-white font-bold text-xl truncate">{players[2].nickname}</p>
                    {players[2].real_name && players[2].real_name !== players[2].nickname && (
                      <p className="text-white/50 text-sm truncate">{players[2].real_name}</p>
                    )}
                    <p className="text-kawaYellow font-bold text-xl mt-1">{players[2].score.toLocaleString()}</p>
                    <p className="text-white/40 text-sm">pts</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {players.length > 3 && (
            <div className="mt-6 w-full max-w-2xl bg-white/10 border border-white/20 rounded-2xl p-4 space-y-2">
              {players.slice(3, 8).map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
                  <span className="text-white/50 font-bold w-8 text-center text-lg">{i + 4}</span>
                  <span className="flex-1 text-white font-semibold text-lg">{p.nickname}</span>
                  <span className="text-kawaYellow font-bold text-lg">{p.score.toLocaleString()} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
