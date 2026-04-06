'use client'

import { useState, FormEvent } from 'react'
import { useHostAuth } from '@/lib/host-auth'

export default function HostGate({ children }: { children: React.ReactNode }) {
  const { authed, checked, login } = useHostAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [shaking, setShaking] = useState(false)

  if (!checked) return null // avoid flash before sessionStorage is read

  if (authed) return <>{children}</>

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (login(password)) {
      setError(false)
    } else {
      setError(true)
      setShaking(true)
      setTimeout(() => setShaking(false), 500)
      setPassword('')
    }
  }

  return (
    <div className="min-h-screen bg-kawaDark flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <span className="text-5xl font-bold" style={{ fontFamily: "'Fredoka One', cursive" }}>
            <span className="text-white">Kawa</span>
            <span className="text-kawaYellow">hoot</span>
            <span className="text-kawaCoral">!</span>
          </span>
          <p className="text-white/50 mt-2 text-sm">Teacher access required</p>
        </div>

        <form onSubmit={handleSubmit} className={`space-y-4 ${shaking ? 'animate-wiggle' : ''}`}>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(false) }}
            placeholder="Enter teacher password"
            autoFocus
            className={`w-full bg-white/10 border-2 rounded-2xl px-5 py-4 text-white text-lg placeholder:text-white/30 focus:outline-none transition-colors
              ${error ? 'border-kawared' : 'border-white/20 focus:border-kawaYellow'}`}
            style={{ fontFamily: "'Fredoka One', cursive" }}
          />
          {error && (
            <p className="text-kawared text-sm text-center font-semibold">
              Incorrect password
            </p>
          )}
          <button
            type="submit"
            className="w-full bg-kawaPurple hover:bg-purple-600 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          >
            Enter →
          </button>
        </form>
      </div>
    </div>
  )
}
