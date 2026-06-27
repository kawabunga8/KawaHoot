import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const { pin } = await req.json()
  if (!pin) {
    return NextResponse.json({ success: false, error: 'Missing pin' }, { status: 400 })
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

  // Guests are auto-named Guest1, Guest2, ... — find the next free number in this game.
  const { data: existingGuests } = await supabase
    .from('players')
    .select('nickname')
    .eq('game_id', game.id)
    .ilike('nickname', 'Guest%')

  const taken = new Set((existingGuests || []).map(p => p.nickname))
  let nextNum = 1
  for (const p of existingGuests || []) {
    const m = /^Guest(\d+)$/.exec(p.nickname)
    if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1)
  }

  let player = null
  let lastError = null
  for (let attempt = 0; attempt < 10 && !player; attempt++) {
    const candidate = `Guest${nextNum + attempt}`
    if (taken.has(candidate)) continue
    const { data, error } = await supabase
      .from('players')
      .insert({ game_id: game.id, nickname: candidate, score: 0, team_id: teamId })
      .select()
      .single()
    if (data) { player = data; break }
    lastError = error
    if (error?.code !== '23505') break // not a name-uniqueness collision — stop retrying
  }

  if (!player) {
    return NextResponse.json({ success: false, error: lastError?.message || 'Failed to join' }, { status: 500 })
  }

  return NextResponse.json({ success: true, gameId: game.id, playerId: player.id, nickname: player.nickname })
}
