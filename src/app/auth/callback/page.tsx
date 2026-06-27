'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallbackPage() {
  const router = useRouter()
  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') router.push('/host')
    })
    return () => subscription.unsubscribe()
  }, [router])
  return <main className="min-h-screen bg-kawaDark flex items-center justify-center text-white/50">Completing sign-in...</main>
}
