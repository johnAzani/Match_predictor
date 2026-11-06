// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createDataService, PROVIDER_SOURCE_NAME } from '../server/data-service.js'
import { updateTracker } from '../server/tracker.js'
import { PROVIDER_LEAGUES } from '../server/providers/five-dollar.js'
import { APPROVED_FEED_SOURCE } from '../server/ledger-source.js'

const NOW = new Date('2026-11-05T15:00:00Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const KEY = 'test-only-key'

const TEAMS = {
  4160026622: ['Everton', 'Coventry'],
  4212821298: ['Sevilla FC', 'Málaga CF'],
  686337048: ['Hamburger SV', 'FC Bayern München'],
  3405541143: ['Venezia', 'Udinese'],
}

function providerRow(leagueId, index, overrides = {}) {
  const kickoff = NOW.getTime() + (index + 1) * DAY
  const [home, away] = TEAMS[leagueId]
  return {
    id: leagueId + index, league: { id: leagueId, name: 'Provider' },
    teams: { home: { id: 1 + index, name: home }, away: { id: 2 + index, name: away } },
    kickoff_utc: new Date(kickoff).toISOString(), kickoff_ts: kickoff / 1000,
    status: 'scheduled', status_code: null, goals: { home: null, away: null }, ...overrides,
  }
}

function finishedRow(leagueId, index) {
  const kickoff = NOW.getTime() - (index + 1) * DAY
  const [home, away] = TEAMS[leagueId]
  return providerRow(leagueId, index, {
    kickoff_utc: new Date(kickoff).toISOString(), kickoff_ts: kickoff / 1000,
    status: 'finished', status_code: 'full', goals: { home: 2, away: index % 2 },
  })
}

function providerResponse(url) {
  const leagueId = Number(new URL(url).pathname.split('/')[3])
  const page = Number(new URL(url).searchParams.get('page'))
  const rows = page === 1
    ? [finishedRow(leagueId, 0), finishedRow(leagueId, 1), finishedRow(leagueId, 2), providerRow(leagueId, 0)]
    : []
  return { ok: true, status: 200, json: async () => ({ success: 1, data: rows, pagination: { page, has_more: page === 1 } }) }
}

// The historical backtest files are unchanged by a source switch; return an
// empty, valid openfootball document for them.
function historicalResponse() {
  return { ok: true, status: 200, json: async () => ({ encoding: 'base64', content: Buffer.from('{"matches":[]}').toString('base64') }) }
}

function fakeFetch({ providerImpl = providerResponse, historicalImpl = historicalResponse } = {}) {
  return vi.fn(async (url) => (new URL(url).host === 'api.github.com' ? historicalImpl(url) : providerImpl(url)))
}

describe('provider-backed data service', () => {
  it('builds a normal feed from the replacement provider', async () => {
    const service = createDataService({ fetchImpl: fakeFetch(), clock: () => NOW, provider: { apiKey: KEY } })
    const feed = await service.getMatchday()
    expect(feed.mode).toBe('community')
    expect(feed.source.name).toBe(PROVIDER_SOURCE_NAME)
    expect(feed.source.stale).toBe(false)
    expect(feed.source.availableLeagueCount).toBe(4)
    expect(feed.fixtures).toHaveLength(4)
    expect(feed.fixtures[0].id).toContain('community-2026-27')
    expect(feed.source.attribution).toEqual({ text: 'Football data by 5DollarFootballAPI', url: 'https://5dollarfootballapi.com/' })
    expect(JSON.stringify(feed)).not.toContain(KEY)
  })

  it('refuses to start without a provider key', () => {
    expect(() => createDataService({ provider: { apiKey: '  ' } })).toThrow(/server-side key/i)
  })

  it('never follows a redirect or leaks the key into the URL', async () => {
    const fetchImpl = fakeFetch()
    const service = createDataService({ fetchImpl, clock: () => NOW, provider: { apiKey: KEY } })
    await service.getMatchday()
    const providerCall = fetchImpl.mock.calls.find(([url]) => new URL(url).host !== 'api.github.com')
    expect(providerCall[0]).not.toContain(KEY)
    expect(providerCall[1]).toMatchObject({ redirect: 'manual', headers: { Authorization: `Bearer ${KEY}` } })
  })

  it('treats a feed with no upcoming fixtures as stale instead of fresh', async () => {
    const service = createDataService({
      fetchImpl: fakeFetch({ providerImpl: (url) => {
        const leagueId = Number(new URL(url).pathname.split('/')[3])
        const page = Number(new URL(url).searchParams.get('page'))
        return { ok: true, status: 200, json: async () => ({ success: 1, data: page === 1 ? [finishedRow(leagueId, 0)] : [], pagination: { page, has_more: page === 1 } }) }
      } }),
      clock: () => NOW,
      provider: { apiKey: KEY },
    })
    const feed = await service.getMatchday()
    expect(feed.fixtures).toHaveLength(0)
    expect(feed.source.stale).toBe(true)
  })

  it('serves the last good snapshot with a stale flag when the provider fails later', async () => {
    let fail = false
    const fetchImpl = vi.fn(async (url) => {
      if (new URL(url).host === 'api.github.com') return historicalResponse()
      if (fail) throw new Error('network down')
      return providerResponse(url)
    })
    let clock = NOW
    const service = createDataService({ fetchImpl, clock: () => clock, cacheMs: 1000, provider: { apiKey: KEY } })
    const first = await service.getMatchday()
    expect(first.source.stale).toBe(false)
    fail = true
    clock = new Date(NOW.getTime() + 2000)
    const second = await service.getMatchday()
    expect(second.source.stale).toBe(true)
    expect(second.source.refreshFailed).toBe(true)
    expect(second.fixtures).toHaveLength(first.fixtures.length)
  })
})

describe('tracker with the provider feed', () => {
  it('refuses a provider feed while the ledger is still approved for the old source', async () => {
    const service = createDataService({ fetchImpl: fakeFetch(), clock: () => NOW, provider: { apiKey: KEY } })
    const input = await service.getTrackingInput()
    expect(input.feed.source.name).toBe(PROVIDER_SOURCE_NAME)
    expect(APPROVED_FEED_SOURCE).toBe('open-matchday')
    expect(() => updateTracker(null, input, NOW, 'github-pages')).toThrow(/explicit history migration/i)
  })

  it('records forecasts once the ledger is explicitly migrated', async () => {
    const service = createDataService({ fetchImpl: fakeFetch(), clock: () => NOW, provider: { apiKey: KEY } })
    const input = await service.getTrackingInput()
    const tracker = updateTracker(null, input, NOW, 'local-preview', { approvedSource: PROVIDER_SOURCE_NAME })
    // Fixtures are one day out, outside the 2-48h capture window, so the ledger
    // stays empty but valid rather than inventing a forecast.
    expect(tracker.records).toHaveLength(0)
    expect(tracker.publication).toBe('local-preview')
  })

  it('rejects an unknown source name outright', async () => {
    const service = createDataService({ fetchImpl: fakeFetch(), clock: () => NOW, provider: { apiKey: KEY } })
    const input = await service.getTrackingInput()
    const forged = { ...input, feed: { ...input.feed, source: { ...input.feed.source, name: 'mystery-feed' } } }
    expect(() => updateTracker(null, forged, NOW, 'local-preview', { approvedSource: 'mystery-feed' })).toThrow(/unknown forecast source/i)
  })
})
