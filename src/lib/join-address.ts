// The address other devices open to join, e.g. "192.168.1.23:3008". The kawahoot-class
// skill's `class.sh start` sets it when it shares KawaHoot on the Wi-Fi; otherwise it's
// empty and KawaHoot is reachable from this laptop only.
export const JOIN_ADDRESS = process.env.NEXT_PUBLIC_JOIN_ADDRESS || ''
