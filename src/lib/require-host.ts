import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// HOST_PASSWORD is server-only (no NEXT_PUBLIC_ prefix) — never shipped to the client bundle.
const SECRET = process.env.HOST_PASSWORD || 'teacher'

/** Deterministic token derived from the server-only secret. Never sent to the client except after a verified login. */
export function makeHostToken(): string {
  return crypto.createHmac('sha256', SECRET).update('kawahoot-host').digest('hex')
}

export function verifyHostPassword(password: string): boolean {
  return password === SECRET
}

/** Returns a 401 response if the request lacks a valid host token, otherwise null. */
export function requireHost(req: NextRequest): NextResponse | null {
  const token = req.headers.get('x-host-token') || ''
  const expected = makeHostToken()
  const valid = token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  if (!valid) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
