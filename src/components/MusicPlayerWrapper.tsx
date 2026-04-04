'use client'

import { usePathname } from 'next/navigation'
import MusicPlayer from './MusicPlayer'

export default function MusicPlayerWrapper() {
  const pathname = usePathname()
  if (pathname.startsWith('/play/')) return null
  return <MusicPlayer />
}
