import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Serves the question the game is currently on, to players.
//
// correct_answer is withheld while the question is live and only included once
// the host has moved to answer_reveal. Players must never be able to read the
// answer key before answering — which is also why this uses the admin client
// and quiz_questions is not readable by the anon role (see supabase-schema.sql).
export async function GET(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get('gameId')
  if (!gameId) {
    return NextResponse.json({ success: false, error: 'Missing gameId' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: game } = await supabase
    .from('games')
    .select('status, current_question_index')
    .eq('id', gameId)
    .single()

  if (!game) {
    return NextResponse.json({ success: false, error: 'Game not found' }, { status: 404 })
  }

  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('id, question_text, option_a, option_b, option_c, option_d, time_limit, order_index, correct_answer')
    .eq('game_id', gameId)
    .order('order_index')

  const total = questions?.length ?? 0

  if (game.current_question_index < 0) {
    return NextResponse.json({ success: true, question: null, total })
  }

  const q = questions?.[game.current_question_index]
  if (!q) {
    return NextResponse.json({ success: true, question: null, total })
  }

  // Strip the answer key unless the host has already revealed it.
  const revealed = game.status !== 'question'
  const { correct_answer, ...safe } = q

  return NextResponse.json({
    success: true,
    question: revealed ? { ...safe, correct_answer } : safe,
    total,
  })
}
