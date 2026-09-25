// KawaHoot's own auth cookie name. Without it, @supabase/ssr names the cookie
// after the Supabase host (`sb-127-auth-token` for any 127.0.0.1 stack), and
// localhost cookies are shared across ports — so KawaHoot's session and the
// shared stack's (Course Hub / Report Card Tool / Group Maker) would overwrite
// each other. Must match in the browser client, server client and middleware.
export const AUTH_COOKIE_OPTIONS = { name: 'sb-kawahoot-auth-token' }
