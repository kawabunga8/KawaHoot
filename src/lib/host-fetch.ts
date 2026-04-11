'use client'

/** fetch wrapper that injects the host password header on all requests. */
export function hostFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const password = process.env.NEXT_PUBLIC_HOST_PASSWORD || 'teacher'
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string>),
      'x-host-password': password,
    },
  })
}
