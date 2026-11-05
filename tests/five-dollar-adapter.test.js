// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  createTeamResolver, lagosKickoff, loadProviderDatasets, normalizeRow, ProviderDataError, PROVIDER_LEAGUES,
} from '../server/providers/five-dollar.js'
import { matchId } from '../server/football.js'
import { TEAM_ALIASES } from '../server/providers/team-aliases.js'

const KEY = 'test-only-key'
const NOW = Date.parse('2026-11-05T15:00:00Z')
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const resolverFor = (competition = 'premier-league') => createTeamResolver(competition, { aliases: TEAM_ALIASES })

function providerRow(leagueId, overrides = {}) {
  const kickoff = NOW + DAY
  return {
    id: 1, league: { id: leagueId, name: 'Provider League' },
    teams: { home: { id: 101, name: 'Everton' }, away: { id: 102, name: 'Coventry' } },
    kickoff_utc: new Date(kickoff).toISOString(), kickoff_ts: kickoff / 1000,
    status: 'scheduled', status_code: null, goals: { home: null, away: null }, ...overrides,
  }
}

function finishedRow(leagueId, overrides = {}) {
  const kickoff = NOW - DAY
  return providerRow(leagueId, {
    id: 2, kickoff_utc: new Date(kickoff).toISOString(), kickoff_ts: kickoff / 1000,
    status: 'finished', status_code: 'full', goals: { home: 2, away: 1 }, ...overrides,
  })
}

function normalizeArgs(overrides = {}) {
  return {
    leagueId: PROVIDER_LEAGUES[0].id, competition: 'premier-league', resolve: resolverFor().resolve,
    now: NOW, start: NOW - 90 * DAY, end: NOW + 14 * DAY, ...overrides,
  }
}

describe('provider team resolution', () => {
  it('keeps roster names exactly as the ledger already spells them', () => {
    const { resolve } = resolverFor()
    expect(resolve('Everton')).toBe('Everton')
    expect(resolve('Manchester City')).toBe('Man City')
    expect(resolve('Tottenham Hotspur')).toBe('Spurs')
    expect(resolve("Nott'm Forest")).toBe("Nott'm Forest")
    expect(resolve('Nottingham Forest')).toBe("Nott'm Forest")
  })

  it('maps accented and club-suffixed spellings onto the frozen identity', () => {
    const { resolve } = resolverFor('bundesliga')
    expect(resolve('Bayern Munich')).toBe('FC Bayern München')
    expect(resolve('Borussia Monchengladbach')).toBe('Borussia Mönchengladbach')
    expect(resolve('Bayer Leverkusen')).toBe('Bayer 04 Leverkusen')
    expect(resolve('FC Bayern München')).toBe('FC Bayern München')
  })

  it('never guesses an unknown club', () => {
    const { resolve } = resolverFor()
    expect(resolve('Some Unlisted FC')).toBeNull()
    expect(resolve('')).toBeNull()
    expect(resolve(undefined)).toBeNull()
  })

  it('takes the canonical spelling from the roster even when an alias has the wrong accents', () => {
    const { resolve } = createTeamResolver('la-liga', { aliases: { 'atletico': 'Atletico de Madrid' } })
    expect(resolve('Atletico')).toBe('Atlético de Madrid')
  })

  it('fails closed on an alias that points outside the roster', () => {
    const { resolve } = createTeamResolver('serie-a', { aliases: { 'ac milan': 'Milan' } })
    expect(resolve('AC Milan')).toBe('Milan')
    const { resolve: broken } = createTeamResolver('serie-a', { aliases: { 'ac milan': 'Not A Club' } })
    expect(broken('AC Milan')).toBeNull()
  })

  it('rejects a league without a frozen roster', () => {
    expect(() => createTeamResolver('ligue-1')).toThrow(ProviderDataError)
  })

  it('gives provider spellings the same match identity as the community feed', () => {
    const { resolve } = resolverFor()
    const home = resolve('Manchester City')
    const away = resolve('Tottenham Hotspur')
    expect(matchId('2026-27', 'premier-league', home, away))
      .toBe(matchId('2026-27', 'premier-league', 'Man City', 'Spurs'))
  })
})

