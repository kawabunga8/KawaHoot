import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { gameId } = await req.json()
  const supabase = createClient()

  const { error } = await supabase
    .from('games')
    .update({ status: 'answer_reveal' })
    .eq('id', gameId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
