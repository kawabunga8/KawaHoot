export type QuizQuestion = {
  id: string
  game_id: string
  question_text: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_answer: 'A' | 'B' | 'C' | 'D'
  time_limit: number // seconds
  order_index: number
}

export type Game = {
  id: string
  pin: string
  host_id: string
  title: string
  status: 'waiting' | 'question' | 'answer_reveal' | 'leaderboard' | 'finished'
  current_question_index: number
  current_question_started_at: string | null
  created_at: string
}

export type Player = {
  id: string
  game_id: string
  nickname: string
  score: number
  joined_at: string
}

export type Answer = {
  id: string
  game_id: string
  player_id: string
  question_id: string
  selected_answer: 'A' | 'B' | 'C' | 'D'
  is_correct: boolean
  response_time_ms: number
  points_earned: number
  answered_at: string
}

export type LeaderboardEntry = {
  player_id: string
  nickname: string
  score: number
  rank: number
}

export type CSVRow = {
  question: string
  option_a: string
  option_b: string
  option_c: string
  option_d: string
  correct_answer: string
  time_limit?: string
}
