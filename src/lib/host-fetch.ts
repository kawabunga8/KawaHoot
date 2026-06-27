'use client'

const SESSION_KEY = 'kawahoot_host_token'

/** fetch wrapper that injects the host auth token (obtained via /api/host/login) on all requests. */
export function hostFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem(SESSION_KEY) : null
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string>),
      'x-host-token': token || '',
    },
  })
}
