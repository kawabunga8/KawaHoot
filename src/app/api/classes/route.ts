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

function currentSchoolYear(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const startYear = month >= 9 ? year : year - 1
  return `${startYear}-${String(startYear + 1).slice(2)}`
}

type RealCourse = { id: string; name: string; block: string | null; school_year: string | null; type: string; quarters: string[] | null }

export async function GET(req: NextRequest) {
  const auth = await requireHost(req)
  if (auth) return auth

  const schoolYear = req.nextUrl.searchParams.get('school_year') || currentSchoolYear()

  // current_courses(p_school_year) resolves which version of each course applies for
  // the year (handles supersession) -- same canonical, deduped catalog TOC-Dayplans/
  // Report Card Tool/Group Maker use. Replaces the old public.classes-based query,
  // which still has the pre-split duplicate/retired rows this never accounted for.
  const [courses, quarters, kawahootClasses, kawahootStudents] = await Promise.all([
    supabaseGet(`rpc/current_courses?p_school_year=${encodeURIComponent(schoolYear)}`),
    supabaseGet('school_quarters?select=id,start_date,end_date'),
    supabaseGet('kawahoot_classes?select=id,name,created_at&order=created_at'),
    supabaseGet('kawahoot_students?select=id,class_id,full_name'),
  ])

  if (!Array.isArray(courses)) {
    return NextResponse.json({ error: 'Failed to load courses', detail: courses }, { status: 500 })
  }

  // Same fallback as TOC-Dayplans/Group Maker: resolve today's quarter from
  // public.school_quarters, falling back to the most recently-ended one (instead of
  // showing every quarter-specific course at once) when today is outside all of them.
  const today = new Date().toISOString().split('T')[0]
  const currentQuarter = Array.isArray(quarters)
    ? quarters.find((q: { id: number; start_date: string; end_date: string }) => today >= q.start_date && today <= q.end_date)?.id
      ?? quarters.filter((q: { end_date: string }) => q.end_date < today).sort((a: { end_date: string }, b: { end_date: string }) => b.end_date.localeCompare(a.end_date))[0]?.id
      ?? null
    : null

  const realCourses = (courses as RealCourse[])
    .filter((c) => c.type === 'academic')
    .filter((c) => !currentQuarter || !c.quarters || c.quarters.includes(String(currentQuarter)))

  const courseIds = realCourses.map((c) => c.id)
  const enrollments = courseIds.length > 0
    ? await supabaseGet(`enrollments?select=course_id,student_id&course_id=in.(${courseIds.join(',')})`)
    : []
  const studentIds = Array.isArray(enrollments) ? [...new Set(enrollments.map((e: { student_id: string }) => e.student_id))] : []
  const students = studentIds.length > 0
    ? await supabaseGet(`students?select=id,first_name,last_name&id=in.(${studentIds.join(',')})`)
    : []

  const studentsById = new Map(
    Array.isArray(students) ? students.map((s: { id: string; first_name: string; last_name: string }) => [s.id, s]) : []
  )

  const realResult = realCourses.map((c) => ({
    id: c.id,
    name: c.name,
    school_year: c.school_year,
    block_label: c.block,
    students: (Array.isArray(enrollments) ? enrollments : [])
      .filter((e: { course_id: string }) => e.course_id === c.id)
      .map((e: { student_id: string }) => studentsById.get(e.student_id))
      .filter((s: { id: string; first_name: string; last_name: string } | undefined): s is { id: string; first_name: string; last_name: string } => Boolean(s))
      .map((s) => ({ id: s.id, full_name: `${s.first_name} ${s.last_name}` })),
  }))

  // Ad-hoc Kawahoot-only classes (created via "+ New Class") always show, regardless
  // of school year/quarter -- they're not tied to a real course.
  const adHocResult = Array.isArray(kawahootClasses)
    ? kawahootClasses.map((c: { id: string; name: string }) => ({
        id: c.id,
        name: c.name,
        school_year: null,
        block_label: null,
        students: Array.isArray(kawahootStudents)
          ? kawahootStudents.filter((s: { class_id: string }) => s.class_id === c.id).map((s: { id: string; full_name: string }) => ({ id: s.id, full_name: s.full_name }))
          : [],
      }))
    : []

  return NextResponse.json([...realResult, ...adHocResult])
}
