import { createBrowserClient } from '@supabase/ssr'
import { AUTH_COOKIE_OPTIONS } from './cookie'
import { GAME_HEADER } from './game-header'

// Pass gameId on pages that play or show one game. Players have no session, so the
// database only lets them read the game named in this header (see
// 20260927120000_scope_game_reads_to_one_game.sql); without it, anonymous reads of
// games, players, teams and answers return nothing.
export function createClient(gameId?: string) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    gameId
      ? { cookieOptions: AUTH_COOKIE_OPTIONS, isSingleton: false, global: { headers: { [GAME_HEADER]: gameId } } }
      : { cookieOptions: AUTH_COOKIE_OPTIONS }
  )
}
