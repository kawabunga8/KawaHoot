'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const TRACKS = [
  {
    name: 'Quiz Time',
    artist: 'Kawahoot',
    src: 'https://cdn.pixabay.com/audio/2024/11/05/audio_4a8cc3e6f7.mp3',
    emoji: '🎯',
  },
  {
    name: 'Game On',
    artist: 'Kawahoot',
    src: 'https://cdn.pixabay.com/audio/2024/03/14/audio_a0d001b58d.mp3',
    emoji: '🎮',
  },
  {
    name: 'Think Fast',
    artist: 'Kawahoot',
    src: 'https://cdn.pixabay.com/audio/2023/06/14/audio_6f1f3c1d35.mp3',
    emoji: '⚡',
  },
  {
    name: 'Winner Takes All',
    artist: 'Kawahoot',
    src: 'https://cdn.pixabay.com/audio/2024/02/28/audio_b74a54a28e.mp3',
    emoji: '🏆',
  },
]

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [trackIndex, setTrackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(0.35)
  const [isMinimized, setIsMinimized] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  const track = TRACKS[trackIndex]

  // Init audio element once
  useEffect(() => {
    const audio = new Audio()
    audio.loop = false
    audio.volume = volume
    audio.preload = 'none'
    audioRef.current = audio

    audio.addEventListener('ended', () => {
      setTrackIndex(i => (i + 1) % TRACKS.length)
    })
    audio.addEventListener('canplay', () => setIsLoading(false))
    audio.addEventListener('waiting', () => setIsLoading(true))

    return () => { audio.pause(); audio.src = '' }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update src when track changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const wasPlaying = isPlaying
    audio.pause()
    audio.src = TRACKS[trackIndex].src
    audio.load()
    if (wasPlaying) {
      setIsLoading(true)
      audio.play().catch(() => setIsPlaying(false))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIndex])

  // Sync volume
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
      if (!audio.src) {
        audio.src = TRACKS[trackIndex].src
        audio.load()
      }
      setIsLoading(true)
      try {
        await audio.play()
        setIsPlaying(true)
      } catch {
        setIsPlaying(false)
      }
    }
  }, [isPlaying, trackIndex])

  const nextTrack = useCallback(() => {
    setTrackIndex(i => (i + 1) % TRACKS.length)
  }, [])

  const prevTrack = useCallback(() => {
    setTrackIndex(i => (i - 1 + TRACKS.length) % TRACKS.length)
  }, [])

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`bg-kawaDark/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl transition-all duration-300 overflow-hidden ${
          isMinimized ? 'w-14 h-14' : 'w-72'
        }`}
      >
        {isMinimized ? (
          <button
            onClick={() => setIsMinimized(false)}
            className="w-full h-full flex items-center justify-center rounded-2xl hover:bg-white/10 transition-colors group relative"
            title="Open music player"
          >
            <span className="text-xl">{isPlaying ? '🎵' : '🎶'}</span>
            {isPlaying && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-kawaGreen animate-pulse" />
            )}
          </button>
        ) : (
          <div className="p-4">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-base">🎵</span>
                <span className="text-white font-bold text-sm" style={{ fontFamily: "'Fredoka One', cursive" }}>
                  Music
                </span>
                {isPlaying && (
                  <div className="flex gap-0.5 items-end h-3">
                    {[1, 2, 3].map(i => (
                      <div
                        key={i}
                        className="w-0.5 bg-kawaGreen rounded-full animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s`, height: `${6 + i * 3}px` }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setIsMinimized(true)}
                className="text-white/30 hover:text-white/70 text-lg leading-none transition-colors w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10"
              >
                ×
              </button>
            </div>

            {/* Track info */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-4 text-center">
              <div className="text-2xl mb-1">{track.emoji}</div>
              <p className="text-white font-bold text-sm truncate">{track.name}</p>
              <p className="text-white/40 text-xs mt-0.5">
                Track {trackIndex + 1} of {TRACKS.length}
              </p>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                onClick={prevTrack}
                className="text-white/50 hover:text-white transition-colors text-base w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10"
              >
                ⏮
              </button>
              <button
                onClick={togglePlay}
                disabled={isLoading}
                className="w-11 h-11 bg-kawaYellow hover:bg-yellow-400 disabled:opacity-60 text-kawaDark rounded-full flex items-center justify-center text-lg font-bold transition-all hover:scale-110 active:scale-95 shadow-lg shadow-kawaYellow/30"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-kawaDark border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? '⏸' : '▶'}
              </button>
              <button
                onClick={nextTrack}
                className="text-white/50 hover:text-white transition-colors text-base w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10"
              >
                ⏭
              </button>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setVolume(v => v === 0 ? 0.35 : 0)}
                className="text-base w-6 flex-shrink-0 text-center"
                title={volume === 0 ? 'Unmute' : 'Mute'}
              >
                {volume === 0 ? '🔇' : volume < 0.4 ? '🔉' : '🔊'}
              </button>
              <div className="flex-1 relative h-5 flex items-center">
                <div className="absolute inset-x-0 h-1.5 bg-white/15 rounded-full" />
                <div
                  className="absolute left-0 h-1.5 bg-kawaYellow rounded-full pointer-events-none"
                  style={{ width: `${volume * 100}%` }}
                />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
                />
              </div>
              <span className="text-white/30 text-xs w-7 text-right flex-shrink-0">
                {Math.round(volume * 100)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
