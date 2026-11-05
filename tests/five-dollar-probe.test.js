// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { FIVE_DOLLAR_LEAGUES, probeFiveDollar } from '../scripts/lib/five-dollar-probe.js'

const KEY = 'test-only-key'
const NOW = Date.parse('2026-11-05T15:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function row(league, overrides = {}) {
  const kickoff = NOW + DAY
  return {
    id: 1, league: { id: league.id, name: league.name },
    teams: { home: { id: 101, name: 'Alpha' }, away: { id: 102, name: 'Beta' } },
    kickoff_utc: new Date(kickoff).toISOString(), kickoff_ts: kickoff / 1000,
    status: 'scheduled', status_code: null, goals: { home: null, away: null }, ...overrides,
  }
}

function completed(league, overrides = {}) {
  const kickoff = NOW - DAY
  return row(league, {
    id: 2, kickoff_utc: new Date(kickoff).toISOString(), kickoff_ts: kickoff / 1000,
    status: 'finished', status_code: 'full', goals: { home: 0, away: 0 }, ...overrides,
  })
}

function response(data = [], page = 1, hasMore = false) {
  return { ok: true, status: 200, json: async () => ({ success: 1, data, pagination: { page, has_more: hasMore } }) }
}

function leagueFor(url) {
  return FIVE_DOLLAR_LEAGUES.find((league) => new URL(url).pathname === `/v1/leagues/${league.id}/fixtures`)
}

function successfulFetch() {
  return vi.fn(async (url) => {
    const league = leagueFor(url)
    return response([row(league), completed(league)])
  })
}

