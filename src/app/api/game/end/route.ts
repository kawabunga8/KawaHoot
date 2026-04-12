import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireHost } from '@/lib/require-host'

export async function POST(req: NextRequest) {
  const auth = requireHost(req)
  if (auth) return auth

  const { gameId } = await req.json()
  const supabase = await createClient()

  const { error } = await supabase
    .from('games')
    .update({ status: 'finished' })
    .eq('id', gameId)

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
