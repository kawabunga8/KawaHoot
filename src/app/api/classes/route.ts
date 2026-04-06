import { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!

async function supabaseGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    cache: 'no-store',
  })
  return res.json()
}

export async function GET() {
  const [classes, students] = await Promise.all([
    supabaseGet('classes?select=id,name,created_at&order=created_at'),
    supabaseGet('students?select=id,class_id,full_name'),
  ])

  if (!Array.isArray(classes)) {
    return NextResponse.json({ error: 'Failed to load classes', detail: classes }, { status: 500 })
  }

  const result = classes.map((c: { id: string; name: string; created_at: string }) => ({
    ...c,
    students: Array.isArray(students)
      ? students.filter((s: { class_id: string }) => s.class_id === c.id)
      : [],
  }))

  return NextResponse.json(result)
}
