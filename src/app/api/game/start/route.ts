import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { gameId } = await req.json()
  const supabase = createClient()

  const { data: questions } = await supabase
    .from('quiz_questions')
    .select('id')
    .eq('game_id', gameId)
    .order('order_index')

  if (!questions?.length) {
    return NextResponse.json({ success: false, error: 'No questions' }, { status: 400 })
  }

  const { error } = await supabase
    .from('games')
    .update({
      status: 'question',
      current_question_index: 0,
      current_question_started_at: new Date().toISOString(),
    })
    .eq('id', gameId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
