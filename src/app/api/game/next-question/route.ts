import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireHost } from '@/lib/require-host'

export async function POST(req: NextRequest) {
  const auth = requireHost(req)
  if (auth) return auth

  const { gameId, targetIndex } = await req.json()
  const supabase = await createClient()

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

  const nextIndex = targetIndex !== undefined ? targetIndex : game.current_question_index + 1

  // Prevent jumping backwards
  if (nextIndex <= game.current_question_index) {
    return NextResponse.json({ success: false, error: 'Invalid question index' }, { status: 400 })
  }

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
