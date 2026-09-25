import { createBrowserClient } from '@supabase/ssr'
import { AUTH_COOKIE_OPTIONS } from './cookie'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    { cookieOptions: AUTH_COOKIE_OPTIONS }
  )
}
