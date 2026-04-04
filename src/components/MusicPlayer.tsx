'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Procedural game music engine (Web Audio API — no external files needed)
// ---------------------------------------------------------------------------

type NoteEvent = { time: number; freq: number; dur: number; gain: number }

const SONGS: { name: string; emoji: string; bpm: number; notes: NoteEvent[] }[] = (() => {
  // Helper: convert semitones above A4 (440Hz) to frequency
  const n = (semitones: number) => 440 * Math.pow(2, semitones / 12)

  // Song 1 — "Quiz Time" upbeat looping melody
  const quizNotes: NoteEvent[] = [
    { time: 0.00, freq: n(0),  dur: 0.18, gain: 0.18 },
    { time: 0.25, freq: n(3),  dur: 0.18, gain: 0.18 },
    { time: 0.50, freq: n(5),  dur: 0.18, gain: 0.18 },
    { time: 0.75, freq: n(7),  dur: 0.35, gain: 0.22 },
    { time: 1.00, freq: n(5),  dur: 0.18, gain: 0.18 },
    { time: 1.25, freq: n(3),  dur: 0.18, gain: 0.18 },
    { time: 1.50, freq: n(0),  dur: 0.18, gain: 0.18 },
    { time: 1.75, freq: n(-2), dur: 0.35, gain: 0.22 },
    { time: 2.00, freq: n(3),  dur: 0.18, gain: 0.18 },
    { time: 2.25, freq: n(7),  dur: 0.18, gain: 0.18 },
    { time: 2.50, freq: n(10), dur: 0.18, gain: 0.18 },
    { time: 2.75, freq: n(12), dur: 0.35, gain: 0.25 },
    { time: 3.00, freq: n(10), dur: 0.18, gain: 0.18 },
    { time: 3.25, freq: n(7),  dur: 0.18, gain: 0.18 },
    { time: 3.50, freq: n(5),  dur: 0.18, gain: 0.18 },
    { time: 3.75, freq: n(3),  dur: 0.35, gain: 0.22 },
  ]

  // Song 2 — "Think Fast" faster, punchier
  const thinkNotes: NoteEvent[] = [
    { time: 0.00, freq: n(0),  dur: 0.12, gain: 0.22 },
    { time: 0.15, freq: n(5),  dur: 0.12, gain: 0.20 },
    { time: 0.30, freq: n(7),  dur: 0.12, gain: 0.20 },
    { time: 0.45, freq: n(12), dur: 0.25, gain: 0.25 },
    { time: 0.75, freq: n(10), dur: 0.12, gain: 0.20 },
    { time: 0.90, freq: n(7),  dur: 0.12, gain: 0.20 },
    { time: 1.05, freq: n(5),  dur: 0.12, gain: 0.20 },
    { time: 1.20, freq: n(3),  dur: 0.25, gain: 0.22 },
    { time: 1.50, freq: n(3),  dur: 0.12, gain: 0.20 },
    { time: 1.65, freq: n(7),  dur: 0.12, gain: 0.20 },
    { time: 1.80, freq: n(10), dur: 0.12, gain: 0.20 },
    { time: 1.95, freq: n(14), dur: 0.30, gain: 0.28 },
    { time: 2.30, freq: n(12), dur: 0.12, gain: 0.22 },
    { time: 2.45, freq: n(10), dur: 0.12, gain: 0.20 },
    { time: 2.60, freq: n(7),  dur: 0.12, gain: 0.20 },
    { time: 2.75, freq: n(5),  dur: 0.40, gain: 0.25 },
  ]

  // Song 3 — "Winners" triumphant, slightly lower tempo
  const winNotes: NoteEvent[] = [
    { time: 0.00, freq: n(-5), dur: 0.22, gain: 0.22 },
    { time: 0.30, freq: n(0),  dur: 0.22, gain: 0.22 },
    { time: 0.60, freq: n(4),  dur: 0.22, gain: 0.22 },
    { time: 0.90, freq: n(7),  dur: 0.40, gain: 0.28 },
    { time: 1.40, freq: n(9),  dur: 0.22, gain: 0.24 },
    { time: 1.70, freq: n(12), dur: 0.40, gain: 0.30 },
    { time: 2.20, freq: n(9),  dur: 0.22, gain: 0.24 },
    { time: 2.50, freq: n(7),  dur: 0.22, gain: 0.22 },
    { time: 2.80, freq: n(4),  dur: 0.22, gain: 0.22 },
    { time: 3.10, freq: n(0),  dur: 0.55, gain: 0.28 },
  ]

  return [
    { name: 'Quiz Time',  emoji: '🎯', bpm: 120, notes: quizNotes  },
    { name: 'Think Fast', emoji: '⚡', bpm: 140, notes: thinkNotes  },
    { name: 'Winners',    emoji: '🏆', bpm: 100, notes: winNotes    },
  ]
})()

