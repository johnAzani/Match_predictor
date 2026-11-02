import { isValidTracker } from '../src/lib/tracker.js'
import { sendSuccessPing, validPingUrl } from './healthchecks.js'

export const PUBLIC_LEDGER_URL = 'https://johnazani.github.io/Match_predictor/data/track-record.json'
export const MAX_LEDGER_AGE_MS = 36 * 60 * 60 * 1000
const CLOCK_SKEW_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000

// A successful heartbeat means only that the public, valid ledger was observed
// recently enough. It does not prove the football source or GitHub backup is
// healthy, or establish the actual time a match was played.
export function assessPublishedLedger(ledger, now = Date.now()) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return { ok: false, reason: 'invalid-clock' }
  if (!isValidTracker(ledger) || ledger.publication !== 'github-pages') return { ok: false, reason: 'invalid-ledger' }
  const updated = Date.parse(ledger.updatedAt)
  if (updated > now + CLOCK_SKEW_MS) return { ok: false, reason: 'future-ledger' }
  if (now - updated > MAX_LEDGER_AGE_MS) return { ok: false, reason: 'stale-ledger' }
  return { ok: true, reason: 'fresh-ledger' }
}

// The public endpoint is fixed in code. Neither the GitHub token nor any team
// names, scores, or ledger content are sent to the external heartbeat service.
export async function checkPublishedLedger({ pingUrl, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!validPingUrl(pingUrl)) return { ok: false, reason: 'invalid-ping-url' }
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return { ok: false, reason: 'invalid-clock' }
  const url = new URL(PUBLIC_LEDGER_URL)
  url.searchParams.set('watchdog', String(Math.floor(now)))
  let response
  try {
    response = await fetchImpl(url.href, {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch { return { ok: false, reason: 'ledger-unavailable' } }
  if (!response.ok) return { ok: false, reason: 'ledger-unavailable' }
  let ledger
  try { ledger = await response.json() } catch { return { ok: false, reason: 'invalid-ledger' } }
  const assessment = assessPublishedLedger(ledger, now)
  if (!assessment.ok) return assessment
  const ping = await sendSuccessPing(pingUrl, { fetchImpl })
  return ping.ok ? { ok: true, reason: 'fresh-ledger' } : ping
}
