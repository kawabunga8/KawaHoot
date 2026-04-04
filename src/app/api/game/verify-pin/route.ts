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

  return NextResponse.json({ valid: !!data, gameId: data?.id })
}
