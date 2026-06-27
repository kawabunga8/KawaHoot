import { Suspense } from 'react'
import LoginClient from './LoginClient'

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-kawaDark flex items-center justify-center text-white/50">Loading...</main>}>
      <LoginClient />
    </Suspense>
  )
}
