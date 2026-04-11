import { NextRequest, NextResponse } from 'next/server'

/** Returns a 401 response if the request lacks valid host auth, otherwise null. */
export function requireHost(req: NextRequest): NextResponse | null {
  const password = req.headers.get('x-host-password')
  const expected = process.env.NEXT_PUBLIC_HOST_PASSWORD || 'teacher'
  if (password !== expected) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
