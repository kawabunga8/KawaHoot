import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const STUDENT_DOMAIN = '@rcseagles.ca'
const COURSE_HUB_URL = process.env.COURSE_HUB_URL!
const COURSE_HUB_API_KEY = process.env.COURSE_HUB_API_KEY!

type HubStudent = { id: string; first_name: string; last_name: string; email: string | null }

// Course Hub owns student records (they live in the shared project, not in
// KawaHoot's own database), so the email -> student match asks its API.
async function findStudentByEmail(email: string): Promise<HubStudent | null> {
  try {
    const res = await fetch(`${COURSE_HUB_URL}/api/students?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${COURSE_HUB_API_KEY}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const students = (await res.json()) as HubStudent[]
    // Exact match here too, so an older Course Hub that ignores ?email= (and
    // returns everyone) can never hand back the wrong student.
    const matches = students.filter(s => s.email?.toLowerCase() === email.toLowerCase())
    return matches.length === 1 ? matches[0] : null
  } catch {
    return null
  }
}

/**
 * Called right after a student signs in on the join page, while the session
 * still exists. The email is taken from the verified session (the access token
 * is checked with Supabase Auth), never from the request body, so a player
 * cannot claim someone else by typing their address.
 *
 * The student is matched in Course Hub, then to a pre-registered, unclaimed
 * player row in this game (players.student_id). That row is marked
 * identity_verified. If there is no roster match (wrong domain, not enrolled,
 * roster never imported for this game) the student joins as a Guest, so
 * nobody is ever blocked from playing.
 */
export async function POST(req: NextRequest) {
  const { gameId, accessToken } = await req.json()
  if (!gameId || !accessToken) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: { user } } = await admin.auth.getUser(accessToken)
  const email = user?.email
  if (!email) {
    return NextResponse.json({ success: false, error: 'Sign-in could not be verified' }, { status: 401 })
  }

  const { data: game } = await admin
    .from('games')
    .select('id, mode')
    .eq('id', gameId)
    .in('status', ['waiting', 'question', 'answer_reveal', 'leaderboard'])
    .single()
  if (!game) {
    return NextResponse.json({ success: false, error: 'Game not found' }, { status: 404 })
  }

  let claimed: { id: string; nickname: string } | null = null

  if (email.toLowerCase().endsWith(STUDENT_DOMAIN)) {
    const student = await findStudentByEmail(email)

    if (student) {
      const { data: rosterPlayer } = await admin
        .from('players')
        .select('id')
        .eq('game_id', gameId)
        .eq('student_id', student.id)
        .eq('is_pre_registered', true)
        .eq('is_claimed', false)
        .single()

      if (rosterPlayer) {
        const realName = `${student.first_name} ${student.last_name}`.trim()
        const { data: updated, error } = await admin
          .from('players')
          .update({ is_claimed: true, identity_verified: true, nickname: realName, real_name: realName })
          .eq('id', rosterPlayer.id)
          .select('id, nickname')
          .single()
        if (error) {
          return NextResponse.json({ success: false, error: error.message }, { status: 500 })
        }
        claimed = updated
      }
    }
  }

  if (claimed) {
    return NextResponse.json({ success: true, gameId, playerId: claimed.id, nickname: claimed.nickname, claimed: true })
  }

  // No roster match (wrong domain, not enrolled, or no class imported) — join as a guest instead.
  const { data: existingGuests } = await admin
    .from('players')
    .select('nickname')
    .eq('game_id', gameId)
    .ilike('nickname', 'Guest%')

  const taken = new Set((existingGuests || []).map(p => p.nickname))
  let nextNum = 1
  for (const p of existingGuests || []) {
    const m = /^Guest(\d+)$/.exec(p.nickname)
    if (m) nextNum = Math.max(nextNum, parseInt(m[1], 10) + 1)
  }

  let teamId: string | null = null
  if (game.mode === 'teams') {
    const { data: teams } = await admin.from('teams').select('id').eq('game_id', gameId)
    if (teams && teams.length > 0) {
      const { data: counts } = await admin
        .from('players').select('team_id').eq('game_id', gameId).not('team_id', 'is', null)
      const memberCounts: Record<string, number> = {}
      teams.forEach(t => { memberCounts[t.id] = 0 })
      counts?.forEach(p => { if (p.team_id) memberCounts[p.team_id] = (memberCounts[p.team_id] ?? 0) + 1 })
      teamId = teams.reduce((min, t) => memberCounts[t.id] < memberCounts[min.id] ? t : min).id
    }
  }

  let guest: { id: string; nickname: string } | null = null
  let lastError: { message: string } | null = null
  for (let attempt = 0; attempt < 10 && !guest; attempt++) {
    const candidate = `Guest${nextNum + attempt}`
    if (taken.has(candidate)) continue
    const { data, error } = await admin
      .from('players')
      .insert({ game_id: gameId, nickname: candidate, score: 0, team_id: teamId })
      .select('id, nickname')
      .single()
    if (data) { guest = data; break }
    lastError = error
    if (error?.code !== '23505') break
  }

  if (!guest) {
    return NextResponse.json({ success: false, error: lastError?.message || 'Failed to join' }, { status: 500 })
  }

  return NextResponse.json({ success: true, gameId, playerId: guest.id, nickname: guest.nickname, claimed: false })
}
