'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { createClient } from '@/lib/supabase/client'
import HostGate from '@/components/HostGate'
import type { CSVRow, KawaClass } from '@/types'

type SavedGame = { id: string; title: string; pin: string; createdAt: string }

const SAMPLE_CSV = `question,option_a,option_b,option_c,option_d,correct_answer,time_limit
What is 2 + 2?,3,4,5,6,B,20
What color is the sky?,Red,Green,Blue,Yellow,C,15
Who wrote Romeo and Juliet?,Dickens,Shakespeare,Tolstoy,Austen,B,20`

export default function HostPage() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [questions, setQuestions] = useState<CSVRow[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [parseError, setParseError] = useState('')
  const [savedGames, setSavedGames] = useState<SavedGame[]>([])
  const [replayingId, setReplayingId] = useState<string | null>(null)
  const [classes, setClasses] = useState<KawaClass[]>([])
  const [editingClassId, setEditingClassId] = useState<string | null>(null)
  const [newClassMode, setNewClassMode] = useState(false)
  const [classFormName, setClassFormName] = useState('')
  const [classFormStudents, setClassFormStudents] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('kawahoot_games')
    if (stored) {
      try { setSavedGames(JSON.parse(stored)) } catch {}
    }
    fetch('/api/classes').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setClasses(data)
    })
  }, [supabase])

  function parseStudents(raw: string) {
    return raw.split('\n').map(s => s.trim()).filter(Boolean)
  }

  async function createClass() {
    if (!classFormName.trim()) return
    const names = parseStudents(classFormStudents)
    const { data: cls } = await supabase.from('classes').insert({ name: classFormName.trim() }).select('id, name, created_at').single()
    if (!cls) return
    if (names.length > 0) {
      await supabase.from('students').insert(names.map(n => ({ class_id: cls.id, full_name: n })))
    }
    setClasses(prev => [...prev, { ...cls, students: names.map(n => ({ id: '', class_id: cls.id, full_name: n })) }])
    setNewClassMode(false)
    setClassFormName('')
    setClassFormStudents('')
  }

  async function updateClass(id: string) {
    if (!classFormName.trim()) return
    const names = parseStudents(classFormStudents)
    setClasses(prev => prev.map(c => c.id === id ? { ...c, name: classFormName.trim(), students: names.map(n => ({ id: '', class_id: id, full_name: n })) } : c))
    await supabase.from('classes').update({ name: classFormName.trim() }).eq('id', id)
    await supabase.from('students').delete().eq('class_id', id)
    if (names.length > 0) {
      await supabase.from('students').insert(names.map(n => ({ class_id: id, full_name: n })))
    }
    setEditingClassId(null)
    setClassFormName('')
    setClassFormStudents('')
  }

  function startEditClass(cls: KawaClass) {
    setEditingClassId(cls.id)
    setClassFormName(cls.name)
    setClassFormStudents(cls.students.map(s => s.full_name).join('\n'))
    setNewClassMode(false)
  }

  async function deleteClass(id: string) {
    setClasses(prev => prev.filter(c => c.id !== id))
    await supabase.from('students').delete().eq('class_id', id)
    await supabase.from('classes').delete().eq('id', id)
  }

  async function handleReplay(gameId: string) {
    setReplayingId(gameId)
    const res = await fetch('/api/game/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId }),
    })
    const data = await res.json()
    setReplayingId(null)
    if (!data.success) {
      if (res.status === 404) {
        // Game no longer exists in DB — remove stale entry from saved list
        const cleaned = savedGames.filter(g => g.id !== gameId)
        setSavedGames(cleaned)
        localStorage.setItem('kawahoot_games', JSON.stringify(cleaned))
        setError('That saved game no longer exists. It may have been deleted.')
      } else {
        setError(data.error || 'Failed to replay game')
      }
      return
    }
    // Update saved games with new entry
    const updated: SavedGame[] = JSON.parse(localStorage.getItem('kawahoot_games') || '[]')
    const orig = updated.find(g => g.id === gameId)
    const newEntry: SavedGame = { id: data.gameId, title: orig?.title || 'Game', pin: data.pin, createdAt: new Date().toISOString() }
    const next = [newEntry, ...updated].slice(0, 20)
    localStorage.setItem('kawahoot_games', JSON.stringify(next))
    router.push(`/game/${data.gameId}`)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data
        const required = ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer']
        const headers = Object.keys(rows[0] || {})
        const missing = required.filter(r => !headers.includes(r))
        if (missing.length) {
          setParseError(`Missing columns: ${missing.join(', ')}`)
          setQuestions([])
          return
        }
        const valid = rows.filter(r =>
          r.question && r.option_a && r.option_b && r.option_c && r.option_d &&
          ['A','B','C','D'].includes(r.correct_answer?.toUpperCase?.())
        ).map(r => ({ ...r, correct_answer: r.correct_answer.toUpperCase() }))
        if (!valid.length) {
          setParseError('No valid questions found. Check correct_answer must be A, B, C, or D.')
          return
        }
        setQuestions(valid as CSVRow[])
      },
      error: () => setParseError('Failed to parse CSV file'),
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!title.trim()) { setError('Enter a game title'); return }
    if (!questions.length) { setError('Upload a CSV with questions'); return }
    setLoading(true)
    const res = await fetch('/api/game/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), questions }),
    })
    const data = await res.json()
    setLoading(false)
    if (!data.success) { setError(data.error || 'Failed to create game'); return }
    router.push(`/game/${data.gameId}`)
  }

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'kawahoot-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const answerColors: Record<string, string> = {
    A: 'bg-kawared/20 text-red-300 border-kawared/40',
    B: 'bg-kawaBlue/20 text-blue-300 border-kawaBlue/40',
    C: 'bg-kawaYellow/20 text-yellow-300 border-kawaYellow/40',
    D: 'bg-kawaGreen/20 text-green-300 border-kawaGreen/40',
  }

  return (
    <HostGate>
    <div className="min-h-screen bg-kawaDark px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <span
            className="text-4xl font-bold inline-block mb-4"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          >
            <span className="text-white">Kawa</span>
            <span className="text-kawaYellow">hoot</span>
            <span className="text-kawaCoral">!</span>
          </span>
          <h1
            className="text-3xl text-white font-bold"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          >
            Create a New Game
          </h1>
          <p className="text-purple-300 mt-1">Upload your questions and start hosting!</p>
        </div>

        <form onSubmit={handleCreate} className="space-y-6">
          {/* Title */}
          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-6">
            <label className="block text-white font-bold mb-2">Game Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Chapter 5 Review Quiz"
              className="w-full bg-white/10 border-2 border-white/30 rounded-xl px-4 py-3 text-white placeholder:text-white/40 text-lg font-semibold focus:outline-none focus:border-kawaYellow transition-colors"
            />
          </div>

          {/* CSV Upload */}
          <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-white font-bold">Questions CSV</label>
              <button
                type="button"
                onClick={downloadSample}
                className="text-kawaYellow hover:text-yellow-300 text-sm font-semibold transition-colors"
              >
                ↓ Download Sample CSV
              </button>
            </div>

            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-white/30 rounded-xl p-8 text-center cursor-pointer hover:border-kawaPurple hover:bg-kawaPurple/10 transition-all group"
            >
              <div className="text-4xl mb-2">📊</div>
              {fileName ? (
                <div>
                  <p className="text-kawaGreen font-bold">{fileName}</p>
                  <p className="text-white/50 text-sm">{questions.length} valid questions loaded</p>
                </div>
              ) : (
                <div>
                  <p className="text-white/60 font-semibold">Click to upload CSV</p>
                  <p className="text-white/30 text-sm mt-1">or drag and drop</p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleFile}
                className="hidden"
              />
            </div>

            {parseError && (
              <p className="text-kawared font-semibold text-sm">{parseError}</p>
            )}

            {/* CSV Format hint */}
            <div className="bg-black/20 rounded-xl p-4 text-xs text-white/50 font-mono">
              <p className="text-white/70 font-bold mb-1 font-sans text-sm">Required columns:</p>
              <p>question, option_a, option_b, option_c, option_d, correct_answer (A/B/C/D)</p>
              <p className="mt-1">Optional: time_limit (seconds, default 20)</p>
            </div>
          </div>

          {/* Preview */}
          {questions.length > 0 && (
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-6">
              <h3 className="text-white font-bold mb-4">
                Preview ({questions.length} questions)
              </h3>
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {questions.map((q, i) => (
                  <div key={i} className="bg-black/20 rounded-xl p-3">
                    <p className="text-white font-semibold text-sm mb-2">
                      {i + 1}. {q.question}
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {(['A','B','C','D'] as const).map(opt => (
                        <div
                          key={opt}
                          className={`text-xs px-2 py-1 rounded-lg border font-semibold ${answerColors[opt]} ${q.correct_answer === opt ? 'ring-1 ring-white/50' : ''}`}
                        >
                          {opt}: {q[`option_${opt.toLowerCase()}` as keyof CSVRow]}
                          {q.correct_answer === opt && ' ✓'}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-kawared font-bold text-center animate-wiggle">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-kawaPurple hover:bg-purple-600 disabled:opacity-50 text-white font-bold text-2xl py-5 rounded-2xl transition-all hover:scale-105 active:scale-95 shadow-xl"
            style={{ fontFamily: "'Fredoka One', cursive" }}
          >
            {loading ? 'Creating Game...' : '🎮 Create Game & Get PIN'}
          </button>
        </form>
        {/* My Classes */}
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl text-white font-bold" style={{ fontFamily: "'Fredoka One', cursive" }}>
              My Classes
            </h2>
            {!newClassMode && (
              <button
                onClick={() => { setNewClassMode(true); setEditingClassId(null); setClassFormName(''); setClassFormStudents('') }}
                className="bg-kawaPurple hover:bg-purple-600 text-white font-bold px-4 py-2 rounded-xl transition-all text-sm"
                style={{ fontFamily: "'Fredoka One', cursive" }}
              >
                + New Class
              </button>
            )}
          </div>

          {/* New class form */}
          {newClassMode && (
            <div className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-5 mb-4 space-y-3">
              <input
                type="text"
                value={classFormName}
                onChange={e => setClassFormName(e.target.value)}
                placeholder="Class name (e.g. Period 3)"
                autoFocus
                className="w-full bg-white/10 border-2 border-white/30 rounded-xl px-4 py-2.5 text-white placeholder:text-white/40 font-semibold focus:outline-none focus:border-kawaYellow transition-colors"
              />
              <textarea
                value={classFormStudents}
                onChange={e => setClassFormStudents(e.target.value)}
                placeholder={"Student names, one per line:\nAlice\nBob\nCharlie"}
                rows={6}
                className="w-full bg-white/10 border-2 border-white/30 rounded-xl px-4 py-2.5 text-white placeholder:text-white/30 font-mono text-sm focus:outline-none focus:border-kawaYellow transition-colors resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={createClass}
                  className="flex-1 bg-kawaGreen hover:bg-green-400 text-white font-bold py-2.5 rounded-xl transition-all"
                  style={{ fontFamily: "'Fredoka One', cursive" }}
                >
                  Save Class ({parseStudents(classFormStudents).length} students)
                </button>
                <button
                  onClick={() => setNewClassMode(false)}
                  className="bg-white/10 hover:bg-white/20 text-white/60 font-bold px-4 py-2.5 rounded-xl transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {classes.length === 0 && !newClassMode && (
            <p className="text-white/30 text-sm text-center py-4">
              No classes yet. Create one to pre-register students before a game.
            </p>
          )}

          <div className="space-y-3">
            {classes.map(cls => (
              <div key={cls.id} className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl overflow-hidden">
                {editingClassId === cls.id ? (
                  <div className="p-5 space-y-3">
                    <input
                      type="text"
                      value={classFormName}
                      onChange={e => setClassFormName(e.target.value)}
                      autoFocus
                      className="w-full bg-white/10 border-2 border-white/30 rounded-xl px-4 py-2.5 text-white font-semibold focus:outline-none focus:border-kawaYellow transition-colors"
                    />
                    <textarea
                      value={classFormStudents}
                      onChange={e => setClassFormStudents(e.target.value)}
                      rows={8}
                      className="w-full bg-white/10 border-2 border-white/30 rounded-xl px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-kawaYellow transition-colors resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateClass(cls.id)}
                        className="flex-1 bg-kawaGreen hover:bg-green-400 text-white font-bold py-2.5 rounded-xl transition-all"
                        style={{ fontFamily: "'Fredoka One', cursive" }}
                      >
                        Save ({parseStudents(classFormStudents).length} students)
                      </button>
                      <button
                        onClick={() => setEditingClassId(null)}
                        className="bg-white/10 hover:bg-white/20 text-white/60 font-bold px-4 py-2.5 rounded-xl transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-white font-bold text-lg">{cls.name}</p>
                      <p className="text-white/50 text-sm">{cls.students.length} students</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEditClass(cls)}
                        className="bg-white/10 hover:bg-white/20 text-white/70 font-bold px-3 py-2 rounded-xl transition-all text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteClass(cls.id)}
                        className="bg-white/10 hover:bg-kawared/30 text-white/40 hover:text-kawared font-bold px-3 py-2 rounded-xl transition-all text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Saved Games */}
        {savedGames.length > 0 && (
          <div className="mt-10">
            <h2
              className="text-2xl text-white font-bold mb-4"
              style={{ fontFamily: "'Fredoka One', cursive" }}
            >
              My Saved Games
            </h2>
            <div className="space-y-3">
              {savedGames.map(g => (
                <div key={g.id} className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-white font-bold text-lg">{g.title}</p>
                    <p className="text-white/50 text-sm">PIN: {g.pin} · {new Date(g.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/game/${g.id}`)}
                      className="bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95 whitespace-nowrap"
                      style={{ fontFamily: "'Fredoka One', cursive" }}
                    >
                      Open
                    </button>
                    <button
                      onClick={() => handleReplay(g.id)}
                      disabled={replayingId === g.id}
                      className="bg-kawaPurple hover:bg-purple-600 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95 whitespace-nowrap"
                      style={{ fontFamily: "'Fredoka One', cursive" }}
                    >
                      {replayingId === g.id ? 'Loading...' : '🔁 Replay'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </HostGate>
  )
}
