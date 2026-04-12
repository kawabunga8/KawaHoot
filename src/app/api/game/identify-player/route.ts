import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Called when a guest player identifies themselves from the class roster on the waiting screen.
// Updates their nickname to the real name and removes the pre-registered placeholder.
export async function POST(req: NextRequest) {
  const { gameId, guestPlayerId, rosterPlayerId, realName } = await req.json()
  if (!gameId || !guestPlayerId || !rosterPlayerId || !realName) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify both players belong to the same game (and match the supplied gameId)
  const { data: players } = await supabase
    .from('players')
    .select('id, game_id')
    .in('id', [guestPlayerId, rosterPlayerId])

  const guest = players?.find(p => p.id === guestPlayerId)
  const roster = players?.find(p => p.id === rosterPlayerId)

  if (!guest || guest.game_id !== gameId) {
    return NextResponse.json({ success: false, error: 'Guest player not in this game' }, { status: 403 })
  }
  if (!roster || roster.game_id !== gameId) {
    return NextResponse.json({ success: false, error: 'Roster player not in this game' }, { status: 403 })
  }

  const { error: updateError } = await supabase
    .from('players')
    .update({ nickname: realName })
    .eq('id', guestPlayerId)

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  await supabase.from('players').delete().eq('id', rosterPlayerId)

  return NextResponse.json({ success: true })
}
