'use client'

/**
 * fetch wrapper for host-only API calls. Auth now travels via the Supabase
 * session cookie set at /login (same-origin requests include it
 * automatically) — this no longer injects a password/token header.
 */
export function hostFetch(url: string, options: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...options, credentials: 'include' })
}
