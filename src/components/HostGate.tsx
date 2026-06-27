// Real authentication now happens in middleware.ts (Supabase session + @myrcs.ca
// check) before /host or /game/[id] is ever rendered. This wrapper is kept only
// so existing call sites in those pages don't need to change.
export default function HostGate({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
