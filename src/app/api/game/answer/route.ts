import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { calculatePoints } from '@/lib/game-utils'

export async function POST(req: NextRequest) {
  const { gameId, playerId, questionId, selectedAnswer, responseTimeMs } = await req.json()
  const supabase = createClient()

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

  const { data: question } = await supabase
    .from('quiz_questions')
    .select('correct_answer, time_limit')
    .eq('id', questionId)
    .single()

  if (!question) {
    return NextResponse.json({ success: false, error: 'Question not found' }, { status: 404 })
  }

  const isCorrect = selectedAnswer === question.correct_answer
  const pointsEarned = calculatePoints(isCorrect, responseTimeMs, question.time_limit)

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
    const { data: player } = await supabase
      .from('players')
      .select('score')
      .eq('id', playerId)
      .single()
    if (player) {
      await supabase
        .from('players')
        .update({ score: player.score + pointsEarned })
        .eq('id', playerId)
    }
  }

  return NextResponse.json({ success: true, isCorrect, pointsEarned })
}
