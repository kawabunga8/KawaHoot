import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** POST /api/game/teams
 *  body: { gameId, action: 'create' | 'assign' | 'delete' | 'set_mode', ...rest }
 */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { gameId, action } = body
  const supabase = createClient()

  if (action === 'set_mode') {
    const { mode } = body // 'individual' | 'teams'
    const { error } = await supabase.from('games').update({ mode }).eq('id', gameId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    // Clear all team assignments if switching to individual
    if (mode === 'individual') {
      await supabase.from('players').update({ team_id: null }).eq('game_id', gameId)
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'create') {
    const { name, color } = body
    const { data, error } = await supabase
      .from('teams').insert({ game_id: gameId, name, color }).select().single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, team: data })
  }

  if (action === 'delete') {
    const { teamId } = body
    // Unassign players first
    await supabase.from('players').update({ team_id: null }).eq('team_id', teamId)
    await supabase.from('teams').delete().eq('id', teamId)
    return NextResponse.json({ success: true })
  }

  if (action === 'assign') {
    const { playerId, teamId } = body // teamId can be null to unassign
    const { error } = await supabase.from('players').update({ team_id: teamId }).eq('id', playerId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
}
