import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { gameId } = await req.json()
  const supabase = createClient()

  // Reset game to waiting state
  await supabase.from('games').update({
    status: 'waiting',
    current_question_index: -1,
    current_question_started_at: null,
  }).eq('id', gameId)

  // Reset all player scores to 0
  await supabase.from('players').update({ score: 0 }).eq('game_id', gameId)

  // Delete all answers for this game
  await supabase.from('answers').delete().eq('game_id', gameId)

  return NextResponse.json({ success: true })
}
