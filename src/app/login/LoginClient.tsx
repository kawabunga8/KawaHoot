'use client'

import { FormEvent, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const raw = sp.get('next') || '/host'
  const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/host'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setStatus('working'); setError(null)
    try {
      const { error } = await createClient().auth.signInWithPassword({ email, password })
      if (error) throw error
      router.push(next)
    } catch (err: any) {
      setStatus('error'); setError(err?.message ?? 'Sign-in failed')
    }
  }

  return (
    <main className="min-h-screen bg-kawaDark flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <span className="text-5xl font-bold" style={{ fontFamily: "'Fredoka One', cursive" }}>
            <span className="text-white">Kawa</span>
            <span className="text-kawaYellow">hoot</span>
            <span className="text-kawaCoral">!</span>
          </span>
          <p className="text-white/50 mt-2 text-sm">Teacher sign-in</p>
        </div>

        <form onSubmit={signIn} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@myrcs.ca"
            autoFocus
            required
            className="w-full bg-white/10 border-2 border-white/20 rounded-2xl px-5 py-4 text-white text-lg placeholder:text-white/30 focus:outline-none focus:border-kawaYellow transition-colors"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="w-full bg-white/10 border-2 border-white/20 rounded-2xl px-5 py-4 text-white text-lg placeholder:text-white/30 focus:outline-none focus:border-kawaYellow transition-colors"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          />
          {error && (
            <p className="text-kawared text-sm text-center font-semibold">{error}</p>
          )}
          <button
            type="submit"
            disabled={status === 'working'}
            className="w-full bg-kawaPurple hover:bg-purple-600 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          >
            {status === 'working' ? 'Signing in...' : 'Sign In →'}
          </button>
        </form>
        <p className="text-white/30 text-xs text-center mt-6">
          Same account as TOC-Dayplans / Student Hub / Report Card Tool.
        </p>
      </div>
    </main>
  )
}
