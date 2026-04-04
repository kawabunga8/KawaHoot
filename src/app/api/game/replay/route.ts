import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePin } from '@/lib/game-utils'

export async function POST(req: NextRequest) {
  const { gameId } = await req.json()
  const supabase = createClient()

  // Fetch original game + questions
  const { data: original } = await supabase.from('games').select('title').eq('id', gameId).single()
  const { data: questions } = await supabase
    .from('quiz_questions').select('*').eq('game_id', gameId).order('order_index')

  if (!original || !questions?.length) {
    return NextResponse.json({ success: false, error: 'Game not found' }, { status: 404 })
  }

  // Generate unique PIN
  let pin = generatePin()
  for (let i = 0; i < 10; i++) {
    const { data } = await supabase.from('games').select('id').eq('pin', pin).single()
    if (!data) break
    pin = generatePin()
  }

  // Create new game
  const { data: newGame, error } = await supabase
    .from('games')
    .insert({ pin, title: original.title, status: 'waiting', current_question_index: -1 })
    .select().single()

  if (error || !newGame) {
    return NextResponse.json({ success: false, error: 'Failed to create game' }, { status: 500 })
  }

  // Copy questions
  await supabase.from('quiz_questions').insert(
    questions.map(q => ({
      game_id: newGame.id,
      question_text: q.question_text,
      option_a: q.option_a,
      option_b: q.option_b,
      option_c: q.option_c,
      option_d: q.option_d,
      correct_answer: q.correct_answer,
      time_limit: q.time_limit,
      order_index: q.order_index,
    }))
  )

  return NextResponse.json({ success: true, gameId: newGame.id, pin: newGame.pin })
}
