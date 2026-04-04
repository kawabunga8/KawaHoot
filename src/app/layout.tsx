import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kawahoot — Live Classroom Quiz Game',
  description: 'Fast-paced, fun quiz battles for classrooms. Create a game, share the PIN, and watch the competition begin!',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-kawaDark">
        {children}
      </body>
    </html>
  )
}
