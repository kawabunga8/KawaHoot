import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { gameId, playerId, nickname, realName } = await req.json()
  if (!gameId || !playerId) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
  }

  const chosenNickname = nickname?.trim() || realName || ''
  if (!chosenNickname) {
    return NextResponse.json({ success: false, error: 'Missing nickname' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify player belongs to the specified game and is pre-registered and unclaimed
  const { data: player } = await supabase
    .from('players')
    .select('game_id, is_pre_registered, is_claimed')
    .eq('id', playerId)
    .single()

  if (!player || player.game_id !== gameId) {
    return NextResponse.json({ success: false, error: 'Player not found' }, { status: 403 })
  }
  if (!player.is_pre_registered || player.is_claimed) {
    return NextResponse.json({ success: false, error: 'Player already claimed or not pre-registered' }, { status: 403 })
  }

  const { error } = await supabase
    .from('players')
    .update({ nickname: chosenNickname, is_claimed: true, real_name: realName || null })
    .eq('id', playerId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
