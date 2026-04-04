import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePin } from '@/lib/game-utils'
import type { CSVRow } from '@/types'

export async function POST(req: NextRequest) {
  const { title, questions } = await req.json() as { title: string; questions: CSVRow[] }

  if (!title || !questions?.length) {
    return NextResponse.json({ success: false, error: 'Missing title or questions' }, { status: 400 })
  }

  const supabase = createClient()

  // Generate unique PIN
  let pin = generatePin()
  let attempts = 0
  while (attempts < 10) {
    const { data } = await supabase.from('games').select('id').eq('pin', pin).single()
    if (!data) break
    pin = generatePin()
    attempts++
  }

  // Create game
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert({ pin, title, status: 'waiting', current_question_index: -1 })
    .select()
    .single()

  if (gameErr || !game) {
    return NextResponse.json({ success: false, error: 'Failed to create game' }, { status: 500 })
  }

  // Insert questions
  const questionRows = questions.map((q, i) => ({
    game_id: game.id,
    question_text: q.question,
    option_a: q.option_a,
    option_b: q.option_b,
    option_c: q.option_c,
    option_d: q.option_d,
    correct_answer: q.correct_answer.toUpperCase(),
    time_limit: parseInt(q.time_limit || '20') || 20,
    order_index: i,
  }))

  const { error: qErr } = await supabase.from('quiz_questions').insert(questionRows)
  if (qErr) {
    await supabase.from('games').delete().eq('id', game.id)
    return NextResponse.json({ success: false, error: 'Failed to save questions' }, { status: 500 })
  }

  return NextResponse.json({ success: true, gameId: game.id, pin: game.pin })
}
