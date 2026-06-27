import { NextRequest, NextResponse } from 'next/server'
import { verifyHostPassword, makeHostToken } from '@/lib/require-host'

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  if (typeof password !== 'string' || !verifyHostPassword(password)) {
    return NextResponse.json({ success: false, error: 'Incorrect password' }, { status: 401 })
  }
  return NextResponse.json({ success: true, token: makeHostToken() })
}
