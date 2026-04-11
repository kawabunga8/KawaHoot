import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireHost } from '@/lib/require-host'

export async function POST(req: NextRequest) {
  const auth = requireHost(req)
  if (auth) return auth

  const { gameId } = await req.json()
  const supabase = createClient()

  await supabase.from('games').update({
    status: 'waiting',
    current_question_index: -1,
    current_question_started_at: null,
  }).eq('id', gameId)

  await supabase.from('players').update({ score: 0 }).eq('game_id', gameId)
  await supabase.from('answers').delete().eq('game_id', gameId)

  return NextResponse.json({ success: true })
}
