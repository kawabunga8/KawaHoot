import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { gameId } = await req.json()
  if (!gameId) return NextResponse.json({ success: false }, { status: 400 })
  const supabase = createClient()
  const { error } = await supabase.from('games').update({ status: 'leaderboard' }).eq('id', gameId)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
