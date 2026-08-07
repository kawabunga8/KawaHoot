/** Generate a random 6-digit PIN */
export function generatePin(): string {
  // crypto over Math.random: a predictable PIN lets someone guess their way into
  // a live game. Rejection-sampled so the modulo does not skew the low digits.
  const range = 900000
  const limit = Math.floor(0xffffffff / range) * range
  let n = 0
  do {
    n = crypto.getRandomValues(new Uint32Array(1))[0]
  } while (n >= limit)
  return (100000 + (n % range)).toString()
}

/** Calculate points: max 1000, decreasing with response time */
export function calculatePoints(
  isCorrect: boolean,
  responseTimeMs: number,
  timeLimitSeconds: number
): number {
  if (!isCorrect || timeLimitSeconds <= 0) return 0
  const timeLimitMs = timeLimitSeconds * 1000
  const ratio = Math.max(0, 1 - responseTimeMs / timeLimitMs)
  // Base 500 + up to 500 speed bonus
  return Math.round(500 + 500 * ratio)
}

export const ANSWER_COLORS = {
  A: { bg: 'bg-kawared', hover: 'hover:bg-kawared/90', label: 'bg-kawared/80' },
  B: { bg: 'bg-kawaBlue', hover: 'hover:bg-kawaBlue/90', label: 'bg-kawaBlue/80' },
  C: { bg: 'bg-kawaYellow', hover: 'hover:bg-kawaYellow/90', label: 'bg-kawaYellow/80' },
  D: { bg: 'bg-kawaGreen', hover: 'hover:bg-kawaGreen/90', label: 'bg-kawaGreen/80' },
} as const

export const ANSWER_SHAPES = {
  A: '▲',
  B: '◆',
  C: '●',
  D: '■',
} as const