describe('kick-off conversion', () => {
  it('converts UTC to the fixed UTC+1 the site displays', () => {
    expect(lagosKickoff('2026-11-06T20:00:00+00:00')).toEqual({ date: '2026-11-06', time: '21:00' })
    expect(lagosKickoff('2026-11-06T23:30:00Z')).toEqual({ date: '2026-11-07', time: '00:30' })
  })

  it('rejects an unparseable kick-off', () => {
    expect(lagosKickoff('not-a-date')).toBeNull()
  })
})

describe('row normalisation', () => {
  const args = normalizeArgs()

  it('publishes a confirmed full-time result', () => {
    expect(normalizeRow(finishedRow(PROVIDER_LEAGUES[0].id), args)).toEqual({
      kind: 'result', result: { date: '2026-11-04', home: 'Everton', away: 'Coventry', homeGoals: 2, awayGoals: 1 },
    })
  })

  it('publishes a future scheduled fixture with its UTC+1 kick-off', () => {
    expect(normalizeRow(providerRow(PROVIDER_LEAGUES[0].id), args)).toEqual({
      kind: 'fixture', fixture: { date: '2026-11-06', time: '16:00', home: 'Everton', away: 'Coventry' },
    })
  })

  it('does not publish an unconfirmed or impossible result', () => {
    expect(normalizeRow(finishedRow(PROVIDER_LEAGUES[0].id, { status_code: '67' }), args).reason).toBe('unconfirmed')
    expect(normalizeRow(finishedRow(PROVIDER_LEAGUES[0].id, { goals: { home: null, away: null } }), args).reason).toBe('unconfirmed')
    expect(normalizeRow(finishedRow(PROVIDER_LEAGUES[0].id, { goals: { home: 3.5, away: 1 } }), args).reason).toBe('unconfirmed')
    expect(normalizeRow(finishedRow(PROVIDER_LEAGUES[0].id, { kickoff_utc: new Date(NOW + HOUR).toISOString(), kickoff_ts: (NOW + HOUR) / 1000 }), args).reason).toBe('unconfirmed')
  })

  it('does not publish an in-play or unknown match as a fixture or result', () => {
    expect(normalizeRow(providerRow(PROVIDER_LEAGUES[0].id, { status: 'in_play', status_code: '67' }), args).reason).toBe('not-publishable')
    expect(normalizeRow(providerRow(PROVIDER_LEAGUES[0].id, { status: 'unknown', status_reason: 'kickoff_unconfirmed' }), args).reason).toBe('not-publishable')
    expect(normalizeRow(providerRow(PROVIDER_LEAGUES[0].id, { kickoff_utc: new Date(NOW - HOUR).toISOString(), kickoff_ts: (NOW - HOUR) / 1000 }), args).reason).toBe('not-publishable')
  })

  it('reports unknown clubs instead of renaming them', () => {
    const row = providerRow(PROVIDER_LEAGUES[0].id, {
      teams: { home: { id: 999, name: 'Mystery Athletic' }, away: { id: 102, name: 'Coventry' } },
    })
    expect(normalizeRow(row, args)).toEqual({ reason: 'unknown-team', competition: 'premier-league', unmapped: ['Mystery Athletic'] })
  })

  it('rejects malformed rows and the wrong competition', () => {
    const id = PROVIDER_LEAGUES[0].id
    expect(normalizeRow(providerRow(id, { id: 0 }), args).reason).toBe('malformed')
    expect(normalizeRow(providerRow(id, { league: { id: 123 } }), args).reason).toBe('malformed')
    expect(normalizeRow(providerRow(id, { teams: { home: { id: 1, name: 'Everton' }, away: { id: 1, name: 'Everton' } } }), args).reason).toBe('malformed')
    expect(normalizeRow(providerRow(id, { kickoff_ts: 1234 }), args).reason).toBe('malformed')
    expect(normalizeRow(providerRow(id, { status: 'postponed' }), args).reason).toBe('malformed')
    expect(normalizeRow(providerRow(id, { kickoff_utc: new Date(NOW + 40 * DAY).toISOString(), kickoff_ts: (NOW + 40 * DAY) / 1000 }), args).reason).toBe('outside-window')
    expect(normalizeRow(null, args).reason).toBe('malformed')
  })
})

