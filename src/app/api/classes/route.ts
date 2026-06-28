import { NextRequest, NextResponse } from 'next/server'
import { requireHost } from '@/lib/require-host'

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

export async function GET(req: NextRequest) {
  const auth = await requireHost(req)
  if (auth) return auth

  const schoolYear = req.nextUrl.searchParams.get('school_year')
  // Classes shared with student-hub are tagged with a school_year; ad-hoc
  // Kawahoot-only classes (created via "+ New Class" below) have school_year
  // null and should always show up regardless of the selected year.
  const classesFilter = schoolYear
    ? `classes?select=id,name,school_year,block_label,sort_order&or=(school_year.eq.${schoolYear},school_year.is.null)&order=sort_order`
    : `classes?select=id,name,school_year,block_label,sort_order&order=sort_order`

  const classes = await supabaseGet(classesFilter)
  if (!Array.isArray(classes)) {
    return NextResponse.json({ error: 'Failed to load classes', detail: classes }, { status: 500 })
  }

  const classIds = classes.map((c: { id: string }) => c.id)
  if (classIds.length === 0) return NextResponse.json([])

  // Real roster membership lives in enrollments -> students (first_name/last_name),
  // not a class_id/full_name column directly on students.
  const [enrollments, students] = await Promise.all([
    supabaseGet(`enrollments?select=class_id,student_id&class_id=in.(${classIds.join(',')})`),
    supabaseGet(`students?select=id,first_name,last_name`),
  ])

  const studentsById = new Map(
    Array.isArray(students) ? students.map((s: { id: string; first_name: string; last_name: string }) => [s.id, s]) : []
  )

  const result = classes.map((c: { id: string; name: string; school_year: string | null; block_label: string | null; sort_order: number | null }) => ({
    id: c.id,
    name: c.name,
    school_year: c.school_year,
    block_label: c.block_label,
    students: (Array.isArray(enrollments) ? enrollments : [])
      .filter((e: { class_id: string }) => e.class_id === c.id)
      .map((e: { student_id: string }) => studentsById.get(e.student_id))
      .filter((s: { id: string; first_name: string; last_name: string } | undefined): s is { id: string; first_name: string; last_name: string } => Boolean(s))
      .map((s) => ({ id: s.id, full_name: `${s.first_name} ${s.last_name}` })),
  }))

  return NextResponse.json(result)
}
