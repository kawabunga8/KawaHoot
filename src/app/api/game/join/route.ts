import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_NICKNAME_LENGTH = 20

export async function POST(req: NextRequest) {
  const { pin, nickname } = await req.json()
  if (!pin) {
    return NextResponse.json({ success: false, error: 'Missing pin' }, { status: 400 })
  }

  const requestedNickname = typeof nickname === 'string' ? nickname.trim() : ''
  if (!requestedNickname) {
    return NextResponse.json({ success: false, error: 'Please enter a nickname' }, { status: 400 })
  }
  if (requestedNickname.length > MAX_NICKNAME_LENGTH) {
    return NextResponse.json(
      { success: false, error: `Nickname must be ${MAX_NICKNAME_LENGTH} characters or fewer` },
      { status: 400 },
    )
  }

  const supabase = await createClient()

  const { data: game } = await supabase
    .from('games')
    .select('id, status, mode')
    .eq('pin', pin)
    .in('status', ['waiting', 'question', 'answer_reveal', 'leaderboard'])
    .single()

  if (!game) {
    return NextResponse.json({ success: false, error: 'Game not found' }, { status: 404 })
  }

  // In teams mode, find the team with the fewest members to auto-assign
  let teamId: string | null = null
  if (game.mode === 'teams') {
    const { data: teams } = await supabase
      .from('teams').select('id').eq('game_id', game.id)
    if (teams && teams.length > 0) {
      const { data: counts } = await supabase
        .from('players').select('team_id').eq('game_id', game.id).not('team_id', 'is', null)
      const memberCounts: Record<string, number> = {}
      teams.forEach(t => { memberCounts[t.id] = 0 })
      counts?.forEach(p => { if (p.team_id) memberCounts[p.team_id] = (memberCounts[p.team_id] ?? 0) + 1 })
      teamId = teams.reduce((min, t) => memberCounts[t.id] < memberCounts[min.id] ? t : min).id
    }
  }

  const { data: existingPlayers } = await supabase
    .from('players')
    .select('nickname')
    .eq('game_id', game.id)

  const taken = new Set((existingPlayers || []).map(p => p.nickname.toLowerCase()))
  if (taken.has(requestedNickname.toLowerCase())) {
    return NextResponse.json(
      { success: false, error: 'That nickname is taken — try another' },
      { status: 409 },
    )
  }

  const { data: player, error } = await supabase
    .from('players')
    .insert({ game_id: game.id, nickname: requestedNickname, score: 0, team_id: teamId })
    .select()
    .single()

  if (!player) {
    // 23505 is a unique-violation: someone claimed the name between the check and the insert.
    const message = error?.code === '23505'
      ? 'That nickname is taken — try another'
      : error?.message || 'Failed to join'
    return NextResponse.json({ success: false, error: message }, { status: error?.code === '23505' ? 409 : 500 })
  }

  return NextResponse.json({ success: true, gameId: game.id, playerId: player.id, nickname: player.nickname })
}
