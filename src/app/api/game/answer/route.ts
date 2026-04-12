import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculatePoints } from '@/lib/game-utils'

export async function POST(req: NextRequest) {
  const { gameId, playerId, questionId, selectedAnswer } = await req.json()

  if (!gameId || !playerId || !questionId || !selectedAnswer) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
  }

  if (!['A', 'B', 'C', 'D'].includes(selectedAnswer)) {
    return NextResponse.json({ success: false, error: 'Invalid answer' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify game is active and get server-side timing
  const { data: game } = await supabase
    .from('games')
    .select('status, current_question_started_at')
    .eq('id', gameId)
    .single()

  if (!game || game.status !== 'question') {
    return NextResponse.json({ success: false, error: 'Question not active' }, { status: 400 })
  }

  // Verify question belongs to this game
  const { data: question } = await supabase
    .from('quiz_questions')
    .select('correct_answer, time_limit')
    .eq('id', questionId)
    .eq('game_id', gameId)
    .single()

  if (!question) {
    return NextResponse.json({ success: false, error: 'Question not found' }, { status: 404 })
  }

  // Verify player belongs to this game
  const { data: player } = await supabase
    .from('players')
    .select('game_id')
    .eq('id', playerId)
    .single()

  if (!player || player.game_id !== gameId) {
    return NextResponse.json({ success: false, error: 'Player not in this game' }, { status: 403 })
  }

  // Calculate response time server-side; ignore client-supplied value
  const startedAt = game.current_question_started_at
    ? new Date(game.current_question_started_at).getTime()
    : Date.now()
  const responseTimeMs = Date.now() - startedAt

  // Reject answers past the time limit (2s grace for network latency)
  if (responseTimeMs > question.time_limit * 1000 + 2000) {
    return NextResponse.json({ success: false, error: 'Time expired' }, { status: 400 })
  }

  // Check if already answered
  const { data: existing } = await supabase
    .from('answers')
    .select('id')
    .eq('player_id', playerId)
    .eq('question_id', questionId)
    .single()

  if (existing) {
    return NextResponse.json({ success: false, error: 'Already answered' }, { status: 409 })
  }

  const isCorrect = selectedAnswer === question.correct_answer
  // Clamp to time limit for scoring so late submissions within grace period don't get speed bonus
  const scoringTimeMs = Math.min(responseTimeMs, question.time_limit * 1000)
  const pointsEarned = calculatePoints(isCorrect, scoringTimeMs, question.time_limit)

  await supabase.from('answers').insert({
    game_id: gameId,
    player_id: playerId,
    question_id: questionId,
    selected_answer: selectedAnswer,
    is_correct: isCorrect,
    response_time_ms: responseTimeMs,
    points_earned: pointsEarned,
  })

  if (pointsEarned > 0) {
    // Atomic increment — requires the increment_player_score RPC in supabase-schema.sql
    await supabase.rpc('increment_player_score', {
      player_id_param: playerId,
      points_param: pointsEarned,
    })
  }

  return NextResponse.json({ success: true, isCorrect, pointsEarned })
}
