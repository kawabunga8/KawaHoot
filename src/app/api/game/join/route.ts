import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { pin, nickname } = await req.json()
  if (!pin || !nickname) {
    return NextResponse.json({ success: false, error: 'Missing pin or nickname' }, { status: 400 })
  }

  const supabase = createClient()

  const { data: game } = await supabase
    .from('games')
    .select('id, status')
    .eq('pin', pin)
    .in('status', ['waiting', 'question', 'answer_reveal'])
    .single()

  if (!game) {
    return NextResponse.json({ success: false, error: 'Game not found' }, { status: 404 })
  }

  // Check nickname uniqueness in this game
  const { data: existing } = await supabase
    .from('players')
    .select('id')
    .eq('game_id', game.id)
    .ilike('nickname', nickname)
    .single()

  if (existing) {
    return NextResponse.json({ success: false, error: 'Nickname already taken!' }, { status: 409 })
  }

  const { data: player, error } = await supabase
    .from('players')
    .insert({ game_id: game.id, nickname, score: 0 })
    .select()
    .single()

  if (error || !player) {
    return NextResponse.json({ success: false, error: 'Failed to join' }, { status: 500 })
  }

  return NextResponse.json({ success: true, gameId: game.id, playerId: player.id })
}