describe('read-only replacement-source probe', () => {
  it('checks the four documented leagues with pinned windows and returns aggregate counts only', async () => {
    const fetchImpl = successfulFetch()
    const report = await probeFiveDollar({ apiKey: KEY, fetchImpl, now: NOW })
    expect(report).toMatchObject({ checkedAt: '2026-11-05T15:00:00.000Z', requests: 4, historyDays: 85, futureDays: 14 })
    expect(report.leagues).toEqual(FIVE_DOLLAR_LEAGUES.map(({ name }) => ({ league: name, scheduled: 1, finished: 1, unknown: 0, pages: 1 })))
    expect(JSON.stringify(report)).not.toMatch(/test-only-key|Alpha|Beta|goals|kickoff_utc/)
    for (const [url, options] of fetchImpl.mock.calls) {
      const parsed = new URL(url)
      expect(parsed.origin).toBe('https://api.5dollarfootballapi.com')
      expect(parsed.searchParams.get('start_time')).toBe(String((NOW - 85 * DAY) / 1000))
      expect(parsed.searchParams.get('end_time')).toBe(String((NOW + 14 * DAY) / 1000))
      expect(parsed.searchParams.get('per_page')).toBe('100')
      expect(parsed.searchParams.get('order')).toBe('asc')
      expect(options.headers.Authorization).toBe(`Bearer ${KEY}`)
      expect(options.redirect).toBe('manual')
      expect(options.signal).toBeInstanceOf(AbortSignal)
      expect(url).not.toContain(KEY)
    }
  })

  it('counts only confirmed final scores and future scheduled matches, not live or unknown rows', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const league = leagueFor(url)
      const rows = [row(league), completed(league), row(league, { id: 3, status: 'in_play', goals: { home: 2, away: 1 } }), row(league, { id: 4, status: 'unknown', goals: { home: 5, away: 0 } })]
      return response(rows)
    })
    const report = await probeFiveDollar({ apiKey: KEY, fetchImpl, now: NOW })
    expect(report.leagues.every((item) => item.scheduled === 1 && item.finished === 1 && item.unknown === 1)).toBe(true)
  })

  it('follows pagination within the request cap and refuses a partial history', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const league = leagueFor(url), page = Number(new URL(url).searchParams.get('page'))
      return response([row(league, { id: page })], page, page < 2)
    })
    const report = await probeFiveDollar({ apiKey: KEY, fetchImpl, now: NOW })
    expect(report.requests).toBe(8)
    expect(report.leagues.every((item) => item.scheduled === 2 && item.pages === 2)).toBe(true)
    const incomplete = vi.fn(async (url) => {
      const league = leagueFor(url), page = Number(new URL(url).searchParams.get('page'))
      return response([row(league, { id: page })], page, true)
    })
    await expect(probeFiveDollar({ apiKey: KEY, fetchImpl: incomplete, now: NOW })).rejects.toThrow('refusing a partial history')
    expect(incomplete).toHaveBeenCalledTimes(3)
  })

  it('rejects missing keys, control characters and invalid clocks without making a request', async () => {
    const fetchImpl = successfulFetch()
    for (const apiKey of [undefined, '', '   ', 'bad\nkey']) {
      await expect(probeFiveDollar({ apiKey, fetchImpl, now: NOW })).rejects.toThrow('key is required')
    }
    for (const now of [NaN, Infinity, 1e300]) {
      await expect(probeFiveDollar({ apiKey: KEY, fetchImpl, now })).rejects.toThrow('configuration is invalid')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not follow moved leagues or send a key to a redirect destination', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 301, headers: { location: 'https://elsewhere.test/' } }))
    await expect(probeFiveDollar({ apiKey: KEY, fetchImpl, now: NOW })).rejects.toThrow('league ID moved')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual')
  })

  it('reports authentication, plan, quota and network failures without leaking errors or the key', async () => {
    for (const status of [401, 403]) {
      await expect(probeFiveDollar({ apiKey: KEY, fetchImpl: async () => ({ ok: false, status }), now: NOW })).rejects.toThrow('key or plan')
    }
    await expect(probeFiveDollar({ apiKey: KEY, fetchImpl: async () => ({ ok: false, status: 429 }), now: NOW })).rejects.toThrow('rate limit')
    try {
      await probeFiveDollar({ apiKey: KEY, fetchImpl: async () => { throw new Error(`unsafe message ${KEY}`) }, now: NOW })
      throw new Error('expected rejection')
    } catch (error) {
      expect(error.message).toContain('failed or timed out')
      expect(error.message).not.toContain(KEY)
    }
  })

  it('rejects duplicate identities and contradictory, missing or non-final result data', async () => {
    const cases = [
      (league) => [row(league), row(league)],
      (league) => [row(league, { league: { id: 1 } })],
      (league) => [row(league, { teams: { home: { id: 5, name: 'A' }, away: { id: 5, name: 'B' } } })],
      (league) => [row(league, { kickoff_ts: NOW / 1000 })],
      (league) => [row(league, { status: 'cancelled' })],
      (league) => [completed(league, { status_code: 'half' })],
      (league) => [completed(league, { goals: { home: null, away: 0 } })],
      (league) => [completed(league, { kickoff_utc: new Date(NOW + DAY).toISOString(), kickoff_ts: (NOW + DAY) / 1000 })],
    ]
    for (const makeRows of cases) {
      const fetchImpl = async (url) => response(makeRows(leagueFor(url)))
      await expect(probeFiveDollar({ apiKey: KEY, fetchImpl, now: NOW })).rejects.toThrow('unexpected or incomplete')
    }
  })

  it('rejects malformed pagination and malformed JSON without logging response contents', async () => {
    const wrongPage = async () => response([], 2)
    await expect(probeFiveDollar({ apiKey: KEY, fetchImpl: wrongPage, now: NOW })).rejects.toThrow('unexpected or incomplete')
    const invalidJson = async () => ({ ok: true, status: 200, json: async () => { throw new Error(KEY) } })
    await expect(probeFiveDollar({ apiKey: KEY, fetchImpl: invalidJson, now: NOW })).rejects.toThrow('unexpected or incomplete')
  })
})