function playLoop(
  ctx: AudioContext,
  song: (typeof SONGS)[0],
  masterGain: GainNode,
  onLoop: () => void
): () => void {
  let stopped = false
  const loopDuration = (60 / song.bpm) * 8 // 8 beats per loop

  function scheduleMelody(startAt: number) {
    if (stopped) return
    song.notes.forEach(({ time, freq, dur, gain }) => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = freq
      // Slight detune for warmth
      osc.detune.value = -8

      // Envelope
      const t0 = startAt + time
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(gain, t0 + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)

      osc.connect(g)
      g.connect(masterGain)
      osc.start(t0)
      osc.stop(t0 + dur + 0.05)
    })
  }

  function scheduleBeat(startAt: number) {
    if (stopped) return
    const beatDur = 60 / song.bpm
    for (let i = 0; i < 8; i++) {
      const t = startAt + i * beatDur
      // Kick on 1 and 5
      if (i === 0 || i === 4) {
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate)
        const data = buf.getChannelData(0)
        for (let j = 0; j < data.length; j++) {
          data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (ctx.sampleRate * 0.04))
        }
        const src = ctx.createBufferSource()
        const g = ctx.createGain()
        src.buffer = buf
        g.gain.setValueAtTime(0.18, t)
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
        src.connect(g)
        g.connect(masterGain)
        src.start(t)
      }
      // Hi-hat on every beat
      const hBuf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate)
      const hData = hBuf.getChannelData(0)
      for (let j = 0; j < hData.length; j++) {
        hData[j] = (Math.random() * 2 - 1) * Math.exp(-j / (ctx.sampleRate * 0.008))
      }
      const hSrc = ctx.createBufferSource()
      const hG = ctx.createGain()
      hSrc.buffer = hBuf
      hG.gain.setValueAtTime(0.06, t)
      hG.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
      hSrc.connect(hG)
      hG.connect(masterGain)
      hSrc.start(t)
    }
  }

  let loopStart = ctx.currentTime + 0.05
  scheduleMelody(loopStart)
  scheduleBeat(loopStart)

  const interval = setInterval(() => {
    if (stopped) { clearInterval(interval); return }
    loopStart += loopDuration
    scheduleMelody(loopStart)
    scheduleBeat(loopStart)
    onLoop()
  }, loopDuration * 1000 - 100) // schedule next loop 100ms before end

  return () => { stopped = true; clearInterval(interval) }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MusicPlayer() {
  const [trackIndex, setTrackIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(0.4)
  const [isMinimized, setIsMinimized] = useState(true)

  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const track = SONGS[trackIndex]

  // Sync volume
  useEffect(() => {
    if (masterRef.current) {
      masterRef.current.gain.setTargetAtTime(volume, masterRef.current.context.currentTime, 0.05)
    }
  }, [volume])

  const stop = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    setIsPlaying(false)
  }, [])

  const play = useCallback((index: number) => {
    // Create / resume AudioContext on user gesture
    if (!ctxRef.current) {
      const ctx = new AudioContext()
      const master = ctx.createGain()
      master.gain.value = volume
      master.connect(ctx.destination)
      ctxRef.current = ctx
      masterRef.current = master
    }
    const ctx = ctxRef.current!
    const master = masterRef.current!
    if (ctx.state === 'suspended') ctx.resume()

    stopRef.current?.()
    const song = SONGS[index]
    stopRef.current = playLoop(ctx, song, master, () => {})
    setIsPlaying(true)
    setTrackIndex(index)
  }, [volume])

  const togglePlay = useCallback(() => {
    if (isPlaying) { stop() } else { play(trackIndex) }
  }, [isPlaying, stop, play, trackIndex])

  const nextTrack = useCallback(() => {
    const next = (trackIndex + 1) % SONGS.length
    if (isPlaying) { play(next) } else { setTrackIndex(next) }
  }, [trackIndex, isPlaying, play])

  const prevTrack = useCallback(() => {
    const prev = (trackIndex - 1 + SONGS.length) % SONGS.length
    if (isPlaying) { play(prev) } else { setTrackIndex(prev) }
  }, [trackIndex, isPlaying, play])

  // Cleanup on unmount
  useEffect(() => () => { stopRef.current?.(); ctxRef.current?.close() }, [])

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`bg-kawaDark/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl transition-all duration-300 overflow-hidden ${
          isMinimized ? 'w-14 h-14' : 'w-68'
        }`}
        style={{ width: isMinimized ? 56 : 264 }}
      >
        {isMinimized ? (
          <button
            onClick={() => setIsMinimized(false)}
            className="w-full h-full flex items-center justify-center rounded-2xl hover:bg-white/10 transition-colors relative"
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
                      <div
                        key={i}
                        className="w-0.5 bg-kawaGreen rounded-full animate-bounce"
                        style={{ height: h, animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setIsMinimized(true)}
                className="text-white/30 hover:text-white/60 text-xl leading-none transition-colors w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/10"
              >
                ×
              </button>
            </div>

            {/* Track info */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-3 mb-3 text-center">
              <div className="text-xl mb-0.5">{track.emoji}</div>
              <p className="text-white font-bold text-sm">{track.name}</p>
              <p className="text-white/30 text-xs mt-0.5">{track.bpm} BPM · {trackIndex + 1}/{SONGS.length}</p>
            </div>

            {/* Transport controls */}
            <div className="flex items-center justify-center gap-3 mb-3">
              <button
                onClick={prevTrack}
                className="text-white/50 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-sm"
              >
                ⏮
              </button>
              <button
                onClick={togglePlay}
                className="w-11 h-11 bg-kawaYellow hover:bg-yellow-400 text-kawaDark rounded-full flex items-center justify-center text-lg font-bold transition-all hover:scale-110 active:scale-95 shadow-lg shadow-kawaYellow/30"
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button
                onClick={nextTrack}
                className="text-white/50 hover:text-white transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 text-sm"
              >
                ⏭
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
              <div className="flex-1 relative h-5 flex items-center group">
                <div className="absolute inset-x-0 h-1.5 bg-white/15 rounded-full" />
                <div
                  className="absolute left-0 h-1.5 bg-kawaYellow rounded-full pointer-events-none transition-all"
                  style={{ width: `${volume * 100}%` }}
                />
                <input
                  type="range"
                  min="0" max="1" step="0.02"
                  value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
                />
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
