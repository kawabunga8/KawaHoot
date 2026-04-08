import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Called when a guest player identifies themselves from the class roster on the waiting screen.
// Updates their nickname to the real name and removes the pre-registered placeholder.
export async function POST(req: NextRequest) {
  const { guestPlayerId, rosterPlayerId, realName } = await req.json()
  if (!guestPlayerId || !rosterPlayerId || !realName) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
  }

  const supabase = createClient()

  // Update the guest player with the real name
  const { error: updateError } = await supabase
    .from('players')
    .update({ nickname: realName, real_name: realName })
    .eq('id', guestPlayerId)

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 })
  }

  // Remove the pre-registered placeholder (it's now been claimed by the guest)
  await supabase.from('players').delete().eq('id', rosterPlayerId)

  return NextResponse.json({ success: true })
}
