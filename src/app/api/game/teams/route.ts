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

  if (action === 'pre_register') {
    const { names } = body as { names: string[] }
    const results: { nickname: string; playerId: string }[] = []
    for (const nickname of names) {
      // Skip if already exists in this game
      const { data: existing } = await supabase
        .from('players').select('id').eq('game_id', gameId).ilike('nickname', nickname).single()
      if (existing) {
        results.push({ nickname, playerId: existing.id })
        continue
      }
      const { data: player } = await supabase
        .from('players')
        .insert({ game_id: gameId, nickname, real_name: nickname, score: 0, is_pre_registered: true })
        .select().single()
      if (player) results.push({ nickname, playerId: player.id })
    }
    return NextResponse.json({ success: true, players: results })
  }

  if (action === 'auto_assign') {
    const { data: unassigned } = await supabase
      .from('players').select('id').eq('game_id', gameId).is('team_id', null)
    const { data: teamList } = await supabase
      .from('teams').select('id').eq('game_id', gameId).order('created_at')
    if (!teamList?.length || !unassigned?.length) {
      return NextResponse.json({ success: false, error: 'Need teams and unassigned players' }, { status: 400 })
    }
    // Fisher-Yates shuffle
    const shuffled = [...unassigned].sort(() => Math.random() - 0.5)
    const assignments = shuffled.map((player, i) => ({
      playerId: player.id,
      teamId: teamList[i % teamList.length].id,
    }))
    for (const { playerId, teamId } of assignments) {
      await supabase.from('players').update({ team_id: teamId }).eq('id', playerId)
    }
    return NextResponse.json({ success: true, assignments })
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
}