function response(rows, page = 1, hasMore = false) {
  return { ok: true, status: 200, json: async () => ({ success: 1, data: rows, pagination: { page, has_more: hasMore } }) }
}

function leagueIdFrom(url) {
  return Number(new URL(url).pathname.split('/')[3])
}

describe('loading four competitions', () => {
  it('builds datasets in the existing shape and audits unknown clubs', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const leagueId = leagueIdFrom(url)
      const page = Number(new URL(url).searchParams.get('page'))
      const pairs = { 4160026622: ['Everton', 'Coventry'], 4212821298: ['Sevilla FC', 'Málaga CF'],
        686337048: ['Hamburger SV', 'FC Bayern München'], 3405541143: ['Venezia', 'Udinese'] }
      const [home, away] = pairs[leagueId]
      const teams = { home: { id: 101, name: home }, away: { id: 102, name: away } }
      const mystery = providerRow(leagueId, { id: 50, teams: { home: { id: 998, name: 'Mystery Athletic' }, away: { id: 102, name: away } } })
      return response(page === 1 ? [finishedRow(leagueId, { teams }), providerRow(leagueId, { teams }), mystery] : [], page, page === 1)
    })
    const { datasets, audit, season } = await loadProviderDatasets({ apiKey: KEY, fetchImpl, now: NOW })

    expect(datasets).toHaveLength(4)
    expect(season.label).toBe('2026-27')
    for (const dataset of datasets) {
      expect(dataset.results).toHaveLength(1)
      expect(dataset.fixtures).toHaveLength(1)
      expect(dataset.results[0]).toEqual(dataset.trackingResults[0])
      expect(dataset.results[0].home).not.toBe('Mystery Athletic')
    }
    expect(datasets.map((dataset) => dataset.league.id)).toEqual(['premier-league', 'la-liga', 'bundesliga', 'serie-a'])
    expect(audit.requests).toBe(8)
    expect(audit.leagues.every((league) => league.unknownTeams === 1)).toBe(true)
    expect(audit.unmapped).toHaveLength(4)
    expect(audit.unmapped[0]).toEqual({ competition: 'premier-league', name: 'Mystery Athletic' })
    expect(audit.reasons).toEqual({ 'unknown-team': 4 })
  })

  it('sends the key only as an authorisation header and never follows redirects', async () => {
    const fetchImpl = vi.fn(async (url) => response([], Number(new URL(url).searchParams.get('page')), false))
    await loadProviderDatasets({ apiKey: KEY, fetchImpl, now: NOW })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.5dollarfootballapi.com/v1/leagues/4160026622/fixtures?start_time=1786114800&end_time=1795100400&order=asc&page=1&per_page=100')
    expect(options).toMatchObject({ redirect: 'manual', headers: { Authorization: `Bearer ${KEY}` } })
    expect(url).not.toContain(KEY)
  })

  it('fails closed on an unexpected page or has_more shape', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: 1, data: [] }) }))
    await expect(loadProviderDatasets({ apiKey: KEY, fetchImpl, now: NOW })).rejects.toThrow(/unexpected provider response/i)
  })

  it('fails closed when a league runs past the page limit', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return response([providerRow(leagueIdFrom(url), { id: page })], page, true)
    })
    await expect(loadProviderDatasets({ apiKey: KEY, fetchImpl, now: NOW })).rejects.toThrow(/incomplete/i)
  })

  it('fails closed on a moved league id, a denied key and a rate limit', async () => {
    for (const status of [301, 401, 429]) {
      const fetchImpl = vi.fn(async () => ({ ok: false, status, json: async () => ({}) }))
      await expect(loadProviderDatasets({ apiKey: KEY, fetchImpl, now: NOW })).rejects.toThrow(ProviderDataError)
    }
  })

  it('refuses to run without a usable key', async () => {
    for (const apiKey of ['', '   ', 'bad\nkey', undefined]) {
      await expect(loadProviderDatasets({ apiKey, fetchImpl: vi.fn(), now: NOW })).rejects.toThrow(/provider key/i)
    }
  })
})
