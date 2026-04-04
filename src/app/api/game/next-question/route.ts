import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { gameId, targetIndex } = await req.json()
  const supabase = createClient()

  const { data: game } = await supabase
    .from('games')
    .select('current_question_index')
    .eq('id', gameId)
    .single()

  if (!game) return NextResponse.json({ success: false, error: 'Game not found' }, { status: 404 })

  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('*')
    .eq('game_id', gameId)
    .order('order_index')

  // targetIndex can be passed explicitly (e.g. random jump); otherwise increment
  const nextIndex = targetIndex !== undefined ? targetIndex : game.current_question_index + 1

  const nextQuestion = questions?.[nextIndex]
  if (!nextQuestion) {
    return NextResponse.json({ success: false, error: 'No more questions' }, { status: 400 })
  }

  await supabase
    .from('games')
    .update({
      status: 'question',
      current_question_index: nextIndex,
      current_question_started_at: new Date().toISOString(),
    })
    .eq('id', gameId)

  return NextResponse.json({ success: true, question: nextQuestion })
}
