import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { playerId, nickname, realName } = await req.json()
  if (!playerId) {
    return NextResponse.json({ success: false, error: 'Missing playerId' }, { status: 400 })
  }

  const chosenNickname = nickname?.trim() || realName || ''
  if (!chosenNickname) {
    return NextResponse.json({ success: false, error: 'Missing nickname' }, { status: 400 })
  }

  const supabase = createClient()
  const { error } = await supabase
    .from('players')
    .update({ nickname: chosenNickname, real_name: realName || null, is_claimed: true })
    .eq('id', playerId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
