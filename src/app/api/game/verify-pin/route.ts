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

  let roster: { id: string; nickname: string }[] = []
  if (data.status === 'waiting') {
    const { data: players } = await supabase
      .from('players')
      .select('id, nickname')
      .eq('game_id', data.id)
      .eq('is_pre_registered', true)
      .order('nickname')
    roster = players || []
  }

  return NextResponse.json({ valid: true, gameId: data.id, roster })
}
