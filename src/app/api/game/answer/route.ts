import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calculatePoints } from '@/lib/game-utils'

export async function POST(req: NextRequest) {
  const { gameId, playerId, questionId, selectedAnswer } = await req.json()

  if (!gameId || !playerId || !questionId || !selectedAnswer) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
  }

  if (!['A', 'B', 'C', 'D'].includes(selectedAnswer)) {
    return NextResponse.json({ success: false, error: 'Invalid answer' }, { status: 400 })
  }

  // Service-role, not the cookie client: players are unauthenticated guests, and
  // quiz_questions is no longer readable by anon (it holds the answer key). The
  // route validates game status, question identity, player membership and timing
  // itself, so it does not rely on RLS for correctness.
  const supabase = createAdminClient()

  // Verify game is active and get server-side timing
  const { data: game } = await supabase
    .from('games')
    .select('status, current_question_started_at, current_question_index')
    .eq('id', gameId)
    .single()

  if (!game || game.status !== 'question') {
    return NextResponse.json({ success: false, error: 'Question not active' }, { status: 400 })
  }

  // The submitted question must be the one the game is actually on. Checking
  // only that it belongs to the game would let a player answer every remaining
  // question during question 1 — each would be timed against the current
  // question's start, so each would score as near-instant.
  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('id, correct_answer, time_limit')
    .eq('game_id', gameId)
    .order('order_index')

  const question = questions?.[game.current_question_index]

  if (!question) {
    return NextResponse.json({ success: false, error: 'Question not found' }, { status: 404 })
  }

  if (question.id !== questionId) {
    return NextResponse.json({ success: false, error: 'Not the current question' }, { status: 400 })
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

  // The check above is not atomic with this insert, so two near-simultaneous
  // submissions can both pass it. The unique(player_id, question_id) constraint
  // is what actually stops the double — but only if we notice it failed and
  // stop before awarding points twice for one answer.
  const { error: insertError } = await supabase.from('answers').insert({
    game_id: gameId,
    player_id: playerId,
    question_id: questionId,
    selected_answer: selectedAnswer,
    is_correct: isCorrect,
    response_time_ms: responseTimeMs,
    points_earned: pointsEarned,
  })

  if (insertError) {
    const alreadyAnswered = insertError.code === '23505'
    return NextResponse.json(
      { success: false, error: alreadyAnswered ? 'Already answered' : 'Failed to record answer' },
      { status: alreadyAnswered ? 409 : 500 },
    )
  }

  if (pointsEarned > 0) {
    // Atomic increment — defined in supabase-schema.sql. If this fails the answer
    // is recorded but the score is not, so surface it rather than silently
    // leaving the player on zero.
    const { error: scoreError } = await supabase.rpc('increment_player_score', {
      player_id_param: playerId,
      points_param: pointsEarned,
    })
    if (scoreError) {
      return NextResponse.json(
        { success: false, error: 'Answer saved but score failed to update' },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ success: true, isCorrect, pointsEarned })
}
