import { isValidTracker } from '../src/lib/tracker.js'

// Pages is the durable archive: each successful deployment includes the full
// ledger, which the next build must restore before adding anything. A network
// failure or corrupt archive is never interpreted as an empty history.
export async function restorePublishedTracker(baseUrl, { fetchImpl = globalThis.fetch, runId = 'local' } = {}) {
  if (!baseUrl) throw new Error('The published Pages URL is required to restore tracking history')
  const base = new URL(baseUrl)
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Invalid Pages URL')
  const root = baseUrl.replace(/\/+$/, '')
  const query = `?build=${encodeURIComponent(runId)}`
  const get = (name) => fetchImpl(`${root}/data/${name}${query}`, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    cache: 'no-store', signal: AbortSignal.timeout(15_000),
  })
  const response = await get('track-record.json')
  if (response.ok) {
    const data = await response.json()
    if (!isValidTracker(data) || data.publication !== 'github-pages') throw new Error('The published tracking ledger is invalid; refusing to reset it')
    return data
  }
  if (response.status !== 404) throw new Error(`Could not restore the published tracking ledger (${response.status})`)

  // Bootstrap only when the existing deployed matchday snapshot proves this is
  // an older site that has never published a tracking ledger.
  const oldResponse = await get('matchday.json')
  if (!oldResponse.ok) throw new Error(`Cannot verify the existing Pages site for tracker bootstrap (${oldResponse.status})`)
  const oldFeed = await oldResponse.json()
  if (oldFeed?.mode !== 'community' || !Array.isArray(oldFeed.fixtures) || !oldFeed.source) throw new Error('Cannot verify the existing Pages snapshot for tracker bootstrap')
  if (oldFeed.trackerVersion !== undefined) throw new Error('The published tracking ledger is missing; refusing to reset history')
  return null
}
