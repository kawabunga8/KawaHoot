import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const TEACHER_DOMAIN = '@myrcs.ca'

/**
 * Returns a 401 response if the request isn't from an authenticated @myrcs.ca
 * teacher, otherwise null. Real auth — the Supabase session cookie set by
 * middleware.ts, not a shared password — so this can no longer be bypassed
 * by reading a value out of the public JS bundle.
 */
export async function requireHost(req: NextRequest): Promise<NextResponse | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email?.toLowerCase().endsWith(TEACHER_DOMAIN)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
