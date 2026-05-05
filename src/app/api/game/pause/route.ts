import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireHost } from '@/lib/require-host'

export async function POST(req: NextRequest) {
  const auth = requireHost(req)
  if (auth) return auth

  const { gameId, action } = await req.json()
  const supabase = await createClient()

  if (action === 'pause') {
    const { data: current } = await supabase
      .from('games').select('status').eq('id', gameId).single()
    if (!current || current.status === 'paused') {
      return NextResponse.json({ success: false, error: 'Game is not in a pauseable state' }, { status: 400 })
    }
    const { error } = await supabase
      .from('games').update({ status: 'paused', previous_status: current.status }).eq('id', gameId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'resume') {
    const { data: current } = await supabase
      .from('games').select('previous_status').eq('id', gameId).single()
    const resumeStatus = (current as any)?.previous_status || 'answer_reveal'
    const { error } = await supabase
      .from('games').update({ status: resumeStatus, previous_status: null }).eq('id', gameId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
}
