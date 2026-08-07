import { NextRequest, NextResponse } from 'next/server'
import { requireHost } from '@/lib/require-host'
import { createAdminClient } from '@/lib/supabase/admin'

const COURSE_HUB_URL = process.env.COURSE_HUB_URL!
const COURSE_HUB_API_KEY = process.env.COURSE_HUB_API_KEY!

function currentSchoolYear(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const startYear = month >= 7 ? year : year - 1
  return `${startYear}-${String(startYear + 1).slice(2)}`
}

export async function GET(req: NextRequest) {
  const auth = await requireHost(req)
  if (auth) return auth

  const schoolYear = req.nextUrl.searchParams.get('school_year') || currentSchoolYear()

  // Real courses + rosters come from course-hub (single source of truth).
  // Ad-hoc kawahoot_classes/students stay local to this app.
  const [coursesRes, adHocData] = await Promise.all([
    fetch(`${COURSE_HUB_URL}/api/courses?type=academic&school_year=${encodeURIComponent(schoolYear)}`, {
      headers: { Authorization: `Bearer ${COURSE_HUB_API_KEY}` },
      cache: 'no-store',
    }),
    (async () => {
      const supabase = createAdminClient()
      const [{ data: classes }, { data: students }] = await Promise.all([
        supabase.from('kawahoot_classes').select('id,name,created_at').order('created_at'),
        supabase.from('kawahoot_students').select('id,class_id,full_name'),
      ])
      return { classes: classes ?? [], students: students ?? [] }
    })(),
  ])

  if (!coursesRes.ok) {
    const detail = await coursesRes.text()
    return NextResponse.json({ error: 'Failed to load courses', detail }, { status: coursesRes.status })
  }

  const courses: Array<{ id: string; name: string; block: string | null; school_year: string | null }> =
    await coursesRes.json()

  // Fetch rosters for all courses in parallel from course-hub.
  const rosterResults = await Promise.all(
    courses.map((c) =>
      fetch(`${COURSE_HUB_URL}/api/courses/${c.id}/roster`, {
        headers: { Authorization: `Bearer ${COURSE_HUB_API_KEY}` },
        cache: 'no-store',
      })
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    )
  )

  const realResult = courses.map((c, i) => ({
    id: c.id,
    name: c.name,
    school_year: c.school_year,
    block_label: c.block,
    students: (rosterResults[i] as Array<{ id: string; full_name: string }>).map((s) => ({
      id: s.id,
      full_name: s.full_name,
    })),
  }))

  // Ad-hoc classes created via "+ New Class" always show regardless of year.
  const adHocResult = adHocData.classes.map((c: { id: string; name: string }) => ({
    id: c.id,
    name: c.name,
    school_year: null,
    block_label: null,
    students: adHocData.students
      .filter((s: { class_id: string }) => s.class_id === c.id)
      .map((s: { id: string; full_name: string }) => ({ id: s.id, full_name: s.full_name })),
  }))

  return NextResponse.json([...realResult, ...adHocResult])
}
