import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const pin = req.nextUrl.searchParams.get('pin')
  if (!pin) return NextResponse.json({ valid: false })

  const supabase = createClient()
  const { data } = await supabase
    .from('games')
    .select('id, status')
    .eq('pin', pin)
    .in('status', ['waiting', 'question', 'answer_reveal'])
    .single()

  if (!data) return NextResponse.json({ valid: false })

  // Return pre-registered roster for any active game status (including late joiners)
  const { data: players } = await supabase
    .from('players')
    .select('id, nickname')
    .eq('game_id', data.id)
    .eq('is_pre_registered', true)
    .order('nickname')
  const roster = players || []

  return NextResponse.json({ valid: true, gameId: data.id, roster })
}
