'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import type { CSVRow } from '@/types'

const SAMPLE_CSV = `question,option_a,option_b,option_c,option_d,correct_answer,time_limit
What is 2 + 2?,3,4,5,6,B,20
What color is the sky?,Red,Green,Blue,Yellow,C,15
Who wrote Romeo and Juliet?,Dickens,Shakespeare,Tolstoy,Austen,B,20`

export default function HostPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [questions, setQuestions] = useState<CSVRow[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [parseError, setParseError] = useState('')

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
    <div className="min-h-screen bg-kawaDark px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <a href="/" className="inline-block mb-4">
            <span
              className="text-4xl font-bold"
              style={{ fontFamily: "'Fredoka One', cursive" }}
            >
              <span className="text-white">Kawa</span>
              <span className="text-kawaYellow">hoot</span>
              <span className="text-kawaCoral">!</span>
            </span>
          </a>
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
      </div>
    </div>
  )
}
