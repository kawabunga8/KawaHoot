'use client'

import { useState, useEffect } from 'react'

const SESSION_KEY = 'kawahoot_host_authed'

export function useHostAuth() {
  const [authed, setAuthed] = useState(false)
  const [checked, setChecked] = useState(false) // false until sessionStorage read (avoids flash)

  useEffect(() => {
    setAuthed(sessionStorage.getItem(SESSION_KEY) === '1')
    setChecked(true)
  }, [])

  function login(password: string): boolean {
    const expected = process.env.NEXT_PUBLIC_HOST_PASSWORD || 'teacher'
    if (password === expected) {
      sessionStorage.setItem(SESSION_KEY, '1')
      setAuthed(true)
      return true
    }
    return false
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setAuthed(false)
  }

  return { authed, checked, login, logout }
}
