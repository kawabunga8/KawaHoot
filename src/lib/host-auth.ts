'use client'

import { useState, useEffect } from 'react'

const SESSION_KEY = 'kawahoot_host_token'

export function useHostAuth() {
  const [authed, setAuthed] = useState(false)
  const [checked, setChecked] = useState(false) // false until sessionStorage read (avoids flash)

  useEffect(() => {
    setAuthed(!!sessionStorage.getItem(SESSION_KEY))
    setChecked(true)
  }, [])

  async function login(password: string): Promise<boolean> {
    try {
      const res = await fetch('/api/host/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (data.success && data.token) {
        sessionStorage.setItem(SESSION_KEY, data.token)
        setAuthed(true)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY)
    setAuthed(false)
  }

  return { authed, checked, login, logout }
}
