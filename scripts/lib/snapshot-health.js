import { isValidTracker } from '../../src/lib/tracker.js'

const HOUR = 60 * 60 * 1000
const CLOCK_SKEW_MS = 5 * 60 * 1000

// A successful build can still be based on late/partial community data. Keep
// those conditions distinct from whether the site deployed successfully.
export function assessSnapshot(ledger, feed, now = Date.now()) {
  if (!isValidTracker(ledger) || ledger.publication !== 'github-pages' || feed?.mode !== 'community' || !feed.source || !Array.isArray(feed.fixtures)) {
    throw new Error('Cannot assess an invalid published forecast snapshot')
  }
  const codes = []
  const sourceTime = Date.parse(feed.source.sourceUpdatedAt)
  if (ledger.sourceStale || feed.source.stale || !Number.isFinite(sourceTime) || now - sourceTime > 48 * HOUR || sourceTime > now + CLOCK_SKEW_MS) codes.push('source-stale')
  if (!Array.isArray(feed.source.unavailableLeagues) || feed.source.unavailableLeagues.length) codes.push('leagues-unavailable')
  if (ledger.sourceUpdatedAt !== feed.source.sourceUpdatedAt) codes.push('source-mismatch')
  return { healthy: codes.length === 0, codes }
}
