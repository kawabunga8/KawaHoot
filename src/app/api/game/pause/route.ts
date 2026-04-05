import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** POST /api/game/pause
 *  body: { gameId, action: 'pause' | 'resume' }
 *  pause: sets status to 'paused'
 *  resume: sets status back to 'answer_reveal'
 */
export async function POST(req: NextRequest) {
  const { gameId, action } = await req.json()
  const supabase = createClient()

  if (action === 'pause') {
    const { error } = await supabase
      .from('games').update({ status: 'paused' }).eq('id', gameId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  if (action === 'resume') {
    const { error } = await supabase
      .from('games').update({ status: 'answer_reveal' }).eq('id', gameId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
}
