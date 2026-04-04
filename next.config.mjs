/** @type {import('next').NextConfig} */
const nextConfig = {
  // Supabase realtime uses websockets — no special config needed
  experimental: {
    serverActions: {
      allowedOrigins: ['localhost:3000'],
    },
  },
}

export default nextConfig
