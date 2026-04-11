'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [nickname, setNickname] = useState('')
  const [step, setStep] = useState<'pin' | 'roster' | 'nickname' | 'guest'>('pin')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [gameId, setGameId] = useState('')
  const [roster, setRoster] = useState<{ id: string; nickname: string }[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: string; nickname: string } | null>(null)

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (pin.length !== 6) {
      setError('PIN must be 6 digits')
      return
    }
    setLoading(true)
    const res = await fetch(`/api/game/verify-pin?pin=${pin}`)
    const data = await res.json()
    setLoading(false)
    if (!data.valid) {
      setError('Game not found. Check your PIN!')
      return
    }
    setGameId(data.gameId)
    setRoster(data.roster || [])
    setStep('roster') // always show roster step — player must pick a name or explicitly choose guest
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!nickname.trim()) {
      setError('Enter a nickname!')
      return
    }
    setLoading(true)
    const res = await fetch('/api/game/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, nickname: nickname.trim() }),
    })
    const data = await res.json()
    setLoading(false)
    if (!data.success) {
      setError(data.error || 'Failed to join')
      return
    }
    router.push(`/play/${data.gameId}?playerId=${data.playerId}`)
  }

  return (
    <main className="min-h-screen bg-kawaDark relative overflow-hidden flex flex-col items-center justify-center px-4">
      {/* Animated background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-96 h-96 bg-kawaPurple/30 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-[-20%] right-[-10%] w-80 h-80 bg-kawaCoral/20 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-[40%] right-[20%] w-64 h-64 bg-kawaYellow/10 rounded-full blur-2xl animate-float" style={{ animationDelay: '3s' }} />
        {['▲', '◆', '●', '■', '▲', '◆'].map((shape, i) => (
          <div
            key={i}
            className="absolute text-2xl opacity-10 animate-float select-none"
            style={{
              left: `${10 + i * 16}%`,
              top: `${15 + (i % 3) * 25}%`,
              animationDelay: `${i * 0.8}s`,
              color: ['#EF4444','#3B82F6','#F59E0B','#22C55E','#F97316','#7C3AED'][i],
            }}
          >
            {shape}
          </div>
        ))}
      </div>

      {/* Logo */}
      <div className="relative z-10 text-center mb-8 animate-bounce-in">
        <h1
          className="text-7xl md:text-8xl font-bold tracking-tight mb-2"
          style={{ fontFamily: "'Fredoka One', cursive" }}
        >
          <span className="text-white">Kawa</span>
          <span className="text-kawaYellow">hoot</span>
          <span className="text-kawaCoral">!</span>
        </h1>
        <p className="text-purple-300 text-lg font-semibold">
          The classroom quiz game that hits different 🎯
        </p>
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-md">
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl p-8 shadow-2xl">
          {step === 'pin' ? (
            <form onSubmit={handlePinSubmit} className="space-y-5">
              <h2
                className="text-2xl font-bold text-center text-white"
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                Join a Game
              </h2>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 6-digit PIN"
                className="w-full bg-white/10 border-2 border-white/30 rounded-2xl px-5 py-4 text-center text-3xl font-bold tracking-[0.5em] text-white placeholder:text-white/40 placeholder:text-lg placeholder:tracking-normal focus:outline-none focus:border-kawaYellow transition-colors"
              />
              {error && (
                <p className="text-kawared text-center font-bold animate-wiggle">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-kawaYellow hover:bg-yellow-400 disabled:opacity-50 text-kawaDark font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg"
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                {loading ? 'Checking...' : 'Find Game →'}
              </button>
            </form>
          ) : step === 'roster' ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setStep('pin')}
                className="text-purple-300 hover:text-white text-sm flex items-center gap-1 transition-colors"
              >
                ← PIN: {pin}
              </button>
              <h2
                className="text-2xl font-bold text-center text-white"
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                Who are you?
              </h2>
              {roster.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                  {roster.map(r => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setSelectedPlayer(r)
                        setNickname(r.nickname)
                        setStep('nickname')
                      }}
                      className="bg-kawaPurple/40 border border-kawaPurple hover:bg-kawaPurple text-white font-bold py-3 px-3 rounded-xl transition-all hover:scale-105 active:scale-95 text-sm truncate"
                      style={{ fontFamily: "'Fredoka One', cursive" }}
                    >
                      {r.nickname}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-white/40 text-sm text-center py-4">No class list loaded by your teacher.</p>
              )}
              <div className="pt-1 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setStep('guest')}
                  className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white/70 hover:text-white font-bold py-3 rounded-xl transition-all text-sm"
                  style={{ fontFamily: "'Fredoka One', cursive" }}
                >
                  🙋 Join as Guest
                </button>
              </div>
            </div>
          ) : step === 'nickname' ? (
            // Only reachable from roster step with a selected player — selectedPlayer must be set
            selectedPlayer ? (
              <form onSubmit={async (e) => {
                e.preventDefault()
                setError('')
                if (!nickname.trim()) { setError('Enter a nickname!'); return }
                setLoading(true)
                await fetch('/api/game/claim-player', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ gameId, playerId: selectedPlayer.id, nickname: nickname.trim(), realName: selectedPlayer.nickname }),
                })
                setLoading(false)
                router.push(`/play/${gameId}?playerId=${selectedPlayer.id}`)
              }} className="space-y-5">
                <button type="button" onClick={() => { setSelectedPlayer(null); setStep('roster') }}
                  className="text-purple-300 hover:text-white text-sm flex items-center gap-1 transition-colors">
                  ← Back to class list
                </button>
                <h2 className="text-2xl font-bold text-center text-white" style={{ fontFamily: "'Fredoka One', cursive" }}>
                  Choose Your Nickname
                </h2>
                <p className="text-white/50 text-sm text-center -mt-2">
                  Playing as <span className="text-kawaYellow font-bold">{selectedPlayer.nickname}</span>
                </p>
                <input type="text" maxLength={20} value={nickname} onChange={e => setNickname(e.target.value)}
                  placeholder="e.g. QuizWizard99" autoFocus
                  className="w-full bg-white/10 border-2 border-white/30 rounded-2xl px-5 py-4 text-center text-xl font-bold text-white placeholder:text-white/40 focus:outline-none focus:border-kawaCoral transition-colors"
                />
                {error && <p className="text-kawared text-center font-bold animate-wiggle">{error}</p>}
                <button type="submit" disabled={loading}
                  className="w-full bg-kawaGreen hover:bg-green-400 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg"
                  style={{ fontFamily: "'Fredoka One', cursive" }}>
                  {loading ? 'Joining...' : "Let's Go! 🚀"}
                </button>
              </form>
            ) : (
              // selectedPlayer somehow null — bounce back to roster
              <>{setStep('roster')}</>
            )
          ) : step === 'guest' ? (
            // Only reachable from roster step via explicit "Join as Guest" button
            <form onSubmit={handleJoin} className="space-y-5">
              <button type="button" onClick={() => setStep('roster')}
                className="text-purple-300 hover:text-white text-sm flex items-center gap-1 transition-colors">
                ← Back to class list
              </button>
              <h2 className="text-2xl font-bold text-center text-white" style={{ fontFamily: "'Fredoka One', cursive" }}>
                Join as Guest
              </h2>
              <p className="text-white/50 text-sm text-center -mt-2">Not on the class list? Enter any name to join.</p>
              <input type="text" maxLength={20} value={nickname} onChange={e => setNickname(e.target.value)}
                placeholder="Your name or nickname" autoFocus
                className="w-full bg-white/10 border-2 border-white/30 rounded-2xl px-5 py-4 text-center text-xl font-bold text-white placeholder:text-white/40 focus:outline-none focus:border-kawaCoral transition-colors"
              />
              {error && <p className="text-kawared text-center font-bold animate-wiggle">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full bg-kawaGreen hover:bg-green-400 disabled:opacity-50 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg"
                style={{ fontFamily: "'Fredoka One', cursive" }}>
                {loading ? 'Joining...' : "Let's Go! 🚀"}
              </button>
            </form>
          ) : null}
        </div>

        <div className="flex items-center gap-4 my-6">
          <div className="flex-1 h-px bg-white/20" />
          <span className="text-white/40 text-sm">or</span>
          <div className="flex-1 h-px bg-white/20" />
        </div>

        <Link
          href="/host"
          className="block w-full bg-kawaPurple hover:bg-purple-600 text-white font-bold text-xl py-4 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-lg text-center"
          style={{ fontFamily: "'Fredoka One', cursive" }}
        >
          🎓 I&apos;m a Teacher — Host a Game
        </Link>
      </div>

      <p className="relative z-10 mt-8 text-white/30 text-sm">
        No account needed to join • Works on any device
      </p>
    </main>
  )
}
