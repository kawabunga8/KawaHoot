import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePin } from '@/lib/game-utils'
import { requireHost } from '@/lib/require-host'

/** Shuffle the 4 options of a question, updating correct_answer to match */
function shuffleOptions(q: {
  question_text: string; option_a: string; option_b: string
  option_c: string; option_d: string; correct_answer: string
  time_limit: number; order_index: number
}) {
  const opts = [
    { key: 'A', text: q.option_a },
    { key: 'B', text: q.option_b },
    { key: 'C', text: q.option_c },
    { key: 'D', text: q.option_d },
  ]
  // Fisher-Yates shuffle
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]]
  }
  const correctText = q[`option_${q.correct_answer.toLowerCase()}` as 'option_a' | 'option_b' | 'option_c' | 'option_d']
  const newCorrectKey = opts.find(o => o.text === correctText)!.key
  return {
    question_text: q.question_text,
    option_a: opts[0].text,
    option_b: opts[1].text,
    option_c: opts[2].text,
    option_d: opts[3].text,
    correct_answer: newCorrectKey,
    time_limit: q.time_limit,
    order_index: q.order_index,
  }
}

export async function POST(req: NextRequest) {
  const auth = requireHost(req)
  if (auth) return auth

  const { gameId } = await req.json()
  const supabase = await createClient()

  const { data: original } = await supabase.from('games').select('title, mode').eq('id', gameId).single()
  const { data: questions } = await supabase
    .from('quiz_questions').select('*').eq('game_id', gameId).order('order_index')
  const { data: oldPlayers } = await supabase
    .from('players').select('*').eq('game_id', gameId)
  const { data: oldTeams } = await supabase
    .from('teams').select('*').eq('game_id', gameId)

  if (!original || !questions?.length) {
    return NextResponse.json({ success: false, error: 'Game not found' }, { status: 404 })
  }

  // Unique PIN
  let pin = generatePin()
  for (let i = 0; i < 10; i++) {
    const { data } = await supabase.from('games').select('id').eq('pin', pin).single()
    if (!data) break
    pin = generatePin()
  }

  // Create new game (preserve mode)
  const { data: newGame, error } = await supabase
    .from('games')
    .insert({ pin, title: original.title, status: 'waiting', current_question_index: -1, mode: original.mode || 'individual' })
    .select().single()

  if (error || !newGame) {
    return NextResponse.json({ success: false, error: 'Failed to create game' }, { status: 500 })
  }

  // Copy questions with shuffled options
  await supabase.from('quiz_questions').insert(
    questions.map(q => ({ game_id: newGame.id, ...shuffleOptions(q) }))
  )

  // Copy teams and build old→new team ID map
  const teamMap: Record<string, string> = {}
  if (oldTeams?.length) {
    const { data: newTeams } = await supabase
      .from('teams')
      .insert(oldTeams.map(t => ({ game_id: newGame.id, name: t.name, color: t.color })))
      .select()
    newTeams?.forEach((nt, i) => {
      if (oldTeams[i]) teamMap[oldTeams[i].id] = nt.id
    })
  }

  // Copy players (scores reset to 0), preserving team assignments and pre-registration state
  const playerMap: Record<string, string> = {}
  if (oldPlayers?.length) {
    const { data: newPlayers } = await supabase
      .from('players')
      .insert(oldPlayers.map(p => ({
        game_id: newGame.id,
        nickname: p.nickname,
        score: 0,
        team_id: p.team_id ? (teamMap[p.team_id] ?? null) : null,
        is_pre_registered: p.is_pre_registered ?? false,
        is_claimed: false, // reset claims for the new game
      })))
      .select()
    newPlayers?.forEach((np, i) => {
      if (oldPlayers[i]) playerMap[oldPlayers[i].id] = np.id
    })
  }

  // Point old game to new game so player screens auto-follow
  await supabase.from('games').update({ next_game_id: newGame.id }).eq('id', gameId)

  return NextResponse.json({ success: true, gameId: newGame.id, pin: newGame.pin, playerMap })
}
