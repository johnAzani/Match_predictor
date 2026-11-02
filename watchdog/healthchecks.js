const PING_TIMEOUT_MS = 10_000
const PING_ATTEMPTS = 2

// Healthchecks ping URLs are bearer secrets. Restrict their destination, never
// follow redirects, and never include the URL or network errors in log output.
export function validPingUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 512 || value !== value.trim()) return false
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'hc-ping.com' || url.port || url.username || url.password || url.search || url.hash) return false
    if (!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?\/?$/.test(url.pathname)) return false
    const parts = url.pathname.split('/').filter(Boolean)
    // These suffixes report something other than an ordinary success ping.
    return !(parts.length === 2 && (['start', 'fail', 'log'].includes(parts[1]) || /^\d+$/.test(parts[1])))
  } catch { return false }
}

export async function sendSuccessPing(value, { fetchImpl = globalThis.fetch } = {}) {
  if (!validPingUrl(value)) return { ok: false, reason: 'invalid-ping-url' }
  for (let attempt = 0; attempt < PING_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(value.replace(/\/$/, ''), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      })
      // UUID endpoints may return HTTP 200 for an unknown check or a
      // rate-limited ping. Only the exact documented success body counts.
      if (response.ok && (await response.text()).trim() === 'OK') return { ok: true, reason: 'sent' }
    } catch { /* Treat network errors exactly like an unsuccessful response. */ }
  }
  return { ok: false, reason: 'ping-unavailable' }
}
