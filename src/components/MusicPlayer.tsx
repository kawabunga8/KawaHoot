'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(0.4)
  const [isMinimized, setIsMinimized] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const audio = new Audio('/music/little-blue.m4a')
    audio.loop = true
    audio.volume = volume
    audio.preload = 'metadata'

    audio.addEventListener('canplay', () => setIsLoading(false))
    audio.addEventListener('waiting', () => setIsLoading(true))
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration))
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime))
    audio.addEventListener('ended', () => setIsPlaying(false))

    audioRef.current = audio
    return () => { audio.pause(); audio.src = '' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      setIsLoading(true)
      try {
        await audio.play()
        setIsPlaying(true)
      } catch {
        setIsPlaying(false)
        setIsLoading(false)
      }
    }
  }, [isPlaying])

  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = parseFloat(e.target.value)
    setCurrentTime(audio.currentTime)
  }

  function fmt(s: number) {
    if (!isFinite(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className="bg-kawaDark/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300"
        style={{ width: isMinimized ? 56 : 272 }}
      >
        {isMinimized ? (
          <button
            onClick={() => setIsMinimized(false)}
            className="w-14 h-14 flex items-center justify-center rounded-2xl hover:bg-white/10 transition-colors relative"
            title="Open music player"
          >
            <span className="text-xl">{isPlaying ? '🎵' : '🎶'}</span>
            {isPlaying && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-kawaGreen animate-pulse" />
            )}
          </button>
        ) : (
          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">🎵</span>
                <span className="text-white font-bold text-sm" style={{ fontFamily: "'Fredoka One', cursive" }}>
                  Music
                </span>
                {isPlaying && (
                  <div className="flex gap-px items-end h-3">
                    {[4, 7, 5].map((h, i) => (
                      <div key={i} className="w-0.5 bg-kawaGreen rounded-full animate-bounce"
                        style={{ height: h, animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setIsMinimized(true)}
                className="text-white/30 hover:text-white/60 text-xl leading-none transition-colors w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10"
              >×</button>
            </div>

            {/* Track info */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-3">
              <p className="text-white font-bold text-sm truncate">Little Blue</p>
              <p className="text-white/40 text-xs mt-0.5 truncate">Jacob Collier feat. Brandi Carlile</p>
            </div>

            {/* Seek bar */}
            {duration > 0 && (
              <div className="mb-3">
                <div className="relative h-5 flex items-center group">
                  <div className="absolute inset-x-0 h-1 bg-white/15 rounded-full" />
                  <div
                    className="absolute left-0 h-1 bg-kawaYellow rounded-full pointer-events-none"
                    style={{ width: `${(currentTime / duration) * 100}%` }}
                  />
                  <input type="range" min="0" max={duration} step="1" value={currentTime}
                    onChange={seek}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" />
                </div>
                <div className="flex justify-between text-white/30 text-xs mt-1">
                  <span>{fmt(currentTime)}</span>
                  <span>{fmt(duration)}</span>
                </div>
              </div>
            )}

            {/* Play button */}
            <div className="flex justify-center mb-3">
              <button
                onClick={togglePlay}
                disabled={isLoading}
                className="w-12 h-12 bg-kawaYellow hover:bg-yellow-400 disabled:opacity-60 text-kawaDark rounded-full flex items-center justify-center text-xl font-bold transition-all hover:scale-110 active:scale-95 shadow-lg shadow-kawaYellow/30"
              >
                {isLoading
                  ? <div className="w-4 h-4 border-2 border-kawaDark border-t-transparent rounded-full animate-spin" />
                  : isPlaying ? '⏸' : '▶'}
              </button>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setVolume(v => v === 0 ? 0.4 : 0)}
                className="text-sm w-5 flex-shrink-0 text-center"
              >
                {volume === 0 ? '🔇' : volume < 0.45 ? '🔉' : '🔊'}
              </button>
              <div className="flex-1 relative h-5 flex items-center">
                <div className="absolute inset-x-0 h-1.5 bg-white/15 rounded-full" />
                <div className="absolute left-0 h-1.5 bg-kawaYellow rounded-full pointer-events-none"
                  style={{ width: `${volume * 100}%` }} />
                <input type="range" min="0" max="1" step="0.02" value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" />
              </div>
              <span className="text-white/30 text-xs w-6 text-right flex-shrink-0">
                {Math.round(volume * 100)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
